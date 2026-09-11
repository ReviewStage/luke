import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import * as Client from "@effect/sql/SqlClient";
import { describe, it } from "@effect/vitest";
import { temporaryDirectoryScoped } from "@sidecar/runtime/testing";
import {
  Context,
  Data,
  Deferred,
  Effect,
  Either,
  Exit,
  Fiber,
  Layer,
  Option,
  Schema,
  Scope,
  TestClock,
} from "effect";
import { layer } from "./sql-node-sqlite.js";
import { openDatabase } from "./testing.js";

const SQLITE_BUSY = 5;
const WAL_JOURNAL_MODE = "wal";
const FULL_SYNCHRONOUS = 2;
const INCREMENTAL_AUTO_VACUUM = 2;
const readErrorCode = Schema.decodeUnknownSync(Schema.Struct({ errcode: Schema.Number }));

class StepFailed extends Data.TaggedError("StepFailed") {}

/** A client over `filename`, alive for the enclosing scope. */
const openClient = (filename: string) =>
  Effect.map(Layer.build(layer({ filename })), (context) => Context.get(context, Client.SqlClient));

const databaseIn = (directory: string) => path.join(directory, "agent.sqlite");

const names = (sql: Client.SqlClient, table: string) =>
  Effect.map(
    sql.unsafe<{ readonly name: string }>(`SELECT name FROM ${table} ORDER BY rowid`),
    (rows) => rows.map((row) => row.name),
  );

const withNodeFileSystem = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.scoped, Effect.provide(NodeFileSystem.layer));

