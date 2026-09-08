import type { SQLInputValue } from "node:sqlite";
import {
  type BrainJournalEntry,
  type BrainObservationEntry,
  type BrainPersistedState,
  type BrainRequestRecord,
  type BrainTranscriptCursors,
  brainPersistedStateFromWire,
  legacyStampOf,
} from "@sidecar/brain";
import type { SessionKey } from "@sidecar/runtime-contracts";
import { isWireNumber, isWireString, type WireRecord, type WireValue } from "@sidecar/wire";
import { raiseHistoryCutoff, touchConversation } from "./conversations-table.js";
import { column, nullable, type RuntimeDatabase } from "./database.js";
import { type BrainStateSave, SAVE_KIND } from "./envelope.js";
import { appendTranscript } from "./transcript-table.js";

/**
 * The brain's envelope across its tables: the standing generation and, under
 * it, the model's checkpoint items, the transcript cursors, the requests, and
 * the action receipts. One generation stands per conversation, and replacing
 * it cascades every row it owned away.
 */

/** What a load answers: the standing generation's id, readable or not, and its envelope when it could be read. */
export interface EnvelopeRead {
  /** The generation standing in the tables, readable or not; absent when none stands. */
  generation?: string;
  state?: BrainPersistedState;
  unreadable?: boolean;
}

export interface StandingGeneration {
  sessionId: string;
  /** Whose shape the checkpoint items are; absent on a generation never checkpointed into. */
  checkpointFormat: string | undefined;
  createdAt: number;
  expiresAt: number;
  resetClearedAt: number | undefined;
  resetGenerationId: string | undefined;
  compactionCount: number;
}

export function standingGeneration(
  database: RuntimeDatabase,
  sessionKey: SessionKey,
): StandingGeneration | undefined {
  // SAFETY: the columns selected are the ones the row type names, typed by the schema.
  const row = database
    .prepare(
      `SELECT session_id, created_at, expires_at, reset_cleared_at, reset_generation_id, checkpoint_format, compaction_count
       FROM conversation_sessions WHERE session_key = ?`,
    )
    .get(sessionKey) as
    | {
        session_id: string;
        created_at: number;
        expires_at: number;
        reset_cleared_at: number | null;
        reset_generation_id: string | null;
        checkpoint_format: string | null;
        compaction_count: number;
      }
    | undefined;
  if (!row) return undefined;
  return {
    sessionId: row.session_id,
    checkpointFormat: row.checkpoint_format ?? undefined,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    resetClearedAt: row.reset_cleared_at ?? undefined,
    resetGenerationId: row.reset_generation_id ?? undefined,
    compactionCount: row.compaction_count,
  };
}

/**
 * The envelope as the tables hold it, rebuilt into the envelope's wire shape
 * and admitted by the brain's own reader, so a row this build cannot vouch
 * for makes the whole generation unreadable. The standing generation's id
 * travels beside the answer whether or not its rows could be read: it is the
 * token a writer names to replace it, so an unreadable generation can be
 * repaired by the store that loaded it and by nothing that did not.
 */
