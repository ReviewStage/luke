/** What a conversation is to the agent: its main one, an observed session's, a child's, or an agent's own. */
export const CONVERSATION_KIND = {
  MAIN: "main",
  OBSERVED: "observed",
  CHILD: "child",
  /** An agent's transcript: its `messages` rows are what the agent tab shows and its latest turn is its status. */
  AGENT: "agent",
} as const;

/**
 * What answers a conversation's turns: a provider's own coding harness
 * running unmodified in the agent's sandbox, Claude Code or Codex, or the
 * retired runtime, which answers nothing any more and keeps the spelling
 * its rows were stored with. Settled as the conversation is opened and
 * never moved after; a conversation from before the column ran on the
 * retired runtime too (`readAgentRouting`).
 */
export const CONVERSATION_RUNTIME = {
  RETIRED: "eve",
  CLAUDE_CODE: "claude_code",
  CODEX: "codex",
} as const;

export type ConversationRuntime = (typeof CONVERSATION_RUNTIME)[keyof typeof CONVERSATION_RUNTIME];

/** What sent one of the developer's lines to a coding agent, as the wire spells it too, so the host reads a live row's sender by the same words (`@repo/features/agent-wire`). */
export {
  MESSAGE_SENDER,
  type MessageSender,
  messageSenderSchema,
} from "@repo/features/agent-wire";

/**
 * Where a Slack thread that speaks for an agent came from: a member's
 * message to the bot that started the agent, or the DM the bot sent an
 * automation run's result in. Only a start makes the agent Slack's own,
 * whose task finishes with no merge and which is archived after a good turn.
 */
export const SLACK_THREAD_ORIGIN = {
  START: "start",
  RUN_RESULT: "run_result",
} as const;

export type SlackThreadOrigin = (typeof SLACK_THREAD_ORIGIN)[keyof typeof SLACK_THREAD_ORIGIN];

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
