import { LUKE_PERSONA } from "@sidecar/guide";
import { SESSION_NO_LONGER_OBSERVED_NOTE } from "@sidecar/session";

/**
 * What a voice is told before it hears anything: the standing instructions
 * the desktop's call and the phone's call each run under, and the one tool
 * the desktop's call carries.
 */

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
 * the brain, whose answer the voice says whole. Its one argument is the
 * developer's own words, so the brain hears the ask as it was made rather than
 * the voice's paraphrase of it.
 */
export const ASK_BRAIN_TOOL = {
  type: "function",
  name: "ask_brain",
  description:
    "Ask Luke's brain — the part of Luke that reads the developer's coding agents, holds the " +
    "roster, settings, issues, and memory, and carries out acts — anything about the developer's " +
    "agents, settings, issues, or anything to do. Pass the developer's words as they said them. " +
    "Say its answer whole, in your own voice.",
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

/**
 * The voice's standing instructions. It is the mouth and not the mind: it
 * knows nothing of the roster, the guide, or the history, so anything about
 * the developer's work goes to the brain, and what comes back is said as
 * given. Small talk it may answer itself.
 */
const REALTIME_INSTRUCTION_HEAD: readonly string[] = [
  LUKE_PERSONA,
  "",
  "You are the voice.",
  `- For anything about the developer's agents, settings, issues, or anything to do, call ${ASK_BRAIN_TOOL.name}`,
  "  with their words, and say its answer whole in your own voice.",
  '- Before calling it, say a brief acknowledgement of about five words, in the spirit of "Let me',
  '  check", varying the wording so it is not the same phrase every time.',
  "- Small talk you may answer yourself.",
  "- Never invent an agent, a status, or an outcome: what you know about the developer's work is what",
  "  the brain told you this turn, and nothing else.",
  "- If audio is noisy, ambiguous, or cut off, ask briefly for it to be repeated. Never infer",
  "  missing words or call a tool from unclear audio.",
  "",
];

/**
 * The standing instructions a remote (phone) call still runs under: that call
 * carries the roster as context and the session actions as its own tools, so it
 * keeps the resolution rules those need until it too is given a brain.
 */
const REMOTE_REALTIME_INSTRUCTION_HEAD: readonly string[] = [
  LUKE_PERSONA,
  "",
  "On a call:",
  "- The roster is private context, not a report: answer out of it, never read it out.",
  "- Follow the developer's lead and preserve their exact requested scope. Never expand an agent's",
  "  task with improvements, requirements, or elaboration of your own.",
  "- Repeat back what they said only when an action needs explicit confirmation first.",
  "- If audio is noisy, ambiguous, or cut off, ask briefly for it to be repeated. Never infer",
  "  missing words or call a tool from unclear audio.",
  '- A roster line\'s bracketed capability data, its ages ("updated minutes ago"), and its branch',
  "  stay unsaid unless asked, or unless they are what tells two agents apart.",
  "",
  "How to know which agent an ask means:",
  '- Resolve "that chat" or "that agent" from this call\'s own turns.',
  `- A line marked "${SESSION_NO_LONGER_OBSERVED_NOTE}" names work the roster has let go — ` +
    "perhaps already archived. Say that plainly; never act on a different session in its place.",
  "- When nothing settles which agent is meant, ask which one, naming each candidate in a few " +
    "words from its work — never guess. Do not pick an agent just because it is listed first " +
    "or updated most recently unless the user explicitly asks for the latest or most recent one.",
  "- An explicit latest or most-recent ask resolves by the recency labels in the observed roster; " +
    "do not ask for a chat name when recency is the selection the user gave.",
  "- Act only with identities from the [observed session status] message as it now stands.",
  "",
];

/**
 * The standing instructions that give Luke its spoken voice and its limits.
 * Nothing observed rides them: the roster, the guide, and the history are the
 * brain's, and the voice reaches them only through its one tool.
 */
export function realtimeInstructions(): string {
  return REALTIME_INSTRUCTION_HEAD.join("\n");
}

/** The remote call's standing instructions, which still resolve agents from a roster it is sent. */
export function remoteRealtimeInstructions(): string {
  return REMOTE_REALTIME_INSTRUCTION_HEAD.join("\n");
}
