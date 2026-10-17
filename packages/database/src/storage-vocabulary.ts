/** What a conversation is to the agent: its main one, an observed session's, a child's, a named plan's, or a coding agent's own. */
export const CONVERSATION_KIND = {
  MAIN: "main",
  OBSERVED: "observed",
  CHILD: "child",
  TASK: "plan",
  /** A coding agent's transcript: its `messages` rows are what the agent tab shows and its latest turn is its status. */
  CODING_AGENT: "coding_agent",
} as const;

/**
 * What sent one of the developer's lines to a coding agent: a member, from
 * the message box or an Inbox answer; Luke, from a call; an automation's
 * run, on its creator's behalf; GitHub, telling the agent of a review, a
 * comment, or a failed check on its pull request, by who caused it there;
 * or another coding agent of the workspace, through its `message_agent` tool.
 */
export const MESSAGE_SENDER = {
  MEMBER: "member",
  LUKE: "luke",
  AUTOMATION: "automation",
  GITHUB: "github",
  AGENT: "agent",
} as const;

export type MessageSender = (typeof MESSAGE_SENDER)[keyof typeof MESSAGE_SENDER];

/**
 * What one of an inbox item's attachments is: a picture the agent posted
 * for an image block, or a file the developer attached to their answer,
 * which the item keeps beside the answer it went with.
 */
export const INBOX_ATTACHMENT_KIND = {
  PICTURE: "picture",
  ANSWER_FILE: "answer-file",
} as const;

export type InboxAttachmentKind =
  (typeof INBOX_ATTACHMENT_KIND)[keyof typeof INBOX_ATTACHMENT_KIND];
