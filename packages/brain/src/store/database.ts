import type { DatabaseSync, SQLInputValue, StatementSync } from "node:sqlite";
import type { SqlClient } from "@effect/sql/SqlClient";
import type { UnparsedWireValue } from "@sidecar/wire";
import type { Layer } from "effect";
import {
  STORE_SCHEMA_FLOOR,
  STORE_SCHEMA_MIGRATIONS,
  STORE_SCHEMA_STATEMENTS,
  STORE_SCHEMA_VERSION,
} from "./schema.js";
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
 * The handle is opened by `sql-node-sqlite.ts`, and the same handle stands
 * behind `sql`, the `@effect/sql` client the table modules move onto in
 * P5-10a..d; the synchronous `prepare`, `exec`, and `transaction` below are
 * the surface they move off, kept until the last of them has.
 */

export const AGENT_DATABASE_FILE = "agent.sqlite";

export class StoreDatabase {
  readonly #db: DatabaseSync;
  #transactionDepth = 0;
  /**
   * This handle as an `@effect/sql` client. The client and the synchronous
   * surface share one connection and one transaction stack, so a transaction
   * is owned by one of them at a time: an Effect run inside `transaction()`
   * would issue its own BEGIN against the one already open.
   */
  readonly sql: Layer.Layer<SqlClient>;

  private constructor(db: DatabaseSync) {
    this.#db = db;
    this.sql = layerFromHandle(db);
  }

  /** Opens or creates the database at `location` and brings its schema to this build's version. */
  static open(location: string): StoreDatabase {
    const database = new StoreDatabase(openDatabaseHandle(location));
    database.#migrateSchema();
    return database;
  }

  /** Returns freed pages to the file system and truncates the WAL, so the physical measurement sees a deletion. */
  reclaimFreedPages(): void {
    this.#db.exec("PRAGMA incremental_vacuum");
    this.#db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  }

  /**
   * Brings the schema to this build's version. A database at an earlier
   * version is walked forward one step at a time after the current statements
   * have created what is missing, so a column the statements now declare is
   * added to the table that already stands rather than assumed; a database at a later
   * version, or at one with no step to reach this one, is refused.
   */
  #migrateSchema(): void {
    this.transaction(() => {
      // SAFETY: sqlite_master's name column is text; a row is that column or nothing.
      const versioned = this.#db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_version'")
        .get() as { name: string } | undefined;
      // SAFETY: the schema_version table has one integer column; a row is that column or nothing.
      const row = versioned
        ? (this.#db.prepare("SELECT version FROM schema_version").get() as
            | { version: number }
            | undefined)
        : undefined;
      // A version this build cannot reach from — past its own, or before the
      // floor it carries forward from — is refused rather than migrated by guess.
      if (row && (row.version > STORE_SCHEMA_VERSION || row.version < STORE_SCHEMA_FLOOR)) {
        throw new Error(
          `the brain's store is at schema version ${row.version}, not ${STORE_SCHEMA_VERSION}`,
        );
      }
      // The current statements run first: each creates a table only where
      // none stands, so a table a later version added exists before a step
      // that fills it from the older ones, and a table that already stands is
      // left for its step to alter.
      for (const statement of STORE_SCHEMA_STATEMENTS) this.#db.exec(statement);
      if (row) {
        // A version the table names no steps for changed only what the
        // current statements above already create, so it migrates by having
        // nothing to do; the refusal that matters is a version this build
        // does not know at all, raised above.
        for (let version = row.version + 1; version <= STORE_SCHEMA_VERSION; version += 1) {
          const steps = STORE_SCHEMA_MIGRATIONS.get(version) ?? [];
          for (const step of steps) {
            if (step.onlyIf && !this.#stands(step.onlyIf)) continue;
            if (step.unless && this.#stands(step.unless)) continue;
            this.#db.prepare(step.sql).run(...step.params);
          }
        }
      }
      if (!row) {
        this.#db
          .prepare("INSERT INTO schema_version (version) VALUES (?)")
          .run(STORE_SCHEMA_VERSION);
      } else if (row.version !== STORE_SCHEMA_VERSION) {
        this.#db.prepare("UPDATE schema_version SET version = ?").run(STORE_SCHEMA_VERSION);
      }
    });
  }

  #stands(target: { table: string; column?: string }): boolean {
    const table = this.#db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(target.table);
    if (!table) return false;
    if (target.column === undefined) return true;
    return (
      this.#db
        .prepare("SELECT 1 FROM pragma_table_info(?) WHERE name = ?")
        .get(target.table, target.column) !== undefined
    );
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
