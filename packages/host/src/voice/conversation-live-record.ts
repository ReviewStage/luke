import { MAIN_SESSION_KEY } from "@sidecar/runtime/vocabulary";
import { CONVERSATION_ENTRY_KIND, type ConversationEntry } from "@sidecar/session";
import type { LiveRecord } from "@sidecar/voice/live-session";
import { Effect } from "effect";

export interface ConversationLiveRecordOptions {
  recordConversationEntry: (
    entry: ConversationEntry,
    recordedAt: number,
    sessionKey: typeof MAIN_SESSION_KEY,
  ) => boolean | Promise<boolean>;
  createEventId: () => string;
}

/**
 * The desktop's implementation of the live record: main's Conversation
 * thread in the brain's store. The developer's utterance becomes an ask line
 * tied to its run where one was accepted, and Luke's becomes a reply or
 * announcement line — the one line Luke's words ever leave, since the brain's
 * own reply text is never written; the session id, the delegation id, and
 * the ask span are the record contract's and are kept out of the line, which
 * carries no identity a model did not validate. One utterance is one line:
 * an utterance written undelegated when it settled is not written again
 * under the delegation that arrived after, and the rows taken are kept for
 * the one session standing, since the desktop holds one session at a time.
 * The store's own write answers a boolean or a promise of one, so each write
 * here is that call inside an `Effect.promise`, which is the whole of what
 * the record contract's effects are on this side.
 */
export function conversationLiveRecord(options: ConversationLiveRecordOptions): LiveRecord {
  let taken: { voiceSessionId: string; rows: Set<number> } | undefined;
  return {
    writeDeveloperUtterance: (record) =>
      Effect.promise(async () => {
        const words = record.text.trim();
        if (!words) return false;
        if (taken?.voiceSessionId !== record.voiceSessionId) {
          taken = { voiceSessionId: record.voiceSessionId, rows: new Set() };
        }
        if (taken.rows.has(record.rowId)) return true;
        taken.rows.add(record.rowId);
        return options.recordConversationEntry(
          {
            kind: CONVERSATION_ENTRY_KIND.ASK,
            words,
            eventId: options.createEventId(),
            ...(record.runId !== undefined ? { requestId: record.runId } : undefined),
          },
          record.recordedAt,
          MAIN_SESSION_KEY,
        );
      }),
    writeLukeUtterance: (record) =>
      Effect.promise(async () => {
        const words = record.text.trim();
        if (!words) return false;
        return options.recordConversationEntry(
          { kind: record.role, words, eventId: options.createEventId() },
          record.recordedAt,
          MAIN_SESSION_KEY,
        );
      }),
  };
}
