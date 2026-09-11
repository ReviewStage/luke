/**
 * The one line vocabulary every transcript rendering speaks, whichever store
 * the words came from: `Developer:` for the person, the agent's own name for
 * its replies, `→` for a tool call, `←` for its answer, `Error:` for a failure
 * the provider recorded. A local file reader and the service's messages read
 * render into the same lines, so the brain reads one shape however a session
 * keeps its conversation.
 */
export const transcriptLine = {
  developer: (words: string) => `Developer: ${words}`,
  agent: (name: string, words: string) => `${name}: ${words}`,
  toolCall: (name: string, detail?: string) => (detail ? `→ ${name}: ${detail}` : `→ ${name}`),
  toolResult: (answer: string) => `← ${answer}`,
  error: (reason: string) => `Error: ${reason}`,
} as const;