describe("the node:sqlite client", () => {
  it.effect("opens with the store's pragmas", () =>
    withNodeFileSystem(
      Effect.gen(function* () {
        const directory = yield* temporaryDirectoryScoped();
        const sql = yield* openClient(databaseIn(directory));

        const [journal] = yield* sql`PRAGMA journal_mode`;
        const [synchronous] = yield* sql`PRAGMA synchronous`;
        const [foreignKeys] = yield* sql`PRAGMA foreign_keys`;
        const [autoVacuum] = yield* sql`PRAGMA auto_vacuum`;

        assert.equal(journal?.journal_mode, WAL_JOURNAL_MODE);
        assert.equal(synchronous?.synchronous, FULL_SYNCHRONOUS);
        assert.equal(foreignKeys?.foreign_keys, 1);
        assert.equal(autoVacuum?.auto_vacuum, INCREMENTAL_AUTO_VACUUM);
      }),
    ),
  );

  it.effect("closes the database when its scope closes, checkpointing the WAL into the file", () =>
    withNodeFileSystem(
      Effect.gen(function* () {
        const directory = yield* temporaryDirectoryScoped();
        const filename = databaseIn(directory);
        const scope = yield* Scope.make();
        const sql = yield* Scope.extend(openClient(filename), scope);
        yield* sql`CREATE TABLE marks (name TEXT NOT NULL)`;
        yield* sql`INSERT INTO marks (name) VALUES ('open')`;

        assert.equal(fs.existsSync(`${filename}-wal`), true);

        yield* Scope.close(scope, Exit.void);

        assert.equal(fs.existsSync(`${filename}-wal`), false);
        const reopened = yield* openClient(filename);
        assert.deepEqual(yield* names(reopened, "marks"), ["open"]);
      }),
    ),
  );

  it.effect("a nested step's failure rolls back that step alone", () =>
    withNodeFileSystem(
      Effect.gen(function* () {
        const directory = yield* temporaryDirectoryScoped();
        const sql = yield* openClient(databaseIn(directory));
        yield* sql`CREATE TABLE steps (name TEXT NOT NULL)`;

        yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* sql`INSERT INTO steps (name) VALUES ('outer-before')`;
            const inner = yield* Effect.either(
              sql.withTransaction(
                Effect.gen(function* () {
                  yield* sql`INSERT INTO steps (name) VALUES ('inner')`;
                  yield* sql.withTransaction(sql`INSERT INTO steps (name) VALUES ('innermost')`);
                  return yield* new StepFailed();
                }),
              ),
            );
            assert.equal(Either.isLeft(inner), true);
            yield* sql`INSERT INTO steps (name) VALUES ('outer-after')`;
          }),
        );

        assert.deepEqual(yield* names(sql, "steps"), ["outer-before", "outer-after"]);
      }),
    ),
  );

  it.effect("the outermost transaction's failure rolls back every step inside it", () =>
    withNodeFileSystem(
      Effect.gen(function* () {
        const directory = yield* temporaryDirectoryScoped();
        const sql = yield* openClient(databaseIn(directory));
        yield* sql`CREATE TABLE steps (name TEXT NOT NULL)`;

        const outcome = yield* Effect.either(
          sql.withTransaction(
            Effect.gen(function* () {
              yield* sql`INSERT INTO steps (name) VALUES ('outer')`;
              yield* sql.withTransaction(sql`INSERT INTO steps (name) VALUES ('inner')`);
              return yield* new StepFailed();
            }),
          ),
        );

        assert.equal(Either.isLeft(outcome), true);
        assert.deepEqual(yield* names(sql, "steps"), []);
        yield* sql`INSERT INTO steps (name) VALUES ('after')`;
        assert.deepEqual(yield* names(sql, "steps"), ["after"]);
      }),
    ),
  );

  it.effect("a transaction holds the connection, so another fiber's statement waits for it", () =>
    withNodeFileSystem(
      Effect.gen(function* () {
        const directory = yield* temporaryDirectoryScoped();
        const sql = yield* openClient(databaseIn(directory));
        yield* sql`CREATE TABLE arrivals (name TEXT NOT NULL)`;
        const began = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();

        const holder = yield* Effect.fork(
          sql.withTransaction(
            Effect.gen(function* () {
              yield* sql`INSERT INTO arrivals (name) VALUES ('in-transaction')`;
              yield* Deferred.succeed(began, undefined);
              yield* Deferred.await(release);
            }),
          ),
        );
        yield* Deferred.await(began);
        const outsider = yield* Effect.fork(sql`INSERT INTO arrivals (name) VALUES ('outside')`);
        yield* TestClock.adjust("1 second");

        assert.equal(Option.isNone(yield* Fiber.poll(outsider)), true);

        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(holder);
        yield* Fiber.join(outsider);

        assert.deepEqual(yield* names(sql, "arrivals"), ["in-transaction", "outside"]);
      }),
    ),
  );

  it.effect(
    "a second client on the same file is refused at once while the first holds a write, and lands once it is released",
    () =>
      withNodeFileSystem(
        Effect.gen(function* () {
          const directory = yield* temporaryDirectoryScoped();
          const filename = databaseIn(directory);
          const first = yield* openClient(filename);
          const second = yield* openClient(filename);
          yield* first`CREATE TABLE writers (name TEXT NOT NULL)`;
          const began = yield* Deferred.make<void>();
          const release = yield* Deferred.make<void>();

          const holder = yield* Effect.fork(
            first.withTransaction(
              Effect.gen(function* () {
                yield* first`INSERT INTO writers (name) VALUES ('first')`;
                yield* Deferred.succeed(began, undefined);
                yield* Deferred.await(release);
              }),
            ),
          );
          yield* Deferred.await(began);

          const refused = yield* Effect.either(
            second.withTransaction(second`INSERT INTO writers (name) VALUES ('second')`),
          );

          assert.equal(Either.isLeft(refused), true);
          if (Either.isLeft(refused)) {
            assert.equal(refused.left._tag, "SqlError");
            assert.equal(readErrorCode(refused.left.cause).errcode, SQLITE_BUSY);
          }

          yield* Deferred.succeed(release, undefined);
          yield* Fiber.join(holder);
          yield* second.withTransaction(second`INSERT INTO writers (name) VALUES ('second')`);

          assert.deepEqual(yield* names(second, "writers"), ["first", "second"]);
        }),
      ),
  );

  it.effect("binds the kinds SQLite takes and refuses one it does not", () =>
    withNodeFileSystem(
      Effect.gen(function* () {
        const directory = yield* temporaryDirectoryScoped();
        const sql = yield* openClient(databaseIn(directory));
        yield* sql`CREATE TABLE kinds (n, i INTEGER, t TEXT, b BLOB)`;
        const bytes = new Uint8Array([7, 11]);

        yield* sql`INSERT INTO kinds (n, i, t, b) VALUES (${null}, ${7}, ${"seven"}, ${bytes})`;
        const [row] = yield* sql`SELECT n, i, t, b FROM kinds`;

        assert.equal(row?.n, null);
        assert.equal(row?.i, 7);
        assert.equal(row?.t, "seven");
        assert.deepEqual(row?.b, bytes);

        const refused = yield* Effect.either(sql`INSERT INTO kinds (i) VALUES (${true})`);

        assert.equal(Either.isLeft(refused), true);
        if (Either.isLeft(refused)) assert.equal(refused.left._tag, "SqlError");
        assert.equal((yield* sql`SELECT COUNT(*) AS count FROM kinds`)[0]?.count, 1);
      }),
    ),
  );

  it.effect(
    "reads an integer past 2^53 as a bigint under SafeIntegers and refuses it otherwise",
    () =>
      withNodeFileSystem(
        Effect.gen(function* () {
          const directory = yield* temporaryDirectoryScoped();
          const sql = yield* openClient(databaseIn(directory));
          const large = 9_007_199_254_740_993n;

          const [safe] = yield* sql`SELECT ${large} AS big`.pipe(
            Effect.provideService(Client.SafeIntegers, true),
          );
          const refused = yield* Effect.either(sql`SELECT ${large} AS big`);

          assert.equal(safe?.big, large);
          assert.equal(Either.isLeft(refused), true);
          if (Either.isLeft(refused)) assert.equal(refused.left._tag, "SqlError");
        }),
      ),
  );

  it.effect(
    "every path reads the SafeIntegers of its own turn, never one a cached statement kept",
    () =>
      withNodeFileSystem(
        Effect.gen(function* () {
          const directory = yield* temporaryDirectoryScoped();
          const sql = yield* openClient(databaseIn(directory));

          const [safeRow] = yield* sql`SELECT 7 AS n`.pipe(
            Effect.provideService(Client.SafeIntegers, true),
          );
          const values = yield* sql`SELECT 7 AS n`.values;
          const safeValues = yield* sql`SELECT 7 AS n`.values.pipe(
            Effect.provideService(Client.SafeIntegers, true),
          );
          const raw = yield* sql`SELECT 7 AS n`.raw;

          assert.equal(safeRow?.n, 7n);
          assert.deepEqual(values, [[7]]);
          assert.deepEqual(safeValues, [[7n]]);
          assert.deepEqual(
            Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ n: Schema.Number })))(raw),
            [{ n: 7 }],
          );
        }),
      ),
  );

  it.effect("values answers rows as arrays and raw answers what the driver returned", () =>
    withNodeFileSystem(
      Effect.gen(function* () {
        const directory = yield* temporaryDirectoryScoped();
        const sql = yield* openClient(databaseIn(directory));
        yield* sql`CREATE TABLE pairs (a INTEGER, b TEXT)`;

        const inserted = yield* sql`INSERT INTO pairs (a, b) VALUES (${1}, ${"one"})`.raw;
        const values = yield* sql`SELECT a, b FROM pairs`.values;
        const selected = yield* sql`SELECT a, b FROM pairs`.raw;

        assert.deepEqual(inserted, { changes: 1, lastInsertRowid: 1 });
        assert.deepEqual(values, [[1, "one"]]);
        assert.deepEqual(
          Schema.decodeUnknownSync(
            Schema.Array(Schema.Struct({ a: Schema.Number, b: Schema.String })),
          )(selected),
          [{ a: 1, b: "one" }],
        );
      }),
    ),
  );

  it.effect("the store's own handle stands behind its client", () =>
    withNodeFileSystem(
      Effect.gen(function* () {
        const directory = yield* temporaryDirectoryScoped();
        const database = openDatabase(databaseIn(directory));
        yield* Effect.addFinalizer(() => Effect.sync(() => database.close()));
        database.exec("CREATE TABLE handles (name TEXT NOT NULL)");
        database.prepare("INSERT INTO handles (name) VALUES (?)").run("synchronous");
        const sql = yield* Effect.map(Layer.build(database.sql), (context) =>
          Context.get(context, Client.SqlClient),
        );

        yield* sql`INSERT INTO handles (name) VALUES ('effect')`;
        const [journal] = yield* sql`PRAGMA journal_mode`;

        assert.equal(journal?.journal_mode, WAL_JOURNAL_MODE);
        assert.deepEqual(yield* names(sql, "handles"), ["synchronous", "effect"]);
        assert.deepEqual(
          database
            .prepare("SELECT name FROM handles ORDER BY rowid")
            .all()
            .map((row) => row.name),
          ["synchronous", "effect"],
        );
      }),
    ),
  );
});
