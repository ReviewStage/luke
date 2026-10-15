/** What a conversation is to the agent: its main one, an observed session's, a child's, a named plan's, or a coding agent's own. */
export const CONVERSATION_KIND = {
  MAIN: "main",
  OBSERVED: "observed",
  CHILD: "child",
  PLAN: "plan",
  /** A coding agent's transcript: its `messages` rows are what the agent tab shows and its latest turn is its status. */
  CODING_AGENT: "coding_agent",
} as const;

/**
 * What sent one of the developer's lines to a coding agent: a member, from
 * the message box or an Inbox answer; Luke, from a call; or an automation's
 * run, on its creator's behalf.
 */
export const MESSAGE_SENDER = {
  MEMBER: "member",
  LUKE: "luke",
  AUTOMATION: "automation",
} as const;

export type MessageSender = (typeof MESSAGE_SENDER)[keyof typeof MESSAGE_SENDER];
