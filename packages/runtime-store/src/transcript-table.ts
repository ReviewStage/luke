import {
  COMPACTION_SOURCE,
  CONTEXT_INPUT_KIND,
  type CompactionBoundary,
  type ContextInput,
  isCompactionSource,
  type SessionKey,
  type StoredTranscriptEvent,
  TRANSCRIPT_EVENT_KIND,
  type TranscriptEvent,
} from "@sidecar/runtime-contracts";
import { isRecord, isWireNumber, isWireString, type UnparsedWireValue } from "@sidecar/wire";
import { touchConversation } from "./conversations-table.js";
import { nullable, type RuntimeDatabase } from "./database.js";

/**
 * The retained transcript: every input the context engine ingested, in
 * order, and every point the projection folded, per conversation. The rows
 * name the lifetime they were written in for attribution and never cascade
 * with it, so a Start fresh or a compaction erases nothing here; only the
 * recoverable deletion removes them, with an archive behind it. Nothing in
 * this module reads inside a provider's item: a model's output is kept as
 * the opaque records it arrived as.
 */

type TranscriptRow = {
  sequence: number;
  session_id: string | null;
  kind: string;
  recorded_at: number;
  payload: string;
};

/** Appends events under the lifetime named, taking the next sequences from the conversation's counter. */
export function appendTranscript(
  database: RuntimeDatabase,
  sessionKey: SessionKey,
  sessionId: string | undefined,
  events: readonly TranscriptEvent[],
): number {
  if (events.length === 0) return 0;
  return database.transaction(() => {
    let latest = 0;
    for (const event of events) {
      const sequence = nextTranscriptSequence(database, sessionKey);
      database
        .prepare(
          `INSERT INTO transcript_events (session_key, sequence, session_id, kind, recorded_at, payload)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          sessionKey,
          sequence,
          nullable(sessionId),
          event.kind,
          event.recordedAt,
          JSON.stringify(transcriptPayload(event)),
        );
      if (event.kind === TRANSCRIPT_EVENT_KIND.COMPACTION) {
        database
          .prepare(
            `INSERT INTO compaction_boundaries
               (session_key, transcript_sequence, session_id, source, dropped, checkpoint_format, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            sessionKey,
            sequence,
            nullable(sessionId),
            event.boundary.source,
            event.boundary.dropped,
            nullable(event.boundary.checkpointFormat),
            event.recordedAt,
          );
      }
      latest = Math.max(latest, event.recordedAt);
    }
    touchConversation(database, sessionKey, latest);
    return events.length;
  });
}

function nextTranscriptSequence(database: RuntimeDatabase, sessionKey: SessionKey): number {
  // SAFETY: RETURNING yields the one integer expression named `sequence`, or no row.
  const row = database
    .prepare(
      `UPDATE conversations SET next_transcript_sequence = next_transcript_sequence + 1
       WHERE session_key = ? RETURNING next_transcript_sequence - 1 AS sequence`,
    )
    .get(sessionKey) as { sequence: number } | undefined;
  if (!row) throw new Error(`no conversation stands at ${sessionKey}`);
  return row.sequence;
}

/** The payload a row keeps: the event less its kind and clock, which have columns of their own. */
function transcriptPayload(
  event: TranscriptEvent,
): { input: ContextInput } | { boundary: CompactionBoundary } {
  return event.kind === TRANSCRIPT_EVENT_KIND.CONTEXT_INPUT
    ? { input: event.input }
    : { boundary: event.boundary };
}

export interface TranscriptListOptions {
  /** Only events after this sequence. */
  afterSequence?: number;
  limit?: number;
}

const DEFAULT_TRANSCRIPT_LIMIT = 10_000;

export function listTranscript(
  database: RuntimeDatabase,
  sessionKey: SessionKey,
  options: TranscriptListOptions = {},
): readonly StoredTranscriptEvent[] {
  // SAFETY: the columns selected are the ones the row type names, typed by the schema.
  const rows = database
    .prepare(
      `SELECT sequence, session_id, kind, recorded_at, payload FROM transcript_events
       WHERE session_key = ? AND sequence > ? ORDER BY sequence LIMIT ?`,
    )
    .all(
      sessionKey,
      options.afterSequence ?? -1,
      options.limit ?? DEFAULT_TRANSCRIPT_LIMIT,
    ) as TranscriptRow[];
  return storedEvents(rows);
}

/**
 * The transcript rows whose text carries `query`, newest first. It is a
 * plain substring search over the stored payload — enough to show that what
 * a compaction folded out of the projection is still on record — and reads
 * no item for its meaning.
 */
