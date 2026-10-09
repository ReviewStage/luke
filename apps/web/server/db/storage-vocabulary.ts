/** What a conversation is to the agent: its main one, an observed session's, a child's, a named plan's, or a coding agent's own. */
export const CONVERSATION_KIND = {
  MAIN: "main",
  OBSERVED: "observed",
  CHILD: "child",
  PLAN: "plan",
  /** A coding agent's transcript: its `messages` rows are what the agent tab shows and its latest turn is its status. */
  CODING_AGENT: "coding_agent",
} as const;
