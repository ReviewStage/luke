import * as Client from "@effect/sql/SqlClient";
import type { SqlError } from "@effect/sql/SqlError";
import * as SqlSchema from "@effect/sql/SqlSchema";
import {
  type SessionKey,
  type StoredTranscriptEvent,
  TRANSCRIPT_EVENT_KIND,
  type TranscriptEvent,
} from "@sidecar/runtime/vocabulary";
import type { UnparsedWireValue } from "@sidecar/wire";
import { Effect, Option, Schema } from "effect";
import { touchConversationEffect } from "./conversations-table.js";
import type { StoreDatabase } from "./database.js";
import { columnsDecoded } from "./rows.js";
import { transcriptEventFromPayload, transcriptPayload } from "./transcript-payload.js";

/**
 * The retained transcript: every input the context engine ingested, in
 * order, and every point the projection folded, per conversation. The rows
 * name the lifetime they were written in for attribution and never cascade
 * with it, so a Start fresh or a compaction erases nothing here; only the
 * recoverable deletion removes them, with an archive behind it. Nothing in
 * this module reads inside a provider's item: a model's output is kept as
 * the opaque records it arrived as, and the row's payload column is decoded
 * as the text it is and read back by the payload reader alone.
 */

const TranscriptRow = Schema.Struct({
  sequence: Schema.Number,
  session_id: Schema.NullOr(Schema.String),
  kind: Schema.String,
  recorded_at: Schema.Number,
  payload: Schema.String,
});

type TranscriptRow = Schema.Schema.Type<typeof TranscriptRow>;

/** Appends events under the lifetime named, taking the next sequences from the conversation's counter. */
export const appendTranscriptEffect = (
  key: SessionKey,
  sessionId: string | undefined,
  events: readonly TranscriptEvent[],
): Effect.Effect<number, SqlError, Client.SqlClient> =>
  Effect.flatMap(Client.SqlClient, (sql) => {
    if (events.length === 0) return Effect.succeed(0);
    return sql.withTransaction(
      Effect.gen(function* () {
        let latest = 0;
        for (const event of events) {
          const sequence = yield* nextTranscriptSequence(key);
          yield* sql`INSERT INTO transcript_events
                       (session_key, sequence, session_id, kind, recorded_at, payload)
                     VALUES (${key}, ${sequence}, ${sessionId ?? null}, ${event.kind},
                             ${event.recordedAt}, ${JSON.stringify(transcriptPayload(event))})`;
          if (event.kind === TRANSCRIPT_EVENT_KIND.COMPACTION) {
            yield* sql`INSERT INTO compaction_boundaries
                         (session_key, transcript_sequence, session_id, source, dropped,
                          checkpoint_format, created_at)
                       VALUES (${key}, ${sequence}, ${sessionId ?? null},
                               ${event.boundary.source}, ${event.boundary.dropped},
                               ${event.boundary.checkpointFormat ?? null}, ${event.recordedAt})`;
          }
          latest = Math.max(latest, event.recordedAt);
        }
        yield* touchConversationEffect(key, latest);
        return events.length;
      }),
    );
  });

const takenTranscriptSequence = SqlSchema.findOne({
  Request: Schema.String,
  Result: Schema.Struct({ sequence: Schema.Number }),
  execute: (key) =>
    Effect.flatMap(
      Client.SqlClient,
      (sql) =>
        sql`UPDATE conversations SET next_transcript_sequence = next_transcript_sequence + 1
            WHERE session_key = ${key}
            RETURNING next_transcript_sequence - 1 AS sequence`,
    ),
});

const nextTranscriptSequence = (
  key: SessionKey,
): Effect.Effect<number, SqlError, Client.SqlClient> =>
  Effect.flatMap(columnsDecoded(takenTranscriptSequence(key)), (row) =>
    Option.match(row, {
      onNone: () => Effect.die(new Error(`no conversation stands at ${key}`)),
      onSome: ({ sequence }) => Effect.succeed(sequence),
    }),
  );

export interface TranscriptListOptions {
  afterSequence?: number;
  limit?: number;
}

const DEFAULT_TRANSCRIPT_LIMIT = 10_000;

const transcriptRows = SqlSchema.findAll({
  Request: Schema.Struct({
    sessionKey: Schema.String,
    afterSequence: Schema.Number,
    limit: Schema.Number,
  }),
  Result: TranscriptRow,
  execute: ({ sessionKey, afterSequence, limit }) =>
    Effect.flatMap(
      Client.SqlClient,
      (sql) =>
        sql`SELECT sequence, session_id, kind, recorded_at, payload FROM transcript_events
            WHERE session_key = ${sessionKey} AND sequence > ${afterSequence}
            ORDER BY sequence LIMIT ${limit}`,
    ),
});

export const listTranscriptEffect = (
  key: SessionKey,
  options: TranscriptListOptions = {},
): Effect.Effect<readonly StoredTranscriptEvent[], SqlError, Client.SqlClient> =>
  Effect.map(
    columnsDecoded(
      transcriptRows({
        sessionKey: key,
        afterSequence: options.afterSequence ?? -1,
        limit: options.limit ?? DEFAULT_TRANSCRIPT_LIMIT,
      }),
    ),
    storedEvents,
  );

