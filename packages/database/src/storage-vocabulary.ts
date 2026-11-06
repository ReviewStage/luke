export const CONVERSATION_KIND = {
  MAIN: "main",
  OBSERVED: "observed",
  CHILD: "child",
  AGENT: "agent",
} as const;

export const CONVERSATION_RUNTIME = {
  EVE: "eve",
  CLAUDE_CODE: "claude_code",
  CODEX: "codex",
} as const;

export type ConversationRuntime = (typeof CONVERSATION_RUNTIME)[keyof typeof CONVERSATION_RUNTIME];

export {
  MESSAGE_SENDER,
  type MessageSender,
  messageSenderSchema,
} from "@repo/features/agent-wire";

export const SLACK_THREAD_ORIGIN = {
  START: "start",
  RUN_RESULT: "run_result",
} as const;

export type SlackThreadOrigin = (typeof SLACK_THREAD_ORIGIN)[keyof typeof SLACK_THREAD_ORIGIN];

export const INBOX_ATTACHMENT_KIND = {
  IMAGE: "image",
  ANSWER: "answer",
  MESSAGE: "message",
} as const;

export type InboxAttachmentKind =
  (typeof INBOX_ATTACHMENT_KIND)[keyof typeof INBOX_ATTACHMENT_KIND];