export function searchTranscript(
  database: RuntimeDatabase,
  sessionKey: SessionKey,
  query: string,
  limit = 50,
): readonly StoredTranscriptEvent[] {
  const needle = query.trim();
  if (!needle) return [];
  // SAFETY: as above.
  const rows = database
    .prepare(
      `SELECT sequence, session_id, kind, recorded_at, payload FROM transcript_events
       WHERE session_key = ? AND instr(payload, ?) > 0 ORDER BY sequence DESC LIMIT ?`,
    )
    .all(sessionKey, needle, limit) as TranscriptRow[];
  return storedEvents(rows);
}

export function countTranscript(database: RuntimeDatabase, sessionKey: SessionKey): number {
  // SAFETY: COUNT(*) is one integer column named `count`.
  const row = database
    .prepare("SELECT COUNT(*) AS count FROM transcript_events WHERE session_key = ?")
    .get(sessionKey) as { count: number };
  return row.count;
}

export interface StoredCompactionBoundary {
  transcriptSequence: number;
  sessionId?: string;
  source: string;
  dropped: number;
  checkpointFormat?: string;
  createdAt: number;
}

export function listCompactionBoundaries(
  database: RuntimeDatabase,
  sessionKey: SessionKey,
): readonly StoredCompactionBoundary[] {
  // SAFETY: the columns selected are the ones the row type names.
  const rows = database
    .prepare(
      `SELECT transcript_sequence, session_id, source, dropped, checkpoint_format, created_at
       FROM compaction_boundaries WHERE session_key = ? ORDER BY transcript_sequence`,
    )
    .all(sessionKey) as {
    transcript_sequence: number;
    session_id: string | null;
    source: string;
    dropped: number;
    checkpoint_format: string | null;
    created_at: number;
  }[];
  return rows.map((row) => ({
    transcriptSequence: row.transcript_sequence,
    ...(row.session_id !== null ? { sessionId: row.session_id } : undefined),
    source: row.source,
    dropped: row.dropped,
    ...(row.checkpoint_format !== null ? { checkpointFormat: row.checkpoint_format } : undefined),
    createdAt: row.created_at,
  }));
}

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
export function transcriptEventFromRow(
  kind: string,
  recordedAt: number,
  payload: string,
): TranscriptEvent | undefined {
  let parsed: UnparsedWireValue;
  try {
    // SAFETY: JSON.parse returns a wire value; the readers below are the validation.
    parsed = JSON.parse(payload) as UnparsedWireValue;
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;
  if (kind === TRANSCRIPT_EVENT_KIND.CONTEXT_INPUT) {
    const input = contextInputFromWire(parsed.input);
    return input ? { kind, recordedAt, input } : undefined;
  }
  if (kind === TRANSCRIPT_EVENT_KIND.COMPACTION) {
    const boundary = parsed.boundary;
    if (!isRecord(boundary) || !isWireNumber(boundary.dropped)) return undefined;
    const source = isCompactionSource(boundary.source)
      ? boundary.source
      : COMPACTION_SOURCE.PROVIDER_INLINE;
    return {
      kind,
      recordedAt,
      boundary: {
        source,
        dropped: boundary.dropped,
        ...(isWireString(boundary.checkpointFormat)
          ? { checkpointFormat: boundary.checkpointFormat }
          : undefined),
      },
    };
  }
  return undefined;
}

export function contextInputFromWire(value: UnparsedWireValue): ContextInput | undefined {
  if (!isRecord(value)) return undefined;
  switch (value.kind) {
    case CONTEXT_INPUT_KIND.USER_TEXT:
      return isWireString(value.text) ? { kind: value.kind, text: value.text } : undefined;
    case CONTEXT_INPUT_KIND.MODEL_OUTPUT: {
      if (!Array.isArray(value.items)) return undefined;
      const items = [];
      for (const item of value.items) {
        if (!isRecord(item)) return undefined;
        items.push(item);
      }
      return { kind: value.kind, items };
    }
    case CONTEXT_INPUT_KIND.TOOL_RESULT:
      return isWireString(value.callId) && isWireString(value.outputJson)
        ? { kind: value.kind, callId: value.callId, outputJson: value.outputJson }
        : undefined;
    default:
      return undefined;
  }
}

/** Every transcript row and boundary of the conversation, for the deletion's archive and its tests. */
export function removeTranscript(database: RuntimeDatabase, sessionKey: SessionKey): void {
  database.prepare("DELETE FROM compaction_boundaries WHERE session_key = ?").run(sessionKey);
  database.prepare("DELETE FROM transcript_events WHERE session_key = ?").run(sessionKey);
}
