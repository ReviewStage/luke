import { type ConversationLineHit, tokenize } from "@sidecar/memory";
import {
  type ConversationEntry,
  conversationEntryIdentity,
  maximumStoredConversationEntries,
  recordedAfterClear,
  storedConversationEntry,
  storedConversationMaximumAgeMs,
} from "@sidecar/realtime";
import type { HistoryAppendOutcome, SessionKey } from "@sidecar/runtime/vocabulary";
import type { UnparsedWireValue } from "@sidecar/wire";
import { standingGeneration } from "./brain-envelope.js";
import { historyCutoff } from "./conversations-table.js";
import { nullable, type StoreDatabase } from "./database.js";

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
  database: StoreDatabase,
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
  database: StoreDatabase,
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
    // Nothing is removed here: stored lines answer to Delete history and
    // conversation maintenance, and the bound is the projection's alone.
    return { changed, entries: listRetained(database, sessionKey, now, clearedAt) };
  });
}

function appendOne(
  database: StoreDatabase,
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

function insertLine(
  database: StoreDatabase,
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
function nextHistorySequence(database: StoreDatabase, sessionKey: SessionKey): number {
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
  database: StoreDatabase,
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

/** The thread as the panel draws it: retained lines in the order they happened, oldest first. */
export function listHistory(
  database: StoreDatabase,
  sessionKey: SessionKey,
  now: number,
): readonly ConversationEntry[] {
  return listRetained(database, sessionKey, now, historyClearedAt(database, sessionKey));
}

function listRetained(
  database: StoreDatabase,
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

export type HistorySearchHit = ConversationLineHit;

/** How many rows past the limit one page asks for, since the substring prefilter admits rows the token match will drop. */
const HISTORY_SEARCH_PAGE_MULTIPLIER = 4;
/** The most prefiltered rows one search reads before it answers what it has. */
export const HISTORY_SEARCH_MAXIMUM_SCANNED_ROWS = 2_000;

/**
 * The retained lines of the conversations named that carry every token of
 * the query, most recent first and bounded by `limit`, in one query over
 * every conversation named. Matching is by token, as the score the caller
 * gives a hit is, so a multi-word or punctuated query keeps a line that
 * shares its words in another order. SQL narrows the scan by substring,
 * which admits a line holding a longer word ("deployment" for "deploy"); the
 * token check decides admission, and it runs before the limit is spent, over
 * pages of the prefiltered rows, so recent lines that only share a substring
 * never crowd an older exact match out of the answer. The scan itself is
 * bounded: past `HISTORY_SEARCH_MAXIMUM_SCANNED_ROWS` prefiltered rows the
 * search answers what it admitted, so a match behind more substring-only
 * lines than that is not found rather than searched for without bound. Each
 * line stands only above its own conversation's cutoff — the durable one on
 * the conversation row and the standing generation's marker both — so a
 * Clear hides its lines here as it does everywhere.
 */
export function searchHistory(
  database: StoreDatabase,
  sessionKeys: readonly SessionKey[],
  query: string,
  limit: number,
  now: number,
): readonly HistorySearchHit[] {
  const tokens = [...tokenize(query)];
  if (tokens.length === 0 || sessionKeys.length === 0 || limit <= 0) return [];
  const keyMarks = sessionKeys.map(() => "?").join(", ");
  const tokenMarks = tokens.map(() => "instr(lower(words), ?) > 0").join(" AND ");
  const page = database.prepare(
    `SELECT session_key, payload FROM history_events h
       WHERE session_key IN (${keyMarks})
         AND recorded_at <= ? AND recorded_at >= ?
         AND recorded_at > COALESCE(
           (SELECT history_cleared_at FROM conversations c WHERE c.session_key = h.session_key), -1)
         AND recorded_at > COALESCE(
           (SELECT reset_cleared_at FROM conversation_sessions s WHERE s.session_key = h.session_key), -1)
         AND ${tokenMarks}
       ORDER BY recorded_at DESC, sequence DESC LIMIT ? OFFSET ?`,
  );
  const pageSize = Math.min(
    limit * HISTORY_SEARCH_PAGE_MULTIPLIER,
    HISTORY_SEARCH_MAXIMUM_SCANNED_ROWS,
  );
  const hits: HistorySearchHit[] = [];
  let scanned = 0;
  while (hits.length < limit && scanned < HISTORY_SEARCH_MAXIMUM_SCANNED_ROWS) {
    const asked = Math.min(pageSize, HISTORY_SEARCH_MAXIMUM_SCANNED_ROWS - scanned);
    // SAFETY: the query selects the two columns the row type names.
    const rows = page.all(
      ...sessionKeys,
      now,
      now - storedConversationMaximumAgeMs,
      ...tokens,
      asked,
      scanned,
    ) as { session_key: string; payload: string }[];
    scanned += rows.length;
    for (const row of rows) {
      if (hits.length >= limit) break;
      const entry = historyEntryFromPayload(row.payload);
      if (!entry) continue;
      const held = tokenize(entry.words);
      if (!tokens.every((token) => held.has(token))) continue;
      // SAFETY: the column holds one of the session keys the IN clause was given.
      const sessionKey = row.session_key as SessionKey;
      hits.push({ sessionKey, entry });
    }
    if (rows.length < asked) break;
  }
  return hits;
}

/** Whether a canonical line may stand now: recorded no later than now and after any Clear. */
function historyEntryAdmitted(
  entry: ConversationEntry,
  now: number,
  clearedAt: number | undefined,
): entry is ConversationEntry & { recordedAt: number } {
  if (!recordedAfterClear(entry, clearedAt)) return false;
  return entry.recordedAt <= now;
}

const EXPLICIT_EVENT_KEY_PREFIX = "event:";
const VALUE_EVENT_KEY_PREFIX = "value:";
/**
 * What an append is idempotent on: the line's identity, prefixed by which
 * kind it is so an id can never collide with a value key in the one column
 * that holds both.
 */
function historyEventKey(entry: ConversationEntry): string {
  const identity = conversationEntryIdentity(entry);
  return entry.eventId !== undefined
    ? `${EXPLICIT_EVENT_KEY_PREFIX}${identity}`
    : `${VALUE_EVENT_KEY_PREFIX}${identity}`;
}

/** The payload a line is kept as, exactly the entry, so the projection is the record read back. */
function historyPayload(entry: ConversationEntry): string {
  return JSON.stringify(entry);
}

/** A payload read back, or nothing for one this build cannot vouch for. */
function historyEntryFromPayload(payload: string): ConversationEntry | undefined {
  try {
    // SAFETY: JSON.parse returns a wire value; the stored-entry reader is the validation.
    return storedConversationEntry(JSON.parse(payload) as UnparsedWireValue);
  } catch {
    return undefined;
  }
}
