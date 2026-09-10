/** The one tool the desktop's call carries, and the shape a call's tools are declared in. */

/** A function tool as the desktop's Realtime session is configured with one. */
export interface MouthToolDefinition {
  type: "function";
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Readonly<Record<string, { type: "string"; description?: string }>>;
    required: readonly string[];
  };
}

/**
 * The tool the voice carries, and the only one: everything about the
 * developer's agents, settings, issues, or anything to be done is asked of
 * the brain, whose answer the voice says word for word, because that answer
 * is also the line Conversation keeps. Its one argument is the developer's
 * own words, so the brain hears the ask as it was made rather than the
 * voice's paraphrase of it.
 */
export const ASK_BRAIN_TOOL = {
  type: "function",
  name: "ask_brain",
  description:
    "Ask Luke's brain — the part of Luke that reads the developer's coding agents, holds the " +
    "roster, settings, issues, and memory, and carries out acts — anything about the developer's " +
    "agents, settings, issues, or anything to do. Pass the developer's words as they said them. " +
    "Say its answer word for word, exactly as written, without rephrasing, shortening, or adding " +
    "to it.",
  parameters: {
    type: "object",
    properties: {
      question: {
        type: "string",
        description: "The developer's ask, in their own words.",
      },
    },
    required: ["question"],
  },
} as const satisfies MouthToolDefinition;

/** The tool schemas the desktop's Realtime session is configured with: the one ask, nothing wider. */
export function mouthToolDefinitions(): readonly MouthToolDefinition[] {
  return [ASK_BRAIN_TOOL];
}
