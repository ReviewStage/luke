import * as Client from "@effect/sql/SqlClient";
import type { SqlError } from "@effect/sql/SqlError";
import * as SqlSchema from "@effect/sql/SqlSchema";
import type { SessionKey } from "@sidecar/runtime/vocabulary";
import type { WireRecord, WireValue } from "@sidecar/wire";
import { Effect, Option, Schema } from "effect";
import {
  type BrainPersistedState,
  type BrainTranscriptCursors,
  brainPersistedStateFromWire,
} from "../envelope.js";
import type { BrainJournalEntry } from "../journal.js";
import type { BrainObservationEntry } from "../observation-inbox.js";
import type { BrainRequestRecord } from "../requests.js";
import { raiseConversationCutoffEffect, touchConversationEffect } from "./conversations-table.js";
import type { StoreDatabase } from "./database.js";
import { type BrainStateSave, SAVE_KIND } from "./envelope.js";
import { columnsDecoded } from "./rows.js";
import { appendTranscriptEffect } from "./transcript-table.js";

/**
 * The brain's envelope across its tables: the standing generation and, under
 * it, the model's checkpoint items, the transcript cursors, the requests, and
 * the action receipts. One generation stands per conversation, and replacing
 * it cascades every row it owned away.
 *
 * Every read here decodes its columns through a schema declared beside its
 * statement rather than a cast, and a save is one transaction over the
 * client: the standing generation is read inside it and compared with the one
 * the writer named, so the compare and the set cannot be parted, and a writer
 * whose picture is stale is refused with nothing of what it carried touching
 * the tables. What a stored payload holds is the other half and stays what it
 * was: an item or an inbox entry this build cannot read makes the whole
 * generation unreadable, because a payload carries what an earlier build
 * wrote and a column carries what this module wrote.
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

const GenerationRow = Schema.Struct({
  session_id: Schema.String,
  created_at: Schema.Number,
  expires_at: Schema.Number,
  reset_cleared_at: Schema.NullOr(Schema.Number),
  reset_generation_id: Schema.NullOr(Schema.String),
  checkpoint_format: Schema.NullOr(Schema.String),
  compaction_count: Schema.Number,
});

type GenerationRow = Schema.Schema.Type<typeof GenerationRow>;

const generationRowAt = SqlSchema.findOne({
  Request: Schema.String,
  Result: GenerationRow,
  execute: (key) =>
    Effect.flatMap(
      Client.SqlClient,
      (sql) =>
        sql`SELECT session_id, created_at, expires_at, reset_cleared_at, reset_generation_id,
                   checkpoint_format, compaction_count
            FROM conversation_sessions WHERE session_key = ${key}`,
    ),
});

function generationFromRow(row: GenerationRow): StandingGeneration {
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

export const standingGenerationEffect = (
  key: SessionKey,
): Effect.Effect<StandingGeneration | undefined, SqlError, Client.SqlClient> =>
  Effect.map(columnsDecoded(generationRowAt(key)), (row) =>
    Option.match(row, { onNone: () => undefined, onSome: generationFromRow }),
  );

const itemRowsOf = SqlSchema.findAll({
  Request: Schema.String,
  Result: Schema.Struct({ item: Schema.String }),
  execute: (sessionId) =>
    Effect.flatMap(
      Client.SqlClient,
      (sql) =>
        sql`SELECT item FROM runtime_checkpoints WHERE session_id = ${sessionId} ORDER BY sequence`,
    ),
});

const CursorRow = Schema.Struct({
  provider_id: Schema.String,
  provider_session_id: Schema.String,
  cursor: Schema.String,
});

type CursorRow = Schema.Schema.Type<typeof CursorRow>;

const cursorRowsOf = SqlSchema.findAll({
  Request: Schema.String,
  Result: CursorRow,
  execute: (sessionId) =>
    Effect.flatMap(
      Client.SqlClient,
      (sql) =>
        sql`SELECT provider_id, provider_session_id, cursor
            FROM observation_cursors WHERE session_id = ${sessionId}`,
    ),
});

const captureCursorRowsOf = SqlSchema.findAll({
  Request: Schema.String,
  Result: CursorRow,
  execute: (sessionId) =>
    Effect.flatMap(
      Client.SqlClient,
      (sql) =>
        sql`SELECT provider_id, provider_session_id, cursor
            FROM observation_capture_cursors WHERE session_id = ${sessionId}`,
    ),
});

const inboxRowsOf = SqlSchema.findAll({
  Request: Schema.String,
  Result: Schema.Struct({ payload: Schema.String }),
  execute: (sessionId) =>
    Effect.flatMap(
      Client.SqlClient,
      (sql) =>
        sql`SELECT payload FROM observation_inbox WHERE session_id = ${sessionId} ORDER BY ordinal`,
    ),
});

const RequestRow = Schema.Struct({
  run_id: Schema.String,
  submission_id: Schema.String,
  origin: Schema.String,
  question: Schema.String,
  status: Schema.String,
  revision: Schema.Number,
  accepted_at: Schema.Number,
  started_at: Schema.NullOr(Schema.Number),
  settled_at: Schema.NullOr(Schema.Number),
  text: Schema.NullOr(Schema.String),
  failure: Schema.NullOr(Schema.String),
  performed_actions: Schema.Number,
  unknown_actions: Schema.Number,
  ask_recorded_at: Schema.NullOr(Schema.Number),
  conversation_recorded_at: Schema.NullOr(Schema.Number),
  usage_json: Schema.NullOr(Schema.String),
  response_ids_json: Schema.NullOr(Schema.String),
});

type RequestRow = Schema.Schema.Type<typeof RequestRow>;

const requestRowsOf = SqlSchema.findAll({
  Request: Schema.String,
  Result: RequestRow,
  execute: (sessionId) =>
    Effect.flatMap(
      Client.SqlClient,
      (sql) =>
        sql`SELECT run_id, submission_id, origin, question, status, revision, accepted_at,
                   started_at, settled_at, text, failure, performed_actions, unknown_actions,
                   ask_recorded_at, conversation_recorded_at, usage_json, response_ids_json
            FROM requests WHERE session_id = ${sessionId} ORDER BY ordinal`,
    ),
});

const JournalRow = Schema.Struct({
  run_id: Schema.String,
  call_id: Schema.String,
  name: Schema.String,
  arguments_json: Schema.String,
  started_at: Schema.Number,
  output_json: Schema.NullOr(Schema.String),
  settled_at: Schema.NullOr(Schema.Number),
});

type JournalRow = Schema.Schema.Type<typeof JournalRow>;

const journalRowsOf = SqlSchema.findAll({
  Request: Schema.String,
  Result: JournalRow,
  execute: (sessionId) =>
    Effect.flatMap(
      Client.SqlClient,
      (sql) =>
        sql`SELECT run_id, call_id, name, arguments_json, started_at, output_json, settled_at
            FROM action_receipts WHERE session_id = ${sessionId} ORDER BY ordinal`,
    ),
});

/**
 * The envelope as the tables hold it, rebuilt into the envelope's wire shape
 * and admitted by the brain's own reader, so a row this build cannot vouch
 * for makes the whole generation unreadable. The standing generation's id
 * travels beside the answer whether or not its rows could be read: it is the
 * token a writer names to replace it, so an unreadable generation can be
 * repaired by the store that loaded it and by nothing that did not.
 */
