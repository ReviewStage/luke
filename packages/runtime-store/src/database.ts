import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { isRememberedFact, maximumRememberedFacts, type RememberedFact } from "@sidecar/acts";
import {
  type BrainJournalEntry,
  type BrainPersistedState,
  type BrainRequestRecord,
  type BrainStateLoad,
  brainPersistedStateFromWire,
} from "@sidecar/brain";
import type { ConversationEntry } from "@sidecar/realtime";
import type { AgentId, HistoryAppendOutcome, SessionKey } from "@sidecar/runtime-contracts";
import {
  isWireNumber,
  isWireString,
  type UnparsedWireValue,
  type WireRecord,
  type WireValue,
} from "@sidecar/wire";
import type { BrainStateSave } from "./envelope.js";
import {
  HISTORY_RETENTION,
  historyEntryAdmitted,
  historyEntryFromPayload,
  historyEventKey,
  historyPayload,
} from "./history.js";
import { CHECKPOINT_FORMAT, RUNTIME_SCHEMA_STATEMENTS, RUNTIME_SCHEMA_VERSION } from "./schema.js";

/**
 * The agent's database, spoken to synchronously. This class runs on the
 * store's own worker thread in the app — Electron's main thread never calls
 * it — and in-thread in tests, where the same operations are exercised
 * against a file or `:memory:`.
 *
 * Every operation that changes more than one row runs in one transaction,
 * with WAL journaling and full synchronous commits, so a crash leaves the
 * database at the envelope before or the envelope after a save, never
 * between. Foreign keys cascade a session's rows with it: replacing a
 * generation deletes the old one's checkpoints, cursors, requests, and
 * receipts in the same statement that removes the session.
 */

export const AGENT_DATABASE_FILE = "agent.sqlite";

/** The brain's load answer with the token the repository client compares its saves against. */
export interface RuntimeBrainStateLoad extends BrainStateLoad {
  /** The generation standing in the tables, readable or not; absent when none stands. */
  standingGeneration?: string;
}

interface StandingSession {
  sessionId: string;
  createdAt: number;
  expiresAt: number;
  resetClearedAt: number | undefined;
  resetGenerationId: string | undefined;
}

function optional(value: number | undefined): SQLInputValue {
  return value === undefined ? null : value;
}

