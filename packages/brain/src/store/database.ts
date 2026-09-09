import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import type { UnparsedWireValue } from "@sidecar/wire";
import {
  STORE_SCHEMA_FLOOR,
  STORE_SCHEMA_MIGRATIONS,
  STORE_SCHEMA_STATEMENTS,
  STORE_SCHEMA_VERSION,
} from "./schema.js";

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
 */

export const AGENT_DATABASE_FILE = "agent.sqlite";
const INCREMENTAL_AUTO_VACUUM = 2;

export class StoreDatabase {
  readonly #db: DatabaseSync;
  #transactionDepth = 0;

  private constructor(db: DatabaseSync) {
    this.#db = db;
  }

  /** Opens or creates the database at `location` and brings its schema to this build's version. */
  static open(location: string): StoreDatabase {
    const db = new DatabaseSync(location);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = FULL");
    db.exec("PRAGMA foreign_keys = ON");
    const database = new StoreDatabase(db);
    database.#adoptIncrementalVacuum();
    database.#migrateSchema();
    return database;
  }

  /**
   * Freed pages are handed back to the file system on request rather than
   * kept, so a deletion the disk budget makes is a deletion the file's size
   * shows. A database created before the mode was set is rebuilt once to
   * adopt it; VACUUM cannot run inside a transaction, so it runs here, before
   * the schema migration opens one.
   */
  #adoptIncrementalVacuum(): void {
    // SAFETY: PRAGMA auto_vacuum answers one integer column named auto_vacuum.
    const mode = this.#db.prepare("PRAGMA auto_vacuum").get() as { auto_vacuum: number };
    if (mode.auto_vacuum === INCREMENTAL_AUTO_VACUUM) return;
    this.#db.exec("PRAGMA auto_vacuum = INCREMENTAL");
    this.#db.exec("VACUUM");
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
          for (const step of steps) this.#db.prepare(step.sql).run(...step.params);
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

  prepare(sql: string): StatementSync {
    return this.#db.prepare(sql);
  }

  exec(sql: string): void {
    this.#db.exec(sql);
  }

  /**
   * Runs `work` atomically. The outermost call owns the transaction; a call
   * inside it becomes a savepoint, so an operation that is atomic on its own
   * is also atomic as one step of a larger one, and a failure anywhere rolls
   * the whole outer transaction back.
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