export const loadBrainEnvelopeEffect = (
  key: SessionKey,
): Effect.Effect<EnvelopeRead, SqlError, Client.SqlClient> =>
  Effect.gen(function* () {
    const session = yield* standingGenerationEffect(key);
    if (!session) return {};
    const generation = session.sessionId;
    const items = yield* columnsDecoded(itemRowsOf(generation));
    const cursorRows = yield* columnsDecoded(cursorRowsOf(generation));
    const captureRows = yield* columnsDecoded(captureCursorRowsOf(generation));
    const inboxRows = yield* columnsDecoded(inboxRowsOf(generation));
    const requestRows = yield* columnsDecoded(requestRowsOf(generation));
    const journalRows = yield* columnsDecoded(journalRowsOf(generation));
    const parsedItems = parsedPayloads(items.map((row) => row.item));
    const inbox = parsedPayloads(inboxRows.map((row) => row.payload));
    if (!parsedItems || !inbox) return { unreadable: true, generation };
    const wire = {
      version: 2,
      generationId: session.sessionId,
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      // The stamp lives on the generation row alone, so an empty checkpoint
      // keeps it and an item row says nothing about whose shape it is.
      ...(session.checkpointFormat !== undefined
        ? { checkpointFormat: session.checkpointFormat }
        : undefined),
      items: parsedItems,
      compactionCount: session.compactionCount,
      cursors: cursorsFromRows(cursorRows),
      captureCursors: cursorsFromRows(captureRows),
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
  });

/**
 * Makes the envelope given the one that stands, if the save's generation is
 * the one standing. A replacement replaces the generation it expected, its
 * rows cascading away with it; an amendment changes the generation it names.
 * A writer naming some other generation — or none, when one stands — is
 * stale, and is refused without anything of what it carried touching the
 * tables. The generation is read inside the transaction that writes, so the
 * comparison and the set are one atomic step and no writer can land between
 * them.
 */
export const saveBrainEnvelopeEffect = (
  key: SessionKey,
  save: BrainStateSave,
): Effect.Effect<boolean, SqlError, Client.SqlClient> =>
  Effect.flatMap(Client.SqlClient, (sql) =>
    sql.withTransaction(
      Effect.gen(function* () {
        const standing = yield* standingGenerationEffect(key);
        if (save.kind === SAVE_KIND.REPLACE) {
          if (standing?.sessionId !== save.expectGeneration) return false;
          yield* replaceGeneration(key, save.state);
          yield* appendTranscriptEffect(key, save.state.generationId, save.transcript ?? []);
          yield* touchConversationEffect(key, save.state.createdAt);
          return true;
        }
        if (standing?.sessionId !== save.generationId) return false;
        const { delta } = save;
        const sessionId = save.generationId;
        yield* appendTranscriptEffect(key, sessionId, save.transcript ?? []);
        if (delta.checkpointFormat) {
          yield* sql`UPDATE conversation_sessions
                     SET checkpoint_format = ${delta.checkpointFormat.stamp ?? null}
                     WHERE session_id = ${sessionId}`;
        }
        if (delta.compactionCount !== undefined) {
          yield* sql`UPDATE conversation_sessions SET compaction_count = ${delta.compactionCount}
                     WHERE session_id = ${sessionId}`;
        }
        if (delta.items) {
          yield* sql`DELETE FROM runtime_checkpoints
                     WHERE session_id = ${sessionId} AND sequence >= ${delta.items.keepPrefix}`;
          yield* insertItems(sessionId, delta.items.append, delta.items.keepPrefix);
        }
        if (delta.cursors) {
          yield* sql`DELETE FROM observation_cursors WHERE session_id = ${sessionId}`;
          yield* insertCursors(sessionId, delta.cursors);
        }
        if (delta.captureCursors) {
          yield* sql`DELETE FROM observation_capture_cursors WHERE session_id = ${sessionId}`;
          yield* insertCaptureCursors(sessionId, delta.captureCursors);
        }
        if (delta.inbox) {
          yield* sql`DELETE FROM observation_inbox WHERE session_id = ${sessionId}`;
          yield* insertInbox(sessionId, delta.inbox);
        }
        if (delta.requests) {
          for (const runId of delta.requests.remove) {
            yield* sql`DELETE FROM requests WHERE run_id = ${runId}`;
          }
          for (const { ordinal, record } of delta.requests.upsert) {
            yield* upsertRequest(sessionId, ordinal, record);
          }
        }
        if (delta.journal) {
          for (const { runId, callId } of delta.journal.remove) {
            yield* sql`DELETE FROM action_receipts WHERE run_id = ${runId} AND call_id = ${callId}`;
          }
          for (const { ordinal, entry } of delta.journal.upsert) {
            yield* upsertJournal(sessionId, ordinal, entry);
          }
        }
        return true;
      }),
    ),
  );

const replaceGeneration = (
  key: SessionKey,
  state: BrainPersistedState,
): Effect.Effect<void, SqlError, Client.SqlClient> =>
  Effect.gen(function* () {
    const sql = yield* Client.SqlClient;
    yield* sql`DELETE FROM conversation_sessions WHERE session_key = ${key}`;
    yield* sql`INSERT INTO conversation_sessions
                 (session_id, session_key, created_at, expires_at, reset_cleared_at,
                  reset_generation_id, checkpoint_format, compaction_count)
               VALUES (${state.generationId}, ${key}, ${state.createdAt}, ${state.expiresAt},
                       ${state.reset?.clearedAt ?? null}, ${state.reset?.generationId ?? null},
                       ${state.checkpointFormat ?? null}, ${state.compactionCount})`;
    if (state.reset) yield* raiseConversationCutoffEffect(key, state.reset.clearedAt);
    yield* insertItems(state.generationId, state.items, 0);
    yield* insertCursors(state.generationId, state.cursors);
    yield* insertCaptureCursors(state.generationId, state.captureCursors);
    yield* insertInbox(state.generationId, state.inbox);
    yield* Effect.forEach(state.requests, (record, ordinal) =>
      upsertRequest(state.generationId, ordinal, record),
    );
    yield* Effect.forEach(state.journal, (entry, ordinal) =>
      upsertJournal(state.generationId, ordinal, entry),
    );
  });

const insertItems = (
  sessionId: string,
  items: readonly unknown[],
  from: number,
): Effect.Effect<void, SqlError, Client.SqlClient> =>
  Effect.flatMap(Client.SqlClient, (sql) =>
    Effect.forEach(
      items,
      (item, offset) =>
        sql`INSERT INTO runtime_checkpoints (session_id, sequence, item)
            VALUES (${sessionId}, ${from + offset}, ${JSON.stringify(item)})`,
    ),
  ).pipe(Effect.asVoid);

const insertCursors = (
  sessionId: string,
  cursors: BrainTranscriptCursors,
): Effect.Effect<void, SqlError, Client.SqlClient> =>
  Effect.flatMap(Client.SqlClient, (sql) =>
    Effect.forEach(
      cursorEntries(cursors),
      ([providerId, providerSessionId, cursor]) =>
        sql`INSERT INTO observation_cursors
            (session_id, provider_id, provider_session_id, cursor)
          VALUES (${sessionId}, ${providerId}, ${providerSessionId}, ${cursor})`,
    ),
  ).pipe(Effect.asVoid);

const insertCaptureCursors = (
  sessionId: string,
  cursors: BrainTranscriptCursors,
): Effect.Effect<void, SqlError, Client.SqlClient> =>
  Effect.flatMap(Client.SqlClient, (sql) =>
    Effect.forEach(
      cursorEntries(cursors),
      ([providerId, providerSessionId, cursor]) =>
        sql`INSERT INTO observation_capture_cursors
            (session_id, provider_id, provider_session_id, cursor)
          VALUES (${sessionId}, ${providerId}, ${providerSessionId}, ${cursor})`,
    ),
  ).pipe(Effect.asVoid);

const insertInbox = (
  sessionId: string,
  inbox: readonly BrainObservationEntry[],
): Effect.Effect<void, SqlError, Client.SqlClient> =>
  Effect.flatMap(Client.SqlClient, (sql) =>
    Effect.forEach(
      inbox,
      (entry, ordinal) =>
        sql`INSERT INTO observation_inbox (session_id, ordinal, entry_id, payload)
            VALUES (${sessionId}, ${ordinal}, ${entry.id}, ${JSON.stringify(entry)})`,
    ),
  ).pipe(Effect.asVoid);

const upsertRequest = (
  sessionId: string,
  ordinal: number,
  record: BrainRequestRecord,
): Effect.Effect<void, SqlError, Client.SqlClient> =>
  Effect.flatMap(
    Client.SqlClient,
    (sql) =>
      sql`INSERT OR REPLACE INTO requests
            (run_id, session_id, ordinal, submission_id, origin, question, status, revision,
             accepted_at, started_at, settled_at, text, failure, performed_actions,
             unknown_actions, ask_recorded_at, conversation_recorded_at, usage_json,
             response_ids_json)
          VALUES (${record.runId}, ${sessionId}, ${ordinal}, ${record.submissionId},
                  ${record.origin}, ${record.question}, ${record.status}, ${record.revision},
                  ${record.acceptedAt}, ${record.startedAt ?? null}, ${record.settledAt ?? null},
                  ${record.text ?? null}, ${record.failure ?? null}, ${record.performedActions},
                  ${record.unknownActions}, ${record.askRecordedAt ?? null},
                  ${record.conversationRecordedAt ?? null},
                  ${record.usage === undefined ? null : JSON.stringify(record.usage)},
                  ${record.responseIds === undefined ? null : JSON.stringify(record.responseIds)})`,
  ).pipe(Effect.asVoid);

const upsertJournal = (
  sessionId: string,
  ordinal: number,
  entry: BrainJournalEntry,
): Effect.Effect<void, SqlError, Client.SqlClient> =>
  Effect.flatMap(
    Client.SqlClient,
    (sql) =>
      sql`INSERT OR REPLACE INTO action_receipts
            (run_id, call_id, session_id, ordinal, name, arguments_json, started_at,
             output_json, settled_at)
          VALUES (${entry.runId}, ${entry.callId}, ${sessionId}, ${ordinal}, ${entry.name},
                  ${entry.argumentsJson}, ${entry.startedAt}, ${entry.outputJson ?? null},
                  ${entry.settledAt ?? null})`,
  ).pipe(Effect.asVoid);

function cursorEntries(
  cursors: BrainTranscriptCursors,
): readonly (readonly [string, string, string])[] {
  return Object.entries(cursors).flatMap(([providerId, sessions]) =>
    Object.entries(sessions).map(
      ([providerSessionId, cursor]) => [providerId, providerSessionId, cursor] as const,
    ),
  );
}

function cursorsFromRows(rows: readonly CursorRow[]): BrainTranscriptCursors {
  const cursors: Record<string, Record<string, string>> = {};
  for (const row of rows) {
    cursors[row.provider_id] ??= {};
    const provider = cursors[row.provider_id];
    if (provider) provider[row.provider_session_id] = row.cursor;
  }
  return cursors;
}

/**
 * The stored payloads of one table, each read back as the wire value it
 * serialized, or nothing at all when one of them does not parse: an entry
 * this build cannot read makes the whole generation unreadable rather than
 * half-read.
 */
function parsedPayloads(payloads: readonly string[]): WireValue[] | undefined {
  const values: WireValue[] = [];
  for (const payload of payloads) {
    try {
      // SAFETY: JSON.parse returns a wire value; the envelope reader below is the validation.
      values.push(JSON.parse(payload) as WireValue);
    } catch {
      return undefined;
    }
  }
  return values;
}

function requestWire(row: RequestRow): WireRecord {
  return {
    runId: row.run_id,
    submissionId: row.submission_id,
    origin: row.origin,
    question: row.question,
    status: row.status,
    revision: row.revision,
    acceptedAt: row.accepted_at,
    performedActions: row.performed_actions,
    unknownActions: row.unknown_actions,
    ...optionalField("startedAt", row.started_at),
    ...optionalField("settledAt", row.settled_at),
    ...optionalField("text", row.text),
    ...optionalField("failure", row.failure),
    ...optionalField("askRecordedAt", row.ask_recorded_at),
    ...optionalField("conversationRecordedAt", row.conversation_recorded_at),
    ...optionalField("usage", jsonColumn(row.usage_json)),
    ...optionalField("responseIds", jsonColumn(row.response_ids_json)),
  };
}

function journalWire(row: JournalRow): WireRecord {
  return {
    runId: row.run_id,
    callId: row.call_id,
    name: row.name,
    argumentsJson: row.arguments_json,
    startedAt: row.started_at,
    ...optionalField("outputJson", row.output_json),
    ...optionalField("settledAt", row.settled_at),
  };
}

/** A nullable column as the envelope reader expects it: present with its value, or absent. */
function optionalField(name: string, value: WireValue): WireRecord {
  return value === null ? {} : { [name]: value };
}

/**
 * A TEXT column holding JSON, read back as the wire value it serialized, or
 * absent when the column is null or does not parse; the envelope reader, not
 * this table module, decides whether the value's shape is admitted.
 */
function jsonColumn(json: string | null): WireValue {
  if (json === null) return null;
  try {
    // SAFETY: JSON.parse answers a wire value; the envelope reader validates its shape.
    return JSON.parse(json) as WireValue;
  } catch {
    return null;
  }
}

/**
 * The synchronous doors onto the effects above, for the callers that still
 * hold a handle rather than a client: the recoverable deletion, the store's
 * own tests, and the brain's repository through the store's operations.
 *
 * @deprecated A strangler shim over `StoreDatabase#run`, on the allowlist in
 * `docs/adr/0001-effect.md`. P5-11 runs every store operation's effect on the
 * worker's own runtime edge, and these doors go with it.
 */
export function standingGeneration(
  database: StoreDatabase,
  sessionKey: SessionKey,
): StandingGeneration | undefined {
  return database.run(standingGenerationEffect(sessionKey));
}

/** @deprecated The synchronous door onto {@link loadBrainEnvelopeEffect}; see {@link standingGeneration}. */
export function loadBrainEnvelope(database: StoreDatabase, sessionKey: SessionKey): EnvelopeRead {
  return database.run(loadBrainEnvelopeEffect(sessionKey));
}

/** @deprecated The synchronous door onto {@link saveBrainEnvelopeEffect}; see {@link standingGeneration}. */
export function saveBrainEnvelope(
  database: StoreDatabase,
  sessionKey: SessionKey,
  save: BrainStateSave,
): boolean {
  return database.run(saveBrainEnvelopeEffect(sessionKey, save));
}
