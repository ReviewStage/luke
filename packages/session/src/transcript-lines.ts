/**
 * The one line vocabulary every transcript rendering speaks, whichever store
 * the words came from: `Developer:` for the person and the agent's own name
 * for its replies. A local file reader and the service's messages read
 * render into the same lines, so the brain reads one shape however a session
 * keeps its conversation.
 */
export const transcriptLine = {
  developer: (words: string) => `Developer: ${words}`,
  agent: (name: string, words: string) => `${name}: ${words}`,
} as const;
