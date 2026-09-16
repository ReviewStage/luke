/** What a conversation is to the agent: its main one, an observed session's, or a child's. */
export const CONVERSATION_KIND = {
  MAIN: "main",
  OBSERVED: "observed",
  CHILD: "child",
} as const;
