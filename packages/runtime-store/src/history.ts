import {
  type ConversationEntry,
  conversationEntryKey,
  maximumStoredConversationEntries,
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

export const HISTORY_RETENTION = {
  MAXIMUM_ENTRIES: maximumStoredConversationEntries,
  MAXIMUM_AGE_MS: storedConversationMaximumAgeMs,
} as const;

/** Whether a line may stand now: recorded no later than now, within the age bound, and after any Clear. */
export function historyEntryAdmitted(
  entry: ConversationEntry,
  now: number,
  clearedAt: number | undefined,
): entry is ConversationEntry & { recordedAt: number } {
  if (entry.recordedAt === undefined || entry.recordedAt > now) return false;
  if (now - entry.recordedAt > HISTORY_RETENTION.MAXIMUM_AGE_MS) return false;
  return clearedAt === undefined || entry.recordedAt > clearedAt;
}

const EXPLICIT_EVENT_KEY_PREFIX = "event:";
const VALUE_EVENT_KEY_PREFIX = "value:";
/**
 * What an append is idempotent on. A line that carries its own id is that id:
 * delivered twice it is one line, and two deliberate identical utterances
 * with ids of their own are two. A line without one — written by a build that
 * minted none — is identified by its value, kind, words, instant, and
 * subject together, the older rule.
 */
export function historyEventKey(entry: ConversationEntry): string {
  return entry.eventId !== undefined
    ? `${EXPLICIT_EVENT_KEY_PREFIX}${entry.eventId}`
    : `${VALUE_EVENT_KEY_PREFIX}${conversationEntryKey(entry)}`;
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
