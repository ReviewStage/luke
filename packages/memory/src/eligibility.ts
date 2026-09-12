import {
  CONVERSATION_KIND,
  type ConversationKind,
  conversationKindOf,
  type SessionKey,
} from "@sidecar/runtime/vocabulary";

/**
 * Which of an agent's conversations the notebook is kept for: main and the
 * developer's durable private threads, never a temporary thread, an observed
 * session, a child, or a cron conversation.
 */
const ELIGIBLE_KINDS: ReadonlySet<ConversationKind> = new Set([
  CONVERSATION_KIND.MAIN,
  CONVERSATION_KIND.THREAD,
]);

/** Whether a conversation's memory is maintained at all: flushed before a compaction, captured before a reset. */
export function isMaintenanceEligibleConversation(
  sessionKey: SessionKey,
  temporary: boolean,
): boolean {
  return !temporary && ELIGIBLE_KINDS.has(conversationKindOf(sessionKey));
}