function optionalText(value: string | undefined): SQLInputValue {
  return value === undefined ? null : value;
}

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

  /**
   * Runs `work` atomically. The outermost call owns the transaction; a call
   * inside it becomes a savepoint, so an operation that is atomic on its own
   * is also atomic as one step of a larger one — the legacy import writes
   * a generation, a thread, the facts, and every receipt as one commit this
   * way — and a failure anywhere rolls the whole outer transaction back.
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

  #standingSession(sessionKey: SessionKey): StandingSession | undefined {
    // SAFETY: the columns selected are the ones the row type names, typed by the schema.
    const row = this.#db
      .prepare(
        `SELECT session_id, created_at, expires_at, reset_cleared_at, reset_generation_id
         FROM conversation_sessions WHERE session_key = ?`,
      )
      .get(sessionKey) as
      | {
          session_id: string;
          created_at: number;
          expires_at: number;
          reset_cleared_at: number | null;
          reset_generation_id: string | null;
        }
      | undefined;
    if (!row) return undefined;
    return {
      sessionId: row.session_id,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      resetClearedAt: row.reset_cleared_at ?? undefined,
      resetGenerationId: row.reset_generation_id ?? undefined,
    };
  }

  /**
   * The Clear cutoff before which no history line may stand: the later of the
   * standing generation's marker and the conversation's own durable cutoff,
   * which outlives the generation.
   */
  clearedAt(sessionKey: SessionKey): number | undefined {
    // SAFETY: the query selects the one nullable integer column the row type names.
    const row = this.#db
      .prepare("SELECT history_cleared_at FROM conversations WHERE session_key = ?")
      .get(sessionKey) as { history_cleared_at: number | null } | undefined;
    const durable = row?.history_cleared_at ?? undefined;
    const marker = this.#standingSession(sessionKey)?.resetClearedAt;
    if (durable === undefined) return marker;
    return marker === undefined ? durable : Math.max(durable, marker);
  }

  /** Raises the conversation's durable cutoff to `clearedAt`; never lowers it. */
  #raiseHistoryCutoff(sessionKey: SessionKey, clearedAt: number): void {
    this.#db
      .prepare(
        `UPDATE conversations SET history_cleared_at = MAX(COALESCE(history_cleared_at, ?), ?)
         WHERE session_key = ?`,
      )
      .run(clearedAt, clearedAt, sessionKey);
  }

  /**
   * The envelope as the tables hold it, rebuilt into the same wire shape the
   * legacy file had and admitted by the same reader, so a row this build
   * cannot vouch for makes the whole generation unreadable exactly as a bad
   * line in the file did. The standing generation's id travels beside the
   * answer whether or not its rows could be read: it is the token a writer
   * names to replace it, so an unreadable generation can be repaired by the
   * store that loaded it and by nothing that did not.
   */
  loadBrainState(sessionKey: SessionKey): RuntimeBrainStateLoad {
    const session = this.#standingSession(sessionKey);
    if (!session) return {};
    const standingGeneration = session.sessionId;
    // SAFETY: each query below selects exactly the columns its row type names, typed by the schema.
    const items = this.#db
      .prepare("SELECT item FROM runtime_checkpoints WHERE session_id = ? ORDER BY sequence")
      .all(session.sessionId) as { item: string }[];
    // SAFETY: the three text columns selected are the ones the row type names.
    const cursorRows = this.#db
      .prepare(
        "SELECT provider_id, provider_session_id, cursor FROM observation_cursors WHERE session_id = ?",
      )
      .all(session.sessionId) as {
      provider_id: string;
      provider_session_id: string;
      cursor: string;
    }[];
    // SAFETY: every column of a row is a SQL value; the envelope reader admits each field or refuses the whole.
    const requestRows = this.#db
      .prepare("SELECT * FROM requests WHERE session_id = ? ORDER BY ordinal")
      .all(session.sessionId) as Record<string, SQLInputValue>[];
    // SAFETY: as above, for the receipts.
    const journalRows = this.#db
      .prepare("SELECT * FROM action_receipts WHERE session_id = ? ORDER BY ordinal")
      .all(session.sessionId) as Record<string, SQLInputValue>[];
    const cursors: Record<string, Record<string, string>> = {};
    for (const row of cursorRows) {
      cursors[row.provider_id] ??= {};
      const provider = cursors[row.provider_id];
      if (provider) provider[row.provider_session_id] = row.cursor;
    }
    let parsedItems: WireValue[];
    try {
      // SAFETY: JSON.parse returns a wire value; the envelope reader below is the validation.
      parsedItems = items.map((row) => JSON.parse(row.item) as WireValue);
    } catch {
      return { unreadable: true, standingGeneration };
    }
    const wire = {
      version: 2,
      generationId: session.sessionId,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      items: parsedItems,
      cursors,
      requests: requestRows.map(requestWire),
      journal: journalRows.map(journalWire),
      ...(session.resetClearedAt !== undefined
        ? {
            reset: {
              clearedAt: session.resetClearedAt,
              ...(session.resetGenerationId !== undefined
                ? { generationId: session.resetGenerationId }
                : undefined),
            },
          }
        : undefined),
    } satisfies WireRecord;
    const state = brainPersistedStateFromWire(wire);
    return state ? { state, standingGeneration } : { unreadable: true, standingGeneration };
  }

  /**
   * Makes the envelope given the one that stands, if the generation the
   * writer expected is the one standing. A whole envelope then replaces that
   * generation, its rows cascading away with it; a delta then changes the
   * generation it names, which is the same one. A writer expecting some other
   * generation — or none, when one stands — is stale, and is refused without
   * anything of what it carried touching the tables.
   */
  saveBrainState(sessionKey: SessionKey, save: BrainStateSave): boolean {
    return this.transaction(() => {
      const standing = this.#standingSession(sessionKey);
      if (standing?.sessionId !== save.expectGeneration) return false;
      if ("full" in save) {
        this.#replaceGeneration(sessionKey, save.full);
        return true;
      }
      if (!standing || standing.sessionId !== save.delta.generationId) return false;
      const { delta } = save;
      const sessionId = delta.generationId;
      if (delta.items) {
        this.#db
          .prepare("DELETE FROM runtime_checkpoints WHERE session_id = ? AND sequence >= ?")
          .run(sessionId, delta.items.keepPrefix);
        this.#insertItems(sessionId, delta.items.append, delta.items.keepPrefix);
      }
      if (delta.cursors) {
        this.#db.prepare("DELETE FROM observation_cursors WHERE session_id = ?").run(sessionId);
        this.#insertCursors(sessionId, delta.cursors);
      }
      if (delta.requests) {
        const remove = this.#db.prepare("DELETE FROM requests WHERE run_id = ?");
        for (const runId of delta.requests.remove) remove.run(runId);
        for (const { ordinal, record } of delta.requests.upsert) {
          this.#upsertRequest(sessionId, ordinal, record);
        }
      }
      if (delta.journal) {
        const remove = this.#db.prepare(
          "DELETE FROM action_receipts WHERE run_id = ? AND call_id = ?",
        );
        for (const { runId, callId } of delta.journal.remove) remove.run(runId, callId);
        for (const { ordinal, entry } of delta.journal.upsert) {
          this.#upsertJournal(sessionId, ordinal, entry);
        }
      }
      return true;
    });
  }

  #replaceGeneration(sessionKey: SessionKey, state: BrainPersistedState): void {
    this.#db.prepare("DELETE FROM conversation_sessions WHERE session_key = ?").run(sessionKey);
    this.#db
      .prepare(
        `INSERT INTO conversation_sessions
           (session_id, session_key, created_at, expires_at, reset_cleared_at, reset_generation_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        state.generationId,
        sessionKey,
        state.createdAt,
        state.expiresAt,
        optional(state.reset?.clearedAt),
        optionalText(state.reset?.generationId),
      );
    if (state.reset) this.#raiseHistoryCutoff(sessionKey, state.reset.clearedAt);
    this.#insertItems(state.generationId, state.items, 0);
    this.#insertCursors(state.generationId, state.cursors);
    state.requests.forEach((record, ordinal) => {
      this.#upsertRequest(state.generationId, ordinal, record);
    });
    state.journal.forEach((entry, ordinal) => {
      this.#upsertJournal(state.generationId, ordinal, entry);
    });
  }

  #insertItems(sessionId: string, items: readonly unknown[], from: number): void {
    const insert = this.#db.prepare(
      "INSERT INTO runtime_checkpoints (session_id, sequence, format, item) VALUES (?, ?, ?, ?)",
    );
    items.forEach((item, offset) => {
      insert.run(
        sessionId,
        from + offset,
        CHECKPOINT_FORMAT.OPENAI_RESPONSES_INPUT_V1,
        JSON.stringify(item),
      );
    });
  }

  #insertCursors(sessionId: string, cursors: BrainPersistedState["cursors"]): void {
    const insert = this.#db.prepare(
      "INSERT INTO observation_cursors (session_id, provider_id, provider_session_id, cursor) VALUES (?, ?, ?, ?)",
    );
    for (const [providerId, sessions] of Object.entries(cursors)) {
      for (const [providerSessionId, cursor] of Object.entries(sessions)) {
        insert.run(sessionId, providerId, providerSessionId, cursor);
      }
    }
  }

  #upsertRequest(sessionId: string, ordinal: number, record: BrainRequestRecord): void {
    this.#db
      .prepare(
        `INSERT OR REPLACE INTO requests
           (run_id, session_id, ordinal, submission_id, origin, question, status, revision,
            accepted_at, started_at, settled_at, text, failure, performed_acts, unknown_acts,
            ask_recorded_at, history_recorded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.runId,
        sessionId,
        ordinal,
        record.submissionId,
        record.origin,
        record.question,
        record.status,
        record.revision,
        record.acceptedAt,
        optional(record.startedAt),
        optional(record.settledAt),
        optionalText(record.text),
        optionalText(record.failure),
        record.performedActs,
        record.unknownActs,
        optional(record.askRecordedAt),
        optional(record.historyRecordedAt),
      );
  }

  #upsertJournal(sessionId: string, ordinal: number, entry: BrainJournalEntry): void {
    this.#db
      .prepare(
        `INSERT OR REPLACE INTO action_receipts
           (run_id, call_id, session_id, ordinal, name, arguments_json, started_at, output_json, settled_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.runId,
        entry.callId,
        sessionId,
        ordinal,
        entry.name,
        entry.argumentsJson,
        entry.startedAt,
        optionalText(entry.outputJson),
        optional(entry.settledAt),
      );
  }

  /**
   * Appends lines to the conversation, idempotently. A line the thread
   * already holds by value is not written again — though it may now learn
   * the run it opened — and a run's ask or end already published is not
   * published twice however many windows report it. Each admitted line is
   * stamped with the generation standing at the write. Retention runs after
   * the appends, against the clock given, so the table never holds more than
   * the thread may show.
   */
  appendHistory(
    sessionKey: SessionKey,
    entries: readonly ConversationEntry[],
    now: number,
  ): HistoryAppendOutcome<ConversationEntry> {
    return this.transaction(() => {
      const standing = this.#standingSession(sessionKey);
      const clearedAt = this.clearedAt(sessionKey);
      let changed = false;
      for (const entry of entries) {
        if (!historyEntryAdmitted(entry, now, clearedAt)) continue;
        if (this.#appendOne(sessionKey, standing?.sessionId, entry)) changed = true;
      }
      if (changed) this.#retainHistory(sessionKey, now);
      return { changed, entries: this.#listHistory(sessionKey, now, clearedAt) };
    });
  }

  #appendOne(
    sessionKey: SessionKey,
    sessionId: string | undefined,
    entry: ConversationEntry & { recordedAt: number },
  ): boolean {
    const eventKey = historyEventKey(entry);
    // SAFETY: the two columns selected are the ones the row type names, typed by the schema.
    const held = this.#db
      .prepare(
        "SELECT sequence, request_id FROM history_events WHERE session_key = ? AND event_key = ?",
      )
      .get(sessionKey, eventKey) as { sequence: number; request_id: string | null } | undefined;
    if (held) {
      if (held.request_id !== null || entry.requestId === undefined) return false;
      if (this.#published(sessionKey, entry.requestId, entry.kind)) return false;
      this.#db
        .prepare(
          "UPDATE history_events SET request_id = ?, payload = ? WHERE session_key = ? AND sequence = ?",
        )
        .run(entry.requestId, historyPayload(entry), sessionKey, held.sequence);
      this.#publish(sessionKey, entry.requestId, entry.kind, held.sequence, entry.recordedAt);
      return true;
    }
    if (entry.requestId !== undefined && this.#published(sessionKey, entry.requestId, entry.kind)) {
      return false;
    }
    const sequence = this.#nextHistorySequence(sessionKey);
    this.#db
      .prepare(
        `INSERT INTO history_events
           (session_key, sequence, session_id, event_key, kind, words, recorded_at, request_id,
            provider_id, provider_session_id, payload)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        sessionKey,
        sequence,
        optionalText(sessionId),
        eventKey,
        entry.kind,
        entry.words,
        entry.recordedAt,
        optionalText(entry.requestId),
        optionalText(entry.identity?.providerId),
        optionalText(entry.identity?.providerSessionId),
        historyPayload(entry),
      );
    if (entry.requestId !== undefined) {
      this.#publish(sessionKey, entry.requestId, entry.kind, sequence, entry.recordedAt);
    }
    return true;
  }

  /** The conversation's next sequence, taken from its counter so a number is never handed out twice. */
  #nextHistorySequence(sessionKey: SessionKey): number {
    // SAFETY: RETURNING yields the one integer expression named `sequence`, or no row.
    const row = this.#db
      .prepare(
        `UPDATE conversations SET next_history_sequence = next_history_sequence + 1
         WHERE session_key = ? RETURNING next_history_sequence - 1 AS sequence`,
      )
      .get(sessionKey) as { sequence: number } | undefined;
    if (!row) throw new Error(`no conversation stands at ${sessionKey}`);
    return row.sequence;
  }

  #published(sessionKey: SessionKey, requestId: string, kind: string): boolean {
    return (
      this.#db
        .prepare("SELECT 1 FROM publications WHERE session_key = ? AND request_id = ? AND kind = ?")
        .get(sessionKey, requestId, kind) !== undefined
    );
  }

  #publish(
    sessionKey: SessionKey,
    requestId: string,
    kind: string,
    sequence: number,
    recordedAt: number,
  ): void {
    this.#db
      .prepare(
        `INSERT OR REPLACE INTO publications (session_key, request_id, kind, event_sequence, recorded_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(sessionKey, requestId, kind, sequence, recordedAt);
  }

  /** Lets go of lines past the age bound and beyond the count, oldest first, publications with them. */
  #retainHistory(sessionKey: SessionKey, now: number): void {
    this.#db
      .prepare("DELETE FROM history_events WHERE session_key = ? AND recorded_at < ?")
      .run(sessionKey, now - HISTORY_RETENTION.MAXIMUM_AGE_MS);
    this.#db
      .prepare(
        `DELETE FROM history_events WHERE session_key = ? AND sequence IN (
           SELECT sequence FROM history_events WHERE session_key = ?
           ORDER BY recorded_at DESC, sequence DESC LIMIT -1 OFFSET ?
         )`,
      )
      .run(sessionKey, sessionKey, HISTORY_RETENTION.MAXIMUM_ENTRIES);
    this.#db
      .prepare(
        `DELETE FROM publications WHERE session_key = ? AND event_sequence NOT IN (
           SELECT sequence FROM history_events WHERE session_key = ?
         )`,
      )
      .run(sessionKey, sessionKey);
  }

  /** The thread as the panel draws it: retained lines in the order they happened, oldest first. */
  listHistory(sessionKey: SessionKey, now: number): readonly ConversationEntry[] {
    return this.#listHistory(sessionKey, now, this.clearedAt(sessionKey));
  }

  #listHistory(
    sessionKey: SessionKey,
    now: number,
    clearedAt: number | undefined,
  ): readonly ConversationEntry[] {
    // SAFETY: the query selects the one text column the row type names.
    const rows = this.#db
      .prepare(
        `SELECT payload FROM history_events
         WHERE session_key = ? AND recorded_at <= ? AND recorded_at >= ? AND recorded_at > ?
         ORDER BY recorded_at DESC, sequence DESC LIMIT ?`,
      )
      .all(
        sessionKey,
        now,
        now - HISTORY_RETENTION.MAXIMUM_AGE_MS,
        clearedAt ?? -1,
        HISTORY_RETENTION.MAXIMUM_ENTRIES,
      ) as { payload: string }[];
    const entries: ConversationEntry[] = [];
    for (const row of rows.reverse()) {
      const entry = historyEntryFromPayload(row.payload);
      if (entry) entries.push(entry);
    }
    return entries;
  }

  /** The Clear's erasure of the thread: every line at or before the cutoff goes, publications with it. */
  clearHistoryAtOrBefore(sessionKey: SessionKey, clearedAt: number): void {
    this.transaction(() => {
      this.#raiseHistoryCutoff(sessionKey, clearedAt);
      this.#db
        .prepare("DELETE FROM history_events WHERE session_key = ? AND recorded_at <= ?")
        .run(sessionKey, clearedAt);
      this.#db
        .prepare("DELETE FROM publications WHERE session_key = ? AND recorded_at <= ?")
        .run(sessionKey, clearedAt);
    });
  }

  /** The sequences the table holds for the conversation, in order; for tests and diagnostics. */
  historySequences(sessionKey: SessionKey): readonly number[] {
    // SAFETY: the query selects the one integer column the row type names.
    const rows = this.#db
      .prepare("SELECT sequence FROM history_events WHERE session_key = ? ORDER BY sequence")
      .all(sessionKey) as { sequence: number }[];
    return rows.map((row) => row.sequence);
  }

  /** The distinct generations the conversation's lines were written under; for tests and diagnostics. */
  historySessionIds(sessionKey: SessionKey): readonly (string | undefined)[] {
    // SAFETY: the query selects the one nullable text column the row type names.
    const rows = this.#db
      .prepare(
        "SELECT DISTINCT session_id FROM history_events WHERE session_key = ? ORDER BY session_id",
      )
      .all(sessionKey) as { session_id: string | null }[];
    return rows.map((row) => row.session_id ?? undefined);
  }

  /** How many lines the table holds for the conversation, retention or not; for tests and diagnostics. */
  countHistory(sessionKey: SessionKey): number {
    // SAFETY: COUNT(*) yields one integer named `count`.
    const row = this.#db
      .prepare("SELECT COUNT(*) AS count FROM history_events WHERE session_key = ?")
      .get(sessionKey) as { count: number };
    return row.count;
  }

  /**
   * Makes the list given the facts Luke remembers, whole: the remember and
   * forget acts compute the next list from the one they read and hand it
   * here, as they handed it to the file before. The cap and the no-duplicate
   * rules are the list's own; a list past them is refused rather than cut.
   */
  replacePersonalFacts(facts: readonly RememberedFact[]): boolean {
    if (facts.length > maximumRememberedFacts) return false;
    if (!facts.every((fact) => isRememberedFact({ id: fact.id, words: fact.words }))) return false;
    if (new Set(facts.map((fact) => fact.words)).size !== facts.length) return false;
    if (new Set(facts.map((fact) => fact.id)).size !== facts.length) return false;
    this.transaction(() => {
      this.#db.exec("DELETE FROM personal_facts");
      const insert = this.#db.prepare(
        "INSERT INTO personal_facts (id, ordinal, words) VALUES (?, ?, ?)",
      );
      facts.forEach((fact, ordinal) => {
        insert.run(fact.id, ordinal, fact.words);
      });
    });
    return true;
  }

  personalFacts(): readonly RememberedFact[] {
    // SAFETY: the two text columns selected are the ones the row type names.
    const rows = this.#db
      .prepare("SELECT id, words FROM personal_facts ORDER BY ordinal")
      .all() as { id: string; words: string }[];
    return rows.map((row) => ({ id: row.id, words: row.words }));
  }
}

function requestWire(row: Record<string, SQLInputValue>): WireRecord {
  return {
    runId: text(row.run_id),
    submissionId: text(row.submission_id),
    origin: text(row.origin),
    question: text(row.question),
    status: text(row.status),
    revision: number(row.revision),
    acceptedAt: number(row.accepted_at),
    performedActs: number(row.performed_acts),
    unknownActs: number(row.unknown_acts),
    ...optionalField("startedAt", number(row.started_at)),
    ...optionalField("settledAt", number(row.settled_at)),
    ...optionalField("text", text(row.text)),
    ...optionalField("failure", text(row.failure)),
    ...optionalField("askRecordedAt", number(row.ask_recorded_at)),
    ...optionalField("historyRecordedAt", number(row.history_recorded_at)),
  };
}

function journalWire(row: Record<string, SQLInputValue>): WireRecord {
  return {
    runId: text(row.run_id),
    callId: text(row.call_id),
    name: text(row.name),
    argumentsJson: text(row.arguments_json),
    startedAt: number(row.started_at),
    ...optionalField("outputJson", text(row.output_json)),
    ...optionalField("settledAt", number(row.settled_at)),
  };
}

/** A nullable column as the envelope reader expects it: present with its value, or absent. */
function optionalField(name: string, value: WireValue): WireRecord {
  return value === null ? {} : { [name]: value };
}

/**
 * A column read as the wire value it is, so the envelope reader — not this
 * file — decides what is admitted; a column of the wrong type reads as an
 * absent field, which the reader refuses.
 */
function text(value: SQLInputValue | undefined): WireValue {
  const wire = columnValue(value);
  return isWireString(wire) ? wire : null;
}

function number(value: SQLInputValue | undefined): WireValue {
  const wire = columnValue(value);
  return isWireNumber(wire) ? wire : null;
}

function columnValue(value: SQLInputValue | undefined): UnparsedWireValue {
  // SAFETY: these tables declare only TEXT and INTEGER columns, read as strings and numbers; a
  // blob or bigint would be a schema violation, and the wire guards then refuse the field.
  return value as UnparsedWireValue;
}
