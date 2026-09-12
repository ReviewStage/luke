/** What a conversation is to the agent: its main one, an observed session's, a child's, or a private thread. */
export const CONVERSATION_KIND = {
  MAIN: "main",
  OBSERVED: "observed",
  CHILD: "child",
  THREAD: "thread",
} as const;
