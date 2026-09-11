import {
  DatabaseSync,
  type SQLInputValue,
  type SQLOutputValue,
  type StatementResultingChanges,
  type StatementSync,
} from "node:sqlite";
import * as Reactivity from "@effect/experimental/Reactivity";
import * as Client from "@effect/sql/SqlClient";
import type { Connection } from "@effect/sql/SqlConnection";
import { SqlError } from "@effect/sql/SqlError";
import * as Statement from "@effect/sql/Statement";
import { Cache, Context, Duration, Effect, Layer, Schema, Scope, Stream } from "effect";

/**
 * The store's database as an `@effect/sql` client over Node's own
 * `node:sqlite`. `@effect/sql-sqlite-node` wraps better-sqlite3, a native
 * module this build does not ship, so the client is built here from
 * `Client.make` and the library's own sqlite statement compiler over a
 * `DatabaseSync` handle: every statement is one synchronous call, answered
 * as an Effect.
 *
 * A client is one open handle and one permit over it. A statement takes the
 * permit for its own execution and a transaction takes it for its whole
 * scope, so another fiber's statement waits at the door rather than landing
 * inside a transaction it is no part of: the store's one-writer rule, kept
 * per handle. Nesting is `withTransaction` inside `withTransaction`, exactly
 * as `StoreDatabase#transaction` nests: the outermost issues `BEGIN
 * IMMEDIATE`, each level inside it is the savepoint named for its depth, and
 * a failed step rolls back to its own savepoint and releases it, leaving the
 * transaction around it standing; a step that succeeds is released by the
 * commit that ends the whole. A transaction opened while the synchronous
 * surface's own already stands over the same handle nests in it the same
 * way, since the two share the connection and SQLite refuses a second
 * BEGIN.
 *
 * `node:sqlite` binds null, numbers, bigints, strings, and bytes and nothing
 * else, so a parameter of any other kind is refused as a `SqlError` at the
 * bind rather than coerced to a value the caller did not write.
 */

const DB_SYSTEM_NAME_ATTRIBUTE = "db.system.name";
const INCREMENTAL_AUTO_VACUUM = 2;
const PREPARED_STATEMENT_CACHE_CAPACITY = 200;
const PREPARED_STATEMENT_CACHE_TTL = Duration.minutes(10);

const SqliteValue = Schema.Union(
  Schema.Null,
  Schema.Number,
  Schema.BigIntFromSelf,
  Schema.String,
  Schema.Uint8ArrayFromSelf,
);
const decodeParameters = Schema.decodeUnknown(Schema.Array(SqliteValue));
const decodeValueRows = Schema.decodeUnknown(Schema.Array(Schema.Array(SqliteValue)));
const readAutoVacuum = Schema.decodeUnknownSync(Schema.Struct({ auto_vacuum: Schema.Number }));

interface NodeSqliteClientOptions {
  /** The database file, or `:memory:` for one that dies with the client. */
  readonly filename: string;
}

/**
 * Opens the database at `filename` the way the store always has: WAL
 * journaling with full synchronous commits, so a crash leaves the file at the
 * write before or the write after and never between, and foreign keys
 * enforced so a session's rows cascade with it.
 */
export function openDatabaseHandle(filename: string): DatabaseSync {
  const db = new DatabaseSync(filename);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = FULL");
  db.exec("PRAGMA foreign_keys = ON");
  adoptIncrementalVacuum(db);
  return db;
}

/**
 * Freed pages are handed back to the file system on request rather than
 * kept, so a deletion the disk budget makes is a deletion the file's size
 * shows. A database created before the mode was set is rebuilt once to
 * adopt it; VACUUM cannot run inside a transaction, so it runs here, before
 * anything opens one.
 */
function adoptIncrementalVacuum(db: DatabaseSync): void {
  const mode = readAutoVacuum(db.prepare("PRAGMA auto_vacuum").get());
  if (mode.auto_vacuum === INCREMENTAL_AUTO_VACUUM) return;
  db.exec("PRAGMA auto_vacuum = INCREMENTAL");
  db.exec("VACUUM");
}

const statementFailed = (cause: unknown) =>
  new SqlError({ cause, message: "the statement failed" });

const cannotBind = (cause: unknown) =>
  new SqlError({
    cause,
    message: "a parameter cannot be bound: SQLite takes null, numbers, bigints, strings, and bytes",
  });

