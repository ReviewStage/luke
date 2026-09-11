import { MAIN_SESSION_KEY } from "@sidecar/runtime/vocabulary";
import { CONVERSATION_ENTRY_KIND, type ConversationEntry } from "@sidecar/session";

/**
 * Where what was said on a live session is written down, behind its own door
 * so the writer can change without the service noticing: today the desktop's
 * Conversation table, later a hosted record where the brain's reply is the
 * assistant message and Luke's spoken words are transcript segments. The two
 * writes stay two calls for that reason — a developer's utterance and Luke's
 * are different kinds of record even where one table takes both today.
 */

export interface DeveloperUtteranceRecord {
  /** The grouped transcript of one developer utterance, exactly as the ledger concatenated it. */
  text: string;
  /** The session the words were spoken on, opaque, as the provider named it. */
  voiceSessionId: string;
  /** The delegation the utterance fed, when the voice model delegated on it. */
  delegationId: string | null;
  /** The span of the session timeline the ask context that fed the brain covered. */
  askContext: { sinceMs: number; untilMs: number } | undefined;
  startMs: number;
  endMs: number;
  /** The brain run the utterance opened, when one was accepted. */
  runId?: string;
  recordedAt: number;
}

export interface LukeUtteranceRecord {
  role: typeof CONVERSATION_ENTRY_KIND.REPLY | typeof CONVERSATION_ENTRY_KIND.ANNOUNCEMENT;
  text: string;
  voiceSessionId: string;
  startMs: number;
  endMs: number;
  recordedAt: number;
}

export interface LiveRecord {
  /** Writes one developer utterance as a user line; answers whether the record took it. */
  writeDeveloperUtterance(record: DeveloperUtteranceRecord): Promise<boolean>;
  /** Writes one of Luke's grouped utterances as his line; answers whether the record took it. */
  writeLukeUtterance(record: LukeUtteranceRecord): Promise<boolean>;
}

export interface ConversationLiveRecordOptions {
  recordConversationEntry: (
    entry: ConversationEntry,
    recordedAt: number,
    sessionKey: typeof MAIN_SESSION_KEY,
  ) => boolean | Promise<boolean>;
  createEventId: () => string;
}

/**
 * The desktop's implementation: main's Conversation thread in the brain's
 * store. The developer's utterance becomes an ask line tied to its run where
 * one was accepted, and Luke's becomes a reply or announcement line — the one
 * line Luke's words ever leave, since the brain's own reply text is never
 * written;
 * the session id, the delegation id, and the ask span are the record
 * contract's and are kept out of the line, which carries no identity a model
 * did not validate.
 */
export function conversationLiveRecord(options: ConversationLiveRecordOptions): LiveRecord {
  return {
    writeDeveloperUtterance: async (record) => {
      const words = record.text.trim();
      if (!words) return false;
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
    },
    writeLukeUtterance: async (record) => {
      const words = record.text.trim();
      if (!words) return false;
      return options.recordConversationEntry(
        { kind: record.role, words, eventId: options.createEventId() },
        record.recordedAt,
        MAIN_SESSION_KEY,
      );
    },
  };
}
