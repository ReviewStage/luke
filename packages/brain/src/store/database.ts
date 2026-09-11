import type { DatabaseSync, SQLInputValue, StatementSync } from "node:sqlite";
import type { SqlClient } from "@effect/sql/SqlClient";
import type { SqlError } from "@effect/sql/SqlError";
import type { UnparsedWireValue } from "@sidecar/wire";
import { Cause, type Context, Effect, Exit, Layer, Scope } from "effect";
import { migrateStoreSchemaSync } from "./migration.js";
import { layerFromHandle, openDatabaseHandle } from "./sql-node-sqlite.js";

/**
 * The agent's database connection, spoken to synchronously. It runs on the
 * store's own worker thread in the app — Electron's main thread never calls
 * it — and in-thread in tests, where the same operations are exercised
 * against a file or `:memory:`. The table groups each have a module of their
 * own over this handle: the brain's envelope, the conversation's lines,
 * and the remembered facts.
 *
 * Every operation that changes more than one row runs in one transaction,
 * with WAL journaling and full synchronous commits, so a crash leaves the
 * database at the envelope before or the envelope after a save, never
 * between. Foreign keys cascade a session's rows with it: replacing a
 * generation deletes the old one's checkpoints, cursors, requests, and
 * receipts in the same statement that removes the session.
 *
 * The handle is opened by `sql-node-sqlite.ts`, and one `@effect/sql` client
 * over it is built here, once, at the open: `sql` hands that one client out
 * as a layer, and `run` provides it to a table module's effect for the
 * callers that still hold a synchronous surface. The conversation, directory,
 * and transcript tables are effects over that client already; the
 * synchronous `prepare`, `exec`, and `transaction` below are the surface the
 * rest move off in P5-10b..d, kept until the last of them has. Bringing the
 * schema to this build's version is already the client's work, in
 * `migration.ts`, which `open` runs over that layer before handing the
 * database back.
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

  private constructor(db: DatabaseSync) {
    this.#db = db;
    this.#scope = Effect.runSync(Scope.make());
    this.#client = Effect.runSync(Scope.extend(Layer.build(layerFromHandle(db)), this.#scope));
    this.sql = Layer.succeedContext(this.#client);
  }

  /** Opens or creates the database at `location` and brings its schema to this build's version. */
  static open(location: string): StoreDatabase {
    const database = new StoreDatabase(openDatabaseHandle(location));
    migrateStoreSchemaSync(database.sql);
    return database;
  }

  /**
   * Runs a table module's effect over this database's own client and answers
   * what it succeeded with, throwing what it failed with exactly as the
   * synchronous surface throws. Every statement underneath is one
   * synchronous call into `node:sqlite`, so the run waits on nothing.
   *
   * @deprecated A strangler shim on the `Effect.runSync` allowlist in
   * `docs/adr/0001-effect.md`. P5-11 makes the worker an Rpc server with a
   * runtime edge of its own, where every operation runs its own effect and
   * this door is gone.
   */
  run<A>(effect: Effect.Effect<A, SqlError, SqlClient>): A {
    const exit = Effect.runSyncExit(Effect.provide(effect, this.#client));
    if (Exit.isFailure(exit)) throw Cause.squash(exit.cause);
    return exit.value;
  }

  /** Returns freed pages to the file system and truncates the WAL, so the physical measurement sees a deletion. */
  reclaimFreedPages(): void {
    this.#db.exec("PRAGMA incremental_vacuum");
    this.#db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  }

  /** @deprecated A table module moves onto `sql` in P5-10a..d, and this goes with the last one. */
  prepare(sql: string): StatementSync {
    return this.#db.prepare(sql);
  }

  /** @deprecated A table module moves onto `sql` in P5-10a..d, and this goes with the last one. */
  exec(sql: string): void {
    this.#db.exec(sql);
  }

  /**
   * Runs `work` atomically. The outermost call owns the transaction; a call
   * inside it becomes a savepoint, so an operation that is atomic on its own
   * is also atomic as one step of a larger one, and a failure anywhere rolls
   * the whole outer transaction back.
   *
   * @deprecated `sql.withTransaction` nests the same way, and a table module
   * moves onto it in P5-10a..d; this goes with the last one.
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

  close(): void {
    Effect.runSync(Scope.close(this.#scope, Exit.void));
    this.#db.close();
  }
}

/** An optional field as its column takes it: the value, or NULL for an absent one. */
export function nullable(value: string | number | undefined): SQLInputValue {
  return value === undefined ? null : value;
}

/**
 * A column read as the wire value it is, admitted by `isKind` or read as
 * absent, so the envelope reader — not the table module — decides what is
 * admitted: a column of the wrong type reads as a missing field, which the
 * reader refuses.
 */
export function column<Value extends string | number>(
  value: SQLInputValue | undefined,
  isKind: (value: UnparsedWireValue) => value is Value,
): Value | null {
  // SAFETY: these tables declare only TEXT and INTEGER columns, read as strings and numbers; a
  // blob or bigint would be a schema violation, and the wire guard then refuses the field.
  const wire = value as UnparsedWireValue;
  return isKind(wire) ? wire : null;
}