export function loadBrainEnvelope(database: RuntimeDatabase, sessionKey: SessionKey): EnvelopeRead {
  const session = standingGeneration(database, sessionKey);
  if (!session) return {};
  const generation = session.sessionId;
  // SAFETY: each query below selects exactly the columns its row type names, typed by the schema.
  const items = database
    .prepare("SELECT item FROM runtime_checkpoints WHERE session_id = ? ORDER BY sequence")
    .all(session.sessionId) as { item: string }[];
  // The stamp lives on the generation row alone, so an empty checkpoint keeps
  // it and an item row says nothing about whose shape it is.
  const stamp = session.checkpointFormat ?? legacyStampOf(items);
  // SAFETY: the three text columns selected are the ones the row type names.
  const cursorRows = database
    .prepare(
      "SELECT provider_id, provider_session_id, cursor FROM observation_cursors WHERE session_id = ?",
    )
    .all(session.sessionId) as {
    provider_id: string;
    provider_session_id: string;
    cursor: string;
  }[];
  // SAFETY: every column of a row is a SQL value; the envelope reader admits each field or refuses the whole.
  const requestRows = database
    .prepare("SELECT * FROM requests WHERE session_id = ? ORDER BY ordinal")
    .all(session.sessionId) as Record<string, SQLInputValue>[];
  // SAFETY: as above, for the receipts.
  const journalRows = database
    .prepare("SELECT * FROM action_receipts WHERE session_id = ? ORDER BY ordinal")
    .all(session.sessionId) as Record<string, SQLInputValue>[];
  // SAFETY: the same three text columns, from the capture cursors' table.
  const captureRows = database
    .prepare(
      "SELECT provider_id, provider_session_id, cursor FROM observation_capture_cursors WHERE session_id = ?",
    )
    .all(session.sessionId) as {
    provider_id: string;
    provider_session_id: string;
    cursor: string;
  }[];
  // SAFETY: the payload column is text; the envelope reader admits each entry or refuses the whole.
  const inboxRows = database
    .prepare("SELECT payload FROM observation_inbox WHERE session_id = ? ORDER BY ordinal")
    .all(session.sessionId) as { payload: string }[];
  const cursors = cursorsFromRows(cursorRows);
  const captureCursors = cursorsFromRows(captureRows);
  let parsedItems: WireValue[];
  let inbox: WireValue[];
  try {
    // SAFETY: JSON.parse returns a wire value; the envelope reader below is the validation.
    parsedItems = items.map((row) => JSON.parse(row.item) as WireValue);
    // SAFETY: as above, for the inbox entries.
    inbox = inboxRows.map((row) => JSON.parse(row.payload) as WireValue);
  } catch {
    return { unreadable: true, generation };
  }
  const wire = {
    version: 2,
    generationId: session.sessionId,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    ...(stamp !== undefined ? { checkpointFormat: stamp } : undefined),
    items: parsedItems,
    compactionCount: session.compactionCount,
    cursors,
    captureCursors,
    inbox,
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
  return state ? { state, generation } : { unreadable: true, generation };
}

/**
 * Makes the envelope given the one that stands, if the save's generation is
 * the one standing. A replacement replaces the generation it expected, its
 * rows cascading away with it; an amendment changes the generation it names.
 * A writer naming some other generation — or none, when one stands — is
 * stale, and is refused without anything of what it carried touching the
 * tables.
 */
export function saveBrainEnvelope(
  database: RuntimeDatabase,
  sessionKey: SessionKey,
  save: BrainStateSave,
): boolean {
  return database.transaction(() => {
    const standing = standingGeneration(database, sessionKey);
    if (save.kind === SAVE_KIND.REPLACE) {
      if (standing?.sessionId !== save.expectGeneration) return false;
      replaceGeneration(database, sessionKey, save.state);
      appendTranscript(database, sessionKey, save.state.generationId, save.transcript ?? []);
      touchConversation(database, sessionKey, save.state.createdAt);
      return true;
    }
    if (standing?.sessionId !== save.generationId) return false;
    const { delta } = save;
    const sessionId = save.generationId;
    appendTranscript(database, sessionKey, sessionId, save.transcript ?? []);
    if (delta.checkpointFormat) {
      database
        .prepare("UPDATE conversation_sessions SET checkpoint_format = ? WHERE session_id = ?")
        .run(nullable(delta.checkpointFormat.stamp), sessionId);
    }
    if (delta.compactionCount !== undefined) {
      database
        .prepare("UPDATE conversation_sessions SET compaction_count = ? WHERE session_id = ?")
        .run(delta.compactionCount, sessionId);
    }
    if (delta.items) {
      database
        .prepare("DELETE FROM runtime_checkpoints WHERE session_id = ? AND sequence >= ?")
        .run(sessionId, delta.items.keepPrefix);
      insertItems(database, sessionId, delta.items.append, delta.items.keepPrefix);
    }
    if (delta.cursors) {
      database.prepare("DELETE FROM observation_cursors WHERE session_id = ?").run(sessionId);
      insertCursors(database, sessionId, delta.cursors);
    }
    if (delta.captureCursors) {
      database
        .prepare("DELETE FROM observation_capture_cursors WHERE session_id = ?")
        .run(sessionId);
      insertCaptureCursors(database, sessionId, delta.captureCursors);
    }
    if (delta.inbox) {
      database.prepare("DELETE FROM observation_inbox WHERE session_id = ?").run(sessionId);
      insertInbox(database, sessionId, delta.inbox);
    }
    if (delta.requests) {
      const remove = database.prepare("DELETE FROM requests WHERE run_id = ?");
      for (const runId of delta.requests.remove) remove.run(runId);
      for (const { ordinal, record } of delta.requests.upsert) {
        upsertRequest(database, sessionId, ordinal, record);
      }
    }
    if (delta.journal) {
      const remove = database.prepare(
        "DELETE FROM action_receipts WHERE run_id = ? AND call_id = ?",
      );
      for (const { runId, callId } of delta.journal.remove) remove.run(runId, callId);
      for (const { ordinal, entry } of delta.journal.upsert) {
        upsertJournal(database, sessionId, ordinal, entry);
      }
    }
    return true;
  });
}

function replaceGeneration(
  database: RuntimeDatabase,
  sessionKey: SessionKey,
  state: BrainPersistedState,
): void {
  database.prepare("DELETE FROM conversation_sessions WHERE session_key = ?").run(sessionKey);
  database
    .prepare(
      `INSERT INTO conversation_sessions
         (session_id, session_key, created_at, expires_at, reset_cleared_at, reset_generation_id, checkpoint_format, compaction_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      state.generationId,
      sessionKey,
      state.createdAt,
      state.expiresAt,
      nullable(state.reset?.clearedAt),
      nullable(state.reset?.generationId),
      nullable(stampOf(state)),
      state.compactionCount,
    );
  if (state.reset) raiseHistoryCutoff(database, sessionKey, state.reset.clearedAt);
  insertItems(database, state.generationId, state.items, 0);
  insertCursors(database, state.generationId, state.cursors);
  insertCaptureCursors(database, state.generationId, state.captureCursors);
  insertInbox(database, state.generationId, state.inbox);
  state.requests.forEach((record, ordinal) => {
    upsertRequest(database, state.generationId, ordinal, record);
  });
  state.journal.forEach((entry, ordinal) => {
    upsertJournal(database, state.generationId, ordinal, entry);
  });
}

function stampOf(state: BrainPersistedState): string | undefined {
  return state.checkpointFormat ?? legacyStampOf(state.items);
}

function insertItems(
  database: RuntimeDatabase,
  sessionId: string,
  items: readonly unknown[],
  from: number,
): void {
  if (items.length === 0) return;
  const insert = database.prepare(
    "INSERT INTO runtime_checkpoints (session_id, sequence, item) VALUES (?, ?, ?)",
  );
  items.forEach((item, offset) => {
    insert.run(sessionId, from + offset, JSON.stringify(item));
  });
}

function insertCursors(
  database: RuntimeDatabase,
  sessionId: string,
  cursors: BrainPersistedState["cursors"],
): void {
  const insert = database.prepare(
    "INSERT INTO observation_cursors (session_id, provider_id, provider_session_id, cursor) VALUES (?, ?, ?, ?)",
  );
  for (const [providerId, sessions] of Object.entries(cursors)) {
    for (const [providerSessionId, cursor] of Object.entries(sessions)) {
      insert.run(sessionId, providerId, providerSessionId, cursor);
    }
  }
}

function insertCaptureCursors(
  database: RuntimeDatabase,
  sessionId: string,
  cursors: BrainPersistedState["captureCursors"],
): void {
  const insert = database.prepare(
    "INSERT INTO observation_capture_cursors (session_id, provider_id, provider_session_id, cursor) VALUES (?, ?, ?, ?)",
  );
  for (const [providerId, sessions] of Object.entries(cursors)) {
    for (const [providerSessionId, cursor] of Object.entries(sessions)) {
      insert.run(sessionId, providerId, providerSessionId, cursor);
    }
  }
}

function insertInbox(
  database: RuntimeDatabase,
  sessionId: string,
  inbox: readonly BrainObservationEntry[],
): void {
  if (inbox.length === 0) return;
  const insert = database.prepare(
    "INSERT INTO observation_inbox (session_id, ordinal, entry_id, payload) VALUES (?, ?, ?, ?)",
  );
  inbox.forEach((entry, ordinal) => {
    insert.run(sessionId, ordinal, entry.id, JSON.stringify(entry));
  });
}

function cursorsFromRows(
  rows: readonly { provider_id: string; provider_session_id: string; cursor: string }[],
): BrainTranscriptCursors {
  const cursors: Record<string, Record<string, string>> = {};
  for (const row of rows) {
    cursors[row.provider_id] ??= {};
    const provider = cursors[row.provider_id];
    if (provider) provider[row.provider_session_id] = row.cursor;
  }
  return cursors;
}

function upsertRequest(
  database: RuntimeDatabase,
  sessionId: string,
  ordinal: number,
  record: BrainRequestRecord,
): void {
  database
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
      nullable(record.startedAt),
      nullable(record.settledAt),
      nullable(record.text),
      nullable(record.failure),
      record.performedActs,
      record.unknownActs,
      nullable(record.askRecordedAt),
      nullable(record.historyRecordedAt),
    );
}

function upsertJournal(
  database: RuntimeDatabase,
  sessionId: string,
  ordinal: number,
  entry: BrainJournalEntry,
): void {
  database
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
      nullable(entry.outputJson),
      nullable(entry.settledAt),
    );
}

function requestWire(row: Record<string, SQLInputValue>): WireRecord {
  return {
    runId: column(row.run_id, isWireString),
    submissionId: column(row.submission_id, isWireString),
    origin: column(row.origin, isWireString),
    question: column(row.question, isWireString),
    status: column(row.status, isWireString),
    revision: column(row.revision, isWireNumber),
    acceptedAt: column(row.accepted_at, isWireNumber),
    performedActs: column(row.performed_acts, isWireNumber),
    unknownActs: column(row.unknown_acts, isWireNumber),
    ...optionalField("startedAt", column(row.started_at, isWireNumber)),
    ...optionalField("settledAt", column(row.settled_at, isWireNumber)),
    ...optionalField("text", column(row.text, isWireString)),
    ...optionalField("failure", column(row.failure, isWireString)),
    ...optionalField("askRecordedAt", column(row.ask_recorded_at, isWireNumber)),
    ...optionalField("historyRecordedAt", column(row.history_recorded_at, isWireNumber)),
  };
}

function journalWire(row: Record<string, SQLInputValue>): WireRecord {
  return {
    runId: column(row.run_id, isWireString),
    callId: column(row.call_id, isWireString),
    name: column(row.name, isWireString),
    argumentsJson: column(row.arguments_json, isWireString),
    startedAt: column(row.started_at, isWireNumber),
    ...optionalField("outputJson", column(row.output_json, isWireString)),
    ...optionalField("settledAt", column(row.settled_at, isWireNumber)),
  };
}

/** A nullable column as the envelope reader expects it: present with its value, or absent. */
function optionalField(name: string, value: WireValue): WireRecord {
  return value === null ? {} : { [name]: value };
}