const makeConnection = (db: DatabaseSync): Effect.Effect<Connection> =>
  Effect.map(
    Cache.make({
      capacity: PREPARED_STATEMENT_CACHE_CAPACITY,
      timeToLive: PREPARED_STATEMENT_CACHE_TTL,
      lookup: (sql: string) =>
        Effect.try({
          try: () => db.prepare(sql),
          catch: (cause) => new SqlError({ cause, message: "the statement cannot be prepared" }),
        }),
    }),
    (prepared) => {
      const rowsOf = (statement: StatementSync, parameters: ReadonlyArray<SQLInputValue>) =>
        Effect.withFiberRuntime<ReadonlyArray<Record<string, SQLOutputValue>>, SqlError>(
          (fiber) => {
            statement.setReadBigInts(Context.get(fiber.currentContext, Client.SafeIntegers));
            try {
              return Effect.succeed(statement.all(...parameters));
            } catch (cause) {
              return Effect.fail(statementFailed(cause));
            }
          },
        );

      const rawOf = (statement: StatementSync, parameters: ReadonlyArray<SQLInputValue>) =>
        Effect.withFiberRuntime<
          ReadonlyArray<Record<string, SQLOutputValue>> | StatementResultingChanges,
          SqlError
        >((fiber) => {
          statement.setReadBigInts(Context.get(fiber.currentContext, Client.SafeIntegers));
          try {
            return Effect.succeed(
              statement.columns().length > 0
                ? statement.all(...parameters)
                : statement.run(...parameters),
            );
          } catch (cause) {
            return Effect.fail(statementFailed(cause));
          }
        });

      const valuesOf = (statement: StatementSync, parameters: ReadonlyArray<SQLInputValue>) =>
        Effect.withFiberRuntime<ReadonlyArray<Record<string, SQLOutputValue>>, SqlError>(
          (fiber) => {
            statement.setReadBigInts(Context.get(fiber.currentContext, Client.SafeIntegers));
            statement.setReturnArrays(true);
            try {
              return Effect.succeed(statement.all(...parameters));
            } catch (cause) {
              return Effect.fail(statementFailed(cause));
            } finally {
              statement.setReturnArrays(false);
            }
          },
        ).pipe(Effect.flatMap((rows) => Effect.orDie(decodeValueRows(rows))));

      const bound = (sql: string, parameters: ReadonlyArray<SQLInputValue>) =>
        Effect.flatMap(prepared.get(sql), (statement) => rowsOf(statement, parameters));

      const connection: Connection = {
        execute: (sql, params, transformRows) => {
          const rows = Effect.flatMap(
            decodeParameters(params).pipe(Effect.mapError(cannotBind)),
            (p) => bound(sql, p),
          );
          return transformRows === undefined ? rows : Effect.map(rows, transformRows);
        },
        executeRaw: (sql, params) =>
          Effect.flatMap(decodeParameters(params).pipe(Effect.mapError(cannotBind)), (p) =>
            Effect.flatMap(prepared.get(sql), (statement) => rawOf(statement, p)),
          ),
        executeStream: (sql, params, transformRows) =>
          Stream.fromIterableEffect(connection.execute(sql, params, transformRows)),
        executeValues: (sql, params) =>
          Effect.flatMap(decodeParameters(params).pipe(Effect.mapError(cannotBind)), (p) =>
            Effect.flatMap(prepared.get(sql), (statement) => valuesOf(statement, p)),
          ),
        executeUnprepared: (sql, params, transformRows) => {
          const rows = Effect.flatMap(
            decodeParameters(params).pipe(Effect.mapError(cannotBind)),
            (p) =>
              Effect.flatMap(
                Effect.try({
                  try: () => db.prepare(sql),
                  catch: (cause) =>
                    new SqlError({ cause, message: "the statement cannot be prepared" }),
                }),
                (statement) => rowsOf(statement, p),
              ),
          );
          return transformRows === undefined ? rows : Effect.map(rows, transformRows);
        },
      };
      return connection;
    },
  );

const SPAN_ATTRIBUTES: ReadonlyArray<readonly [string, string]> = [
  [DB_SYSTEM_NAME_ATTRIBUTE, "sqlite"],
];

/**
 * The savepoints an Effect transaction takes, named apart from the
 * synchronous surface's own `step_<depth>` so the two can stand at once over
 * the one handle without either releasing the other's.
 */
const savepointAt = (depth: number) => `effect_step_${depth}`;

/** The savepoint an Effect transaction opened inside a standing one takes in place of a BEGIN. */
const NESTED_OUTERMOST_SAVEPOINT = savepointAt(0);

const control = (statement: string) => (connection: Connection) =>
  Effect.asVoid(connection.executeUnprepared(statement, [], undefined));

