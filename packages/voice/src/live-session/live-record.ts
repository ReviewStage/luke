import type { CONVERSATION_ENTRY_KIND } from "@sidecar/session";

/**
 * Where what was said on a live session is written down, behind its own door
 * so the writer can change without the service noticing: the desktop's
 * Conversation table, or the hosted record where the brain's reply is the
 * assistant message and Luke's spoken words are transcript segments. The two
 * writes stay two calls for that reason — a developer's utterance and Luke's
 * are different kinds of record even where one table takes both.
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
