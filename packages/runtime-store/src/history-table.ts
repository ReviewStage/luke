import {
  type ConversationEntry,
  maximumStoredConversationEntries,
  storedConversationMaximumAgeMs,
} from "@sidecar/realtime";
import type { HistoryAppendOutcome, SessionKey } from "@sidecar/runtime-contracts";
import { standingGeneration } from "./brain-envelope.js";
import { historyCutoff } from "./conversations-table.js";
import { nullable, type RuntimeDatabase } from "./database.js";
import {
  historyEntryAdmitted,
  historyEntryFromPayload,
  historyEventKey,
  historyPayload,
} from "./history.js";

/**
 * The conversation's history as the panel draws it, kept apart from the
 * brain's generation: a line names the generation that stood when it was
 * written, for attribution alone, and answers to the thread's own retention
 * and to the Clear rather than to the generation's expiry.
 */

/**
 * The Clear cutoff before which no history line may stand: the later of the
 * standing generation's marker and the conversation's own durable cutoff,
 * which outlives the generation.
 */
export function historyClearedAt(
  database: RuntimeDatabase,
  sessionKey: SessionKey,
): number | undefined {
  const durable = historyCutoff(database, sessionKey);
  const marker = standingGeneration(database, sessionKey)?.resetClearedAt;
  if (durable === undefined) return marker;
  return marker === undefined ? durable : Math.max(durable, marker);
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
export function appendHistory(
  database: RuntimeDatabase,
  sessionKey: SessionKey,
  entries: readonly ConversationEntry[],
  now: number,
): HistoryAppendOutcome<ConversationEntry> {
  return database.transaction(() => {
    const standing = standingGeneration(database, sessionKey);
    const clearedAt = historyClearedAt(database, sessionKey);
    let changed = false;
    for (const entry of entries) {
      if (!historyEntryAdmitted(entry, now, clearedAt)) continue;
      if (appendOne(database, sessionKey, standing?.sessionId, entry)) changed = true;
    }
    if (changed) retainHistory(database, sessionKey, now);
    return { changed, entries: listRetained(database, sessionKey, now, clearedAt) };
  });
}

function appendOne(
  database: RuntimeDatabase,
  sessionKey: SessionKey,
  sessionId: string | undefined,
  entry: ConversationEntry & { recordedAt: number },
): boolean {
  const eventKey = historyEventKey(entry);
  // SAFETY: the two columns selected are the ones the row type names, typed by the schema.
  const held = database
    .prepare(
      "SELECT sequence, request_id FROM history_events WHERE session_key = ? AND event_key = ?",
    )
    .get(sessionKey, eventKey) as { sequence: number; request_id: string | null } | undefined;
  if (held) {
    if (held.request_id !== null || entry.requestId === undefined) return false;
    // The once-published index refuses the update when the run's line of this
    // kind already stands elsewhere; OR IGNORE turns the refusal into no change.
    const { changes } = database
      .prepare(
        `UPDATE OR IGNORE history_events SET request_id = ?, payload = ?
         WHERE session_key = ? AND sequence = ?`,
      )
      .run(entry.requestId, historyPayload(entry), sessionKey, held.sequence);
    return changes > 0;
  }
  // Asked before the sequence is taken, so a publication the index would
  // refuse burns no number and the sequence stays dense.
  if (
    entry.requestId !== undefined &&
    published(database, sessionKey, entry.requestId, entry.kind)
  ) {
    return false;
  }
  insertLine(database, sessionKey, sessionId, entry);
  return true;
}

/**
 * Writes a line back from its archive under the identity it left with: the
 * same event key the live append writes for the entry, so a late re-report
 * of a restored line finds its row instead of standing beside it. Admission,
 * retention, and the once-published check are the live append's concerns; a
 * restore lands only in a conversation holding nothing newer, and the lines
 * it writes already stood together under the same index.
 */
export function restoreHistoryLine(
  database: RuntimeDatabase,
  sessionKey: SessionKey,
  sessionId: string | undefined,
  entry: ConversationEntry & { recordedAt: number },
): void {
  insertLine(database, sessionKey, sessionId, entry);
}

function insertLine(
  database: RuntimeDatabase,
  sessionKey: SessionKey,
  sessionId: string | undefined,
  entry: ConversationEntry & { recordedAt: number },
): void {
  const sequence = nextHistorySequence(database, sessionKey);
  database
    .prepare(
      `INSERT INTO history_events
         (session_key, sequence, session_id, event_key, kind, words, recorded_at, request_id,
          provider_id, provider_session_id, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      sessionKey,
      sequence,
      nullable(sessionId),
      historyEventKey(entry),
      entry.kind,
      entry.words,
      entry.recordedAt,
      nullable(entry.requestId),
      nullable(entry.identity?.providerId),
      nullable(entry.identity?.providerSessionId),
      historyPayload(entry),
    );
}

/** The conversation's next sequence, taken from its counter so a number is never handed out twice. */
function nextHistorySequence(database: RuntimeDatabase, sessionKey: SessionKey): number {
  // SAFETY: RETURNING yields the one integer expression named `sequence`, or no row.
  const row = database
    .prepare(
      `UPDATE conversations SET next_history_sequence = next_history_sequence + 1
       WHERE session_key = ? RETURNING next_history_sequence - 1 AS sequence`,
    )
    .get(sessionKey) as { sequence: number } | undefined;
  if (!row) throw new Error(`no conversation stands at ${sessionKey}`);
  return row.sequence;
}

/** Whether the run's line of this kind already stands, read through the once-published index. */
function published(
  database: RuntimeDatabase,
  sessionKey: SessionKey,
  requestId: string,
  kind: string,
): boolean {
  return (
    database
      .prepare("SELECT 1 FROM history_events WHERE session_key = ? AND request_id = ? AND kind = ?")
      .get(sessionKey, requestId, kind) !== undefined
  );
}

/** Lets go of lines past the age bound and beyond the count, oldest first. */
function retainHistory(database: RuntimeDatabase, sessionKey: SessionKey, now: number): void {
  database
    .prepare("DELETE FROM history_events WHERE session_key = ? AND recorded_at < ?")
    .run(sessionKey, now - storedConversationMaximumAgeMs);
  database
    .prepare(
      `DELETE FROM history_events WHERE session_key = ? AND sequence IN (
         SELECT sequence FROM history_events WHERE session_key = ?
         ORDER BY recorded_at DESC, sequence DESC LIMIT -1 OFFSET ?
       )`,
    )
    .run(sessionKey, sessionKey, maximumStoredConversationEntries);
}

/** The thread as the panel draws it: retained lines in the order they happened, oldest first. */
export function listHistory(
  database: RuntimeDatabase,
  sessionKey: SessionKey,
  now: number,
): readonly ConversationEntry[] {
  return listRetained(database, sessionKey, now, historyClearedAt(database, sessionKey));
}

function listRetained(
  database: RuntimeDatabase,
  sessionKey: SessionKey,
  now: number,
  clearedAt: number | undefined,
): readonly ConversationEntry[] {
  // SAFETY: the query selects the one text column the row type names.
  const rows = database
    .prepare(
      `SELECT payload FROM history_events
       WHERE session_key = ? AND recorded_at <= ? AND recorded_at >= ? AND recorded_at > ?
       ORDER BY recorded_at DESC, sequence DESC LIMIT ?`,
    )
    .all(
      sessionKey,
      now,
      now - storedConversationMaximumAgeMs,
      clearedAt ?? -1,
      maximumStoredConversationEntries,
    ) as { payload: string }[];
  const entries: ConversationEntry[] = [];
  for (const row of rows.reverse()) {
    const entry = historyEntryFromPayload(row.payload);
    if (entry) entries.push(entry);
  }
  return entries;
}