const makeFromHandle = (
  db: DatabaseSync,
): Effect.Effect<Client.SqlClient, never, Reactivity.Reactivity> =>
  Effect.gen(function* () {
    const connection = yield* makeConnection(db);
    const permit = yield* Effect.makeSemaphore(1);
    const acquirer: Connection.Acquirer = Effect.uninterruptibleMask((restore) =>
      restore(permit.take(1)).pipe(
        Effect.zipRight(Effect.addFinalizer(() => permit.release(1))),
        Effect.as(connection),
      ),
    );
    const client = yield* Client.make({
      acquirer,
      compiler: Statement.makeCompilerSqlite(),
      spanAttributes: SPAN_ATTRIBUTES,
    });
    // The synchronous surface and this client share the one handle, so an
    // Effect transaction opened while `StoreDatabase#transaction` already
    // stands nests inside it as a savepoint: SQLite refuses a second BEGIN,
    // and a step of a larger atomic operation has to roll back to its own
    // point and leave the transaction around it standing. One outermost
    // transaction holds the connection's permit for its whole scope, so
    // which of the two a commit ends is the one thing tracked here.
    let nestedInHandleTransaction = false;
    // The library's own transaction folds every failure into a ROLLBACK, and
    // a ROLLBACK with nothing open is itself an error SQLite raises: a BEGIN
    // IMMEDIATE refused as busy, or a failure SQLite already rolled back on
    // its own, would end as a defect rather than the SqlError it is. The
    // handle knows whether a transaction stands, so the rollback runs only
    // when there is one to roll back.
    const withTransaction = Client.makeWithTransaction({
      transactionTag: Client.TransactionConnection,
      spanAttributes: SPAN_ATTRIBUTES,
      acquireConnection: Effect.flatMap(Scope.make(), (scope) =>
        Effect.map(
          Scope.extend(acquirer, scope),
          (held): readonly [Scope.CloseableScope, Connection] => [scope, held],
        ),
      ),
      begin: (held) =>
        Effect.suspend(() => {
          nestedInHandleTransaction = db.isTransaction;
          return nestedInHandleTransaction
            ? control(`SAVEPOINT ${NESTED_OUTERMOST_SAVEPOINT}`)(held)
            : control("BEGIN IMMEDIATE")(held);
        }),
      savepoint: (held, depth) => control(`SAVEPOINT ${savepointAt(depth)}`)(held),
      commit: (held) =>
        nestedInHandleTransaction
          ? control(`RELEASE ${NESTED_OUTERMOST_SAVEPOINT}`)(held)
          : control("COMMIT")(held),
      rollback: (held) => {
        if (nestedInHandleTransaction) {
          return Effect.zipRight(
            control(`ROLLBACK TO ${NESTED_OUTERMOST_SAVEPOINT}`)(held),
            control(`RELEASE ${NESTED_OUTERMOST_SAVEPOINT}`)(held),
          );
        }
        return db.isTransaction ? control("ROLLBACK")(held) : Effect.void;
      },
      rollbackSavepoint: (held, depth) =>
        Effect.zipRight(
          control(`ROLLBACK TO ${savepointAt(depth)}`)(held),
          control(`RELEASE ${savepointAt(depth)}`)(held),
        ),
    });
    return Object.assign(client, { withTransaction });
  });

const make = (
  options: NodeSqliteClientOptions,
): Effect.Effect<Client.SqlClient, SqlError, Scope.Scope | Reactivity.Reactivity> =>
  Effect.flatMap(
    Effect.acquireRelease(
      Effect.try({
        try: () => openDatabaseHandle(options.filename),
        catch: (cause) => new SqlError({ cause, message: "the database cannot be opened" }),
      }),
      (db) => Effect.sync(() => db.close()),
    ),
    makeFromHandle,
  );

/** The client over a database opened here, with the store's pragmas, and closed when the layer's scope closes. */
export const layer = (options: NodeSqliteClientOptions): Layer.Layer<Client.SqlClient, SqlError> =>
  Layer.scoped(Client.SqlClient, make(options)).pipe(Layer.provide(Reactivity.layer));

/**
 * The client over a handle its owner opened and will close, for the store
 * whose synchronous surface still holds the handle: the client closes
 * nothing, and the two share one connection and one transaction stack.
 */
export const layerFromHandle = (db: DatabaseSync): Layer.Layer<Client.SqlClient> =>
  Layer.effect(Client.SqlClient, makeFromHandle(db)).pipe(Layer.provide(Reactivity.layer));
