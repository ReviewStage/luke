import {
  CONVERSATION_KIND,
  type ConversationKind,
  conversationKindOf,
  type SessionKey,
} from "@sidecar/runtime-contracts";

/**
 * Which of an agent's conversations the notebook is kept for and read from:
 * main and the developer's durable private threads, never a temporary
 * thread, an observed session, a child, or a cron conversation.
 */
const ELIGIBLE_KINDS: ReadonlySet<ConversationKind> = new Set([
  CONVERSATION_KIND.MAIN,
  CONVERSATION_KIND.THREAD,
]);

export interface RecallEligibilityInput {
  readonly sessionKey: SessionKey;
  readonly agentId: string;
  /** Whether the thread is held in memory alone; a temporary thread is never a search source. */
  readonly temporary: boolean;
}

/** Whether a search from `current` may read a candidate conversation's retained lines. */
export function isRecallEligibleConversation(
  candidate: RecallEligibilityInput,
  current: { readonly sessionKey: SessionKey; readonly agentId: string },
): boolean {
  if (candidate.temporary) return false;
  if (candidate.agentId !== current.agentId) return false;
  if (candidate.sessionKey === current.sessionKey) return false;
  return ELIGIBLE_KINDS.has(conversationKindOf(candidate.sessionKey));
}

/** Whether a conversation's memory is maintained at all: flushed before a compaction, captured before a reset. */
export function isMaintenanceEligibleConversation(
  sessionKey: SessionKey,
  input: { readonly temporary: boolean },
): boolean {
  return !input.temporary && ELIGIBLE_KINDS.has(conversationKindOf(sessionKey));
}