const matchingTranscriptRows = SqlSchema.findAll({
  Request: Schema.Struct({
    sessionKey: Schema.String,
    needle: Schema.String,
    limit: Schema.Number,
  }),
  Result: TranscriptRow,
  execute: ({ sessionKey, needle, limit }) =>
    Effect.flatMap(
      Client.SqlClient,
      (sql) =>
        sql`SELECT sequence, session_id, kind, recorded_at, payload FROM transcript_events
            WHERE session_key = ${sessionKey} AND instr(payload, ${needle}) > 0
            ORDER BY sequence DESC LIMIT ${limit}`,
    ),
});

const DEFAULT_TRANSCRIPT_SEARCH_LIMIT = 50;

/**
 * The transcript rows whose text carries `query`, newest first. It is a
 * plain substring search over the stored payload — enough to show that what
 * a compaction folded out of the projection is still on record — and reads
 * no item for its meaning.
 */
export const searchTranscriptEffect = (
  key: SessionKey,
  query: string,
  limit = DEFAULT_TRANSCRIPT_SEARCH_LIMIT,
): Effect.Effect<readonly StoredTranscriptEvent[], SqlError, Client.SqlClient> => {
  const needle = query.trim();
  if (!needle) return Effect.succeed([]);
  return Effect.map(
    columnsDecoded(matchingTranscriptRows({ sessionKey: key, needle, limit })),
    storedEvents,
  );
};

export interface StoredCompactionBoundary {
  transcriptSequence: number;
  sessionId?: string;
  source: string;
  dropped: number;
  checkpointFormat?: string;
  createdAt: number;
}

const CompactionBoundaryRow = Schema.Struct({
  transcript_sequence: Schema.Number,
  session_id: Schema.NullOr(Schema.String),
  source: Schema.String,
  dropped: Schema.Number,
  checkpoint_format: Schema.NullOr(Schema.String),
  created_at: Schema.Number,
});

const compactionBoundaryRows = SqlSchema.findAll({
  Request: Schema.String,
  Result: CompactionBoundaryRow,
  execute: (key) =>
    Effect.flatMap(
      Client.SqlClient,
      (sql) =>
        sql`SELECT transcript_sequence, session_id, source, dropped, checkpoint_format, created_at
            FROM compaction_boundaries WHERE session_key = ${key}
            ORDER BY transcript_sequence`,
    ),
});

export const listCompactionBoundariesEffect = (
  key: SessionKey,
): Effect.Effect<readonly StoredCompactionBoundary[], SqlError, Client.SqlClient> =>
  Effect.map(columnsDecoded(compactionBoundaryRows(key)), (rows) =>
    rows.map((row) => ({
      transcriptSequence: row.transcript_sequence,
      ...(row.session_id !== null ? { sessionId: row.session_id } : undefined),
      source: row.source,
      dropped: row.dropped,
      ...(row.checkpoint_format !== null ? { checkpointFormat: row.checkpoint_format } : undefined),
      createdAt: row.created_at,
    })),
  );

function storedEvents(rows: readonly TranscriptRow[]): readonly StoredTranscriptEvent[] {
  const events: StoredTranscriptEvent[] = [];
  for (const row of rows) {
    const event = transcriptEventFromRow(row.kind, row.recorded_at, row.payload);
    if (!event) continue;
    events.push({
      sequence: row.sequence,
      ...(row.session_id !== null ? { sessionId: row.session_id } : undefined),
      event,
    });
  }
  return events;
}

/** A row read back as an event, or nothing for one this build cannot vouch for; a bad row drops the row, not the transcript. */
function transcriptEventFromRow(
  kind: string,
  recordedAt: number,
  payload: string,
): TranscriptEvent | undefined {
  let parsed: UnparsedWireValue;
  try {
    // SAFETY: JSON.parse returns a wire value; the payload reader is the validation.
    parsed = JSON.parse(payload) as UnparsedWireValue;
  } catch {
    return undefined;
  }
  return transcriptEventFromPayload(kind, recordedAt, parsed);
}

/**
 * The synchronous doors onto the effects above, for the callers that still
 * hold a handle rather than a client: the envelope's save, the recoverable
 * deletion, and the store's own tests.
 *
 * @deprecated Each goes with the caller that holds it; P5-11 runs every
 * remaining one on the worker's own runtime edge.
 */
export function appendTranscript(
  database: StoreDatabase,
  key: SessionKey,
  sessionId: string | undefined,
  events: readonly TranscriptEvent[],
): number {
  return database.run(appendTranscriptEffect(key, sessionId, events));
}

/** @deprecated The synchronous door onto {@link listTranscriptEffect}; see {@link appendTranscript}. */
export function listTranscript(
  database: StoreDatabase,
  key: SessionKey,
  options: TranscriptListOptions = {},
): readonly StoredTranscriptEvent[] {
  return database.run(listTranscriptEffect(key, options));
}

/** @deprecated The synchronous door onto {@link searchTranscriptEffect}; see {@link appendTranscript}. */
export function searchTranscript(
  database: StoreDatabase,
  key: SessionKey,
  query: string,
  limit = DEFAULT_TRANSCRIPT_SEARCH_LIMIT,
): readonly StoredTranscriptEvent[] {
  return database.run(searchTranscriptEffect(key, query, limit));
}

/** @deprecated The synchronous door onto {@link listCompactionBoundariesEffect}; see {@link appendTranscript}. */
export function listCompactionBoundaries(
  database: StoreDatabase,
  key: SessionKey,
): readonly StoredCompactionBoundary[] {
  return database.run(listCompactionBoundariesEffect(key));
}
