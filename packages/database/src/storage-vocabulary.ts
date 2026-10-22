/** What a conversation is to the agent: its main one, an observed session's, a child's, or a coding agent's own. */
export const CONVERSATION_KIND = {
  MAIN: "main",
  OBSERVED: "observed",
  CHILD: "child",
  /** A coding agent's transcript: its `messages` rows are what the agent tab shows and its latest turn is its status. */
  CODING_AGENT: "coding_agent",
} as const;

/**
 * What answers a conversation's turns: eve, or a provider's own coding
 * harness running unmodified in the agent's sandbox, Claude Code or Codex.
 * Settled as the conversation is opened and never moved after; a
 * conversation from before the column runs on eve.
 */
export const CONVERSATION_RUNTIME = {
  EVE: "eve",
  CLAUDE_CODE: "claude_code",
  CODEX: "codex",
} as const;

export type ConversationRuntime = (typeof CONVERSATION_RUNTIME)[keyof typeof CONVERSATION_RUNTIME];

/** What sent one of the developer's lines to a coding agent, as the wire spells it too, so the host reads a live row's sender by the same words (`@luke/features/coding-agent-wire`). */
export { MESSAGE_SENDER, type MessageSender } from "@luke/features/coding-agent-wire";

/**
 * What an inbox item's attachment is: a picture the agent posted with an
 * image block, which the block names, a file the developer's answer
 * carried, which the item names as its answer's, or a file a message on the
 * item's thread carried, which the message names.
 */
export const INBOX_ATTACHMENT_KIND = {
  IMAGE: "image",
  ANSWER: "answer",
  MESSAGE: "message",
} as const;

export type InboxAttachmentKind =
  (typeof INBOX_ATTACHMENT_KIND)[keyof typeof INBOX_ATTACHMENT_KIND];

/**
 * What an operator's notice tells of one of its member's agents: a turn
 * that settled, a turn that failed or was abandoned, its pull request
 * merged or closed unmerged, or a new ask it posted to the member's inbox
 * (`schemas/operator-notice.ts`).
 */
export const OPERATOR_NOTICE_KIND = {
  TURN_SETTLED: "turn_settled",
  TURN_FAILED: "turn_failed",
  PR_MERGED: "pr_merged",
  PR_CLOSED: "pr_closed",
  INBOX_ASK: "inbox_ask",
} as const;

export type OperatorNoticeKind = (typeof OPERATOR_NOTICE_KIND)[keyof typeof OPERATOR_NOTICE_KIND];
