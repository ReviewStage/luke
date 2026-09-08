import { DatabaseSync, type SQLInputValue, type StatementSync } from "node:sqlite";
import type { AgentId, SessionKey } from "@sidecar/runtime-contracts";
import type { UnparsedWireValue } from "@sidecar/wire";
import { RUNTIME_SCHEMA_STATEMENTS, RUNTIME_SCHEMA_VERSION } from "./schema.js";

/**
 * The agent's database connection, spoken to synchronously. It runs on the
 * store's own worker thread in the app — Electron's main thread never calls
 * it — and in-thread in tests, where the same operations are exercised
 * against a file or `:memory:`. The table groups each have a module of their
 * own over this handle: the brain's envelope, the conversation's history,
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

export class RuntimeDatabase {
  readonly #db: DatabaseSync;
  #transactionDepth = 0;

  private constructor(db: DatabaseSync) {
    this.#db = db;
  }

  /** Opens or creates the database at `location` and brings its schema to this build's version. */
  static open(location: string): RuntimeDatabase {
    const db = new DatabaseSync(location);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = FULL");
    db.exec("PRAGMA foreign_keys = ON");
    const database = new RuntimeDatabase(db);
    database.#migrateSchema();
    return database;
  }

  #migrateSchema(): void {
    this.transaction(() => {
      for (const statement of RUNTIME_SCHEMA_STATEMENTS) this.#db.exec(statement);
      // SAFETY: the schema_version table has one integer column; a row is that column or nothing.
      const row = this.#db.prepare("SELECT version FROM schema_version").get() as
        | { version: number }
        | undefined;
      if (!row) {
        this.#db
          .prepare("INSERT INTO schema_version (version) VALUES (?)")
          .run(RUNTIME_SCHEMA_VERSION);
        return;
      }
      if (row.version !== RUNTIME_SCHEMA_VERSION) {
        throw new Error(
          `runtime database is at schema version ${row.version}, not ${RUNTIME_SCHEMA_VERSION}`,
        );
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

  /** Makes sure the agent and its conversation exist; idempotent. */
  ensureConversation(agentId: AgentId, sessionKey: SessionKey, name: string, now: number): void {
    this.transaction(() => {
      this.#db
        .prepare("INSERT OR IGNORE INTO agents (agent_id, created_at) VALUES (?, ?)")
        .run(agentId, now);
      this.#db
        .prepare(
          "INSERT OR IGNORE INTO conversations (session_key, agent_id, name, created_at) VALUES (?, ?, ?, ?)",
        )
        .run(sessionKey, agentId, name, now);
    });
  }

  /** The conversation's durable Clear cutoff, which outlives the generation whose marker raised it. */
  historyCutoff(sessionKey: SessionKey): number | undefined {
    // SAFETY: the query selects the one nullable integer column the row type names.
    const row = this.#db
      .prepare("SELECT history_cleared_at FROM conversations WHERE session_key = ?")
      .get(sessionKey) as { history_cleared_at: number | null } | undefined;
    return row?.history_cleared_at ?? undefined;
  }

  /** Raises the conversation's durable cutoff to `clearedAt`; never lowers it. */
  raiseHistoryCutoff(sessionKey: SessionKey, clearedAt: number): void {
    this.#db
      .prepare(
        `UPDATE conversations SET history_cleared_at = MAX(COALESCE(history_cleared_at, ?), ?)
         WHERE session_key = ?`,
      )
      .run(clearedAt, clearedAt, sessionKey);
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
