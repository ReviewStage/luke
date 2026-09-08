import type { ConversationEntry } from "@sidecar/realtime";
import {
  type ConversationRecord,
  conversationRecordFromWire,
  type HistoryArchiveRecord,
  historyArchiveRecordFromWire,
  type SessionKey,
} from "@sidecar/runtime-contracts";
import { isRecord, isWireBoolean, isWireString, type UnparsedWireValue } from "@sidecar/wire";

/**
 * What crosses the bridge about the conversations Luke holds: the directory
 * every panel's History selector draws — main, the developer's own threads,
 * the archived ones, and the recoverable archives of deleted history — and
 * the outcomes of the five operations on it. Every operation names a
 * conversation by the session key the directory listed, and the main
 * process validates the key against the directory as it then stands before
 * anything is done.
 */

export interface ConversationDirectory {
  entries: readonly ConversationRecord[];
  archives: readonly HistoryArchiveRecord[];
}

export function isSessionKeyValue(value: UnparsedWireValue): value is SessionKey {
  return isWireString(value) && value.length > 0;
}

export function isConversationDirectory(value: UnparsedWireValue): boolean {
  if (!isRecord(value) || !Array.isArray(value.entries) || !Array.isArray(value.archives)) {
    return false;
  }
  return (
    value.entries.every((entry) => conversationRecordFromWire(entry) !== undefined) &&
    value.archives.every((archive) => historyArchiveRecordFromWire(archive) !== undefined)
  );
}

/** What a panel asks for when it opens another thread: a durable one, or one held in memory until the next launch. */
export interface ConversationThreadRequest {
  temporary: boolean;
}

export function isConversationThreadRequest(value: UnparsedWireValue): boolean {
  return isRecord(value) && isWireBoolean(value.temporary);
}

/**
 * How a Delete history ended. Complete means the rows are gone and the
 * recovery archive is published and verified on disk; incomplete means the
 * rows are gone and the archive is committed in the database but its file
 * is not yet published, which the next launch retries; refused means nothing
 * was changed.
 */
export const CONVERSATION_DELETE_OUTCOME = {
  COMPLETE: "complete",
  INCOMPLETE: "incomplete",
  REFUSED: "refused",
} as const;

export type ConversationDeleteOutcome =
  (typeof CONVERSATION_DELETE_OUTCOME)[keyof typeof CONVERSATION_DELETE_OUTCOME];

const DELETE_OUTCOMES: ReadonlySet<string> = new Set(Object.values(CONVERSATION_DELETE_OUTCOME));

export function isConversationDeleteOutcome(
  value: UnparsedWireValue,
): value is ConversationDeleteOutcome {
  return isWireString(value) && DELETE_OUTCOMES.has(value);
}

/** How a Restore ended, in the store's own words. */
export const CONVERSATION_RESTORE_OUTCOME = {
  RESTORED: "restored",
  NEWER_LIVE: "newer-live",
  MISSING: "missing",
  UNREADABLE: "unreadable",
} as const;

export type ConversationRestoreOutcome =
  (typeof CONVERSATION_RESTORE_OUTCOME)[keyof typeof CONVERSATION_RESTORE_OUTCOME];

const RESTORE_OUTCOMES: ReadonlySet<string> = new Set(Object.values(CONVERSATION_RESTORE_OUTCOME));

export function isConversationRestoreOutcome(
  value: UnparsedWireValue,
): value is ConversationRestoreOutcome {
  return isWireString(value) && RESTORE_OUTCOMES.has(value);
}

/**
 * The conversation history as every panel window draws it, for one
 * conversation. The thread has one store, the main process's runtime store,
 * which takes the hidden voice window's appends and the main process's own
 * lines and relays each conversation's thread whole to every panel so History
 * reads the same on every display. `cleared` marks the relay of a deletion or
 * a fence, which the voice window is told of on its own command; a panel
 * needs nothing from it but the empty thread.
 */
export interface ConversationHistoryPayload {
  sessionKey: SessionKey;
  entries: readonly ConversationEntry[];
  cleared: boolean;
}

/** The user-facing words for the controls that replaced the ambiguous Clear. */
export const CONVERSATION_CONTROL_WORDS = {
  START_FRESH: "Start fresh",
  START_FRESH_EXPLANATION:
    "Starting fresh keeps this conversation's history and everything Luke remembers about you. Only his working context restarts, so his next reply begins from a clean slate.",
  NEW_THREAD: "New thread",
  NEW_TEMPORARY_THREAD: "New temporary thread",
  TEMPORARY_EXPLANATION:
    "A temporary thread is kept in memory alone and is gone the next time Luke opens. Nothing said in it is remembered automatically.",
  ARCHIVE: "Archive",
  UNARCHIVE: "Unarchive",
  DELETE_HISTORY: "Delete history",
  DELETE_EXPLANATION:
    "Deletes this conversation's stored history and Luke's working context for it. A compressed recovery archive stays on this Mac and can be restored from the list below. What Luke remembers about you is not touched.",
  RESTORE: "Restore",
} as const;
