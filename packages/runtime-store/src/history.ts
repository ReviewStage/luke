import {
  type ConversationEntry,
  conversationEntryIdentity,
  recordedAfterClear,
  storedConversationEntry,
  storedConversationMaximumAgeMs,
} from "@sidecar/realtime";
import type { UnparsedWireValue } from "@sidecar/wire";

/**
 * The conversation history's rules as the store applies them, shared by the
 * live append path. Retention is the thread's own: the
 * 200 most recent lines and nothing older than a fortnight, judged against
 * the store's clock. A line at or before the last Clear's cutoff is refused
 * whatever else is true of it.
 */

/** Whether a line may stand now: recorded no later than now, within the age bound, and after any Clear. */
export function historyEntryAdmitted(
  entry: ConversationEntry,
  now: number,
  clearedAt: number | undefined,
): entry is ConversationEntry & { recordedAt: number } {
  if (!recordedAfterClear(entry, clearedAt)) return false;
  return entry.recordedAt <= now && now - entry.recordedAt <= storedConversationMaximumAgeMs;
}

const EXPLICIT_EVENT_KEY_PREFIX = "event:";
const VALUE_EVENT_KEY_PREFIX = "value:";
/**
 * What an append is idempotent on: the line's identity, prefixed by which
 * kind it is so an id can never collide with a value key in the one column
 * that holds both.
 */
export function historyEventKey(entry: ConversationEntry): string {
  const identity = conversationEntryIdentity(entry);
  return entry.eventId !== undefined
    ? `${EXPLICIT_EVENT_KEY_PREFIX}${identity}`
    : `${VALUE_EVENT_KEY_PREFIX}${identity}`;
}

/** The payload a line is kept as, exactly the entry, so the projection is the record read back. */
export function historyPayload(entry: ConversationEntry): string {
  return JSON.stringify(entry);
}

/** A payload read back, or nothing for one this build cannot vouch for. */
export function historyEntryFromPayload(payload: string): ConversationEntry | undefined {
  try {
    // SAFETY: JSON.parse returns a wire value; the stored-entry reader is the validation.
    return storedConversationEntry(JSON.parse(payload) as UnparsedWireValue);
  } catch {
    return undefined;
  }
}
