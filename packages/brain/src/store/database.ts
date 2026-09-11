import type { DatabaseSync, StatementSync } from "node:sqlite";
import type { SqlClient } from "@effect/sql/SqlClient";
import { SqlError } from "@effect/sql/SqlError";
import { Cause, type Context, Effect, Exit, Layer, Scope } from "effect";
import { migrateStoreSchema, type StoreSchemaRefused } from "./migration.js";
import { layerFromHandle, openDatabaseHandle } from "./sql-node-sqlite.js";

/**
 * The agent's database connection. It runs on the store's own worker thread
 * in the app — Electron's main thread never calls it — and in-thread in
 * tests, where the same operations are exercised against a file or
 * `:memory:`. The table groups each have a module of their own over this
 * handle: the brain's envelope, the conversation's lines, and the remembered
 * facts.
 *
 * Every operation that changes more than one row runs in one transaction,
 * with WAL journaling and full synchronous commits, so a crash leaves the
 * database at the envelope before or the envelope after a save, never
 * between. Foreign keys cascade a session's rows with it: replacing a
 * generation deletes the old one's checkpoints, cursors, requests, and
 * receipts in the same statement that removes the session.
 *
 * The handle is opened by `sql-node-sqlite.ts`, and one `@effect/sql` client
 * over it is built by `open`, once, on the runtime that opens it: `sql`
 * hands that one client out as a layer, which is what every table module's
 * effect runs over. The synchronous surface below — `run`, `prepare`,
 * `exec`, `transaction`, `close` — is the handle the two OpenClaw ports
 * (`archives.ts`, `maintenance-run.ts`) and the suites that open a database
 * by hand still hold, and nothing else reaches the database through it.
 */

export const AGENT_DATABASE_FILE = "agent.sqlite";

export class StoreDatabase {
  readonly #db: DatabaseSync;
  readonly #scope: Scope.CloseableScope;
  readonly #client: Context.Context<SqlClient>;
  #transactionDepth = 0;
  /**
   * This handle as an `@effect/sql` client, built once at the open and handed
   * out as the layer that already holds it, so every effect run over this
   * database speaks to one client: one prepared-statement cache, and the one
   * permit that is the store's one-writer rule. The client and the
   * synchronous surface share that connection, and an Effect transaction
   * opened while `transaction()` already stands nests inside it as a
   * savepoint rather than issuing a second BEGIN.
   */
  readonly sql: Layer.Layer<SqlClient>;

  private constructor(
    db: DatabaseSync,
    scope: Scope.CloseableScope,
    client: Context.Context<SqlClient>,
  ) {
    this.#db = db;
    this.#scope = scope;
    this.#client = client;
    this.sql = Layer.succeedContext(client);
  }

  /**
   * Opens or creates the database at `location`, builds its one client, and
   * brings its schema to this build's version, all on the calling runtime.
   * The handle answered is released by its own `close`; a caller that holds
   * a scope releases it there with `Effect.acquireRelease`.
   */
  static open(location: string): Effect.Effect<StoreDatabase, SqlError | StoreSchemaRefused> {
    // Every step is a synchronous call into node:sqlite, so nothing is gained
    // by an interruption landing between them and a handle would be left open
    // by one; the open runs whole or not at all.
    return Effect.uninterruptible(
      Effect.gen(function* () {
        const db = yield* Effect.try({
          try: () => openDatabaseHandle(location),
          catch: (cause) => new SqlError({ cause, message: "the database cannot be opened" }),
        });
        const scope = yield* Scope.make();
        const database = yield* Effect.gen(function* () {
          const client = yield* Scope.extend(Layer.build(layerFromHandle(db)), scope);
          const opened = new StoreDatabase(db, scope, client);
          yield* Effect.provide(migrateStoreSchema, client);
          return opened;
        }).pipe(
          Effect.onError(() =>
            Effect.zipRight(
              Scope.close(scope, Exit.void),
              Effect.sync(() => db.close()),
            ),
          ),
        );
        return database;
      }),
    );
  }

  /**
   * Runs a table module's effect over this database's own client and answers
   * what it succeeded with, throwing what it failed with exactly as the
   * synchronous surface throws. Every statement underneath is one
   * synchronous call into `node:sqlite`, so the run waits on nothing.
   *
   * @deprecated A strangler shim on the `Effect.runSync` allowlist in
   * `docs/adr/0001-effect.md`: the synchronous reach of the two OpenClaw
   * ports, `archives.ts` and `maintenance-run.ts`, into the tables, which
   * import nothing from `effect` and so call the tables' synchronous doors.
   * It goes when those ports are handed a synchronous accessor of their own.
   */
  run<A, E>(effect: Effect.Effect<A, E, SqlClient>): A {
    const exit = Effect.runSyncExit(Effect.provide(effect, this.#client));
    if (Exit.isFailure(exit)) throw Cause.squash(exit.cause);
    return exit.value;
  }

  /** Returns freed pages to the file system and truncates the WAL, so the physical measurement sees a deletion. */
  reclaimFreedPages(): void {
    this.#db.exec("PRAGMA incremental_vacuum");
    this.#db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  }

  /** @deprecated The ports' synchronous surface; it goes with `run`. */
  prepare(sql: string): StatementSync {
    return this.#db.prepare(sql);
  }

  /** @deprecated The ports' synchronous surface; it goes with `run`. */
  exec(sql: string): void {
    this.#db.exec(sql);
  }

  /**
   * Runs `work` atomically. The outermost call owns the transaction; a call
   * inside it becomes a savepoint, so an operation that is atomic on its own
   * is also atomic as one step of a larger one, and a failure anywhere rolls
   * the whole outer transaction back.
   *
   * @deprecated The ports' synchronous surface; `sql.withTransaction` nests
   * the same way, and this goes with `run`.
   */
  transaction<T>(work: () => T): T {
    const depth = this.#transactionDepth;
    const savepoint = `step_${depth}`;
    this.#db.exec(depth === 0 ? "BEGIN IMMEDIATE" : `SAVEPOINT ${savepoint}`);
    this.#transactionDepth += 1;
    try {
      const result = work();
      this.#db.exec(depth === 0 ? "COMMIT" : `RELEASE ${savepoint}`);
      return result;
    } catch (error) {
      this.#db.exec(depth === 0 ? "ROLLBACK" : `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`);
      throw error;
    } finally {
      this.#transactionDepth -= 1;
    }
  }

  /**
   * Releases the client and closes the handle; a second call does nothing.
   *
   * @deprecated The handle's synchronous release, on the same allowlist row
   * as `run`: the worker releases its database through
   * `Effect.acquireRelease` over this, and the suites that open one by hand
   * call it directly.
   */
  close(): void {
    if (!this.#db.isOpen) return;
    Effect.runSync(Scope.close(this.#scope, Exit.void));
    this.#db.close();
  }
}
