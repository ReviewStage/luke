import {
  REALTIME_TOOL,
  type RealtimeToolWireDefinition,
  realtimeToolDefinitions,
} from "@sidecar/acts";

/**
 * The tools the brain is offered: in a developer-ask turn, every act the voice
 * model could carry, less the spoken transcript reading, plus the two that
 * exist only for a brain — a whole transcript, and the briefing it hands the
 * mouth. In an observed-events or hold-released turn, the two alone: no act
 * is declared at the API, so nothing a transcript says can become one.
 *
 * The act rows come from the same table the Realtime session was configured
 * from, so the brain can ask for nothing the acts package does not validate;
 * the brain-only tools are dispatched inside the agent and reach no act path.
 * `read_session_transcript` is left out because its result was a reading for
 * the developer's ear, and the brain reads for itself.
 */

const SESSION_IDENTITY_PROPERTIES = {
  provider_id: { type: "string", description: "The session provider ID, as the roster lists it." },
  provider_session_id: { type: "string", description: "The session ID, as the roster lists it." },
} as const;

export const BRAIN_TOOL = {
  READ_TRANSCRIPT: "read_transcript",
  ANNOUNCE: "announce",
} as const;

export type BrainToolName = (typeof BRAIN_TOOL)[keyof typeof BRAIN_TOOL];

/** The longest briefing the mouth is handed; a briefing is a breath, not a report. */
export const maximumBriefingLength = 600;

const BRAIN_ONLY_TOOLS: readonly RealtimeToolWireDefinition[] = [
  {
    type: "function",
    name: BRAIN_TOOL.READ_TRANSCRIPT,
    description:
      "Read the recent transcript of one observed session in full, bounded to its tail. Use it " +
      "when an event's transcript delta is not enough to judge what the agent is doing. Only a " +
      "local session whose provider's transcript this build reads answers; a cloud session " +
      "returns a refusal.",
    parameters: {
      type: "object",
      properties: SESSION_IDENTITY_PROPERTIES,
      required: ["provider_id", "provider_session_id"],
    },
  },
  {
    type: "function",
    name: BRAIN_TOOL.ANNOUNCE,
    description:
      "Hand the developer one spoken briefing about what changed. Call it at most once per " +
      "observed-events turn, covering every agent worth mentioning in one breath, or not at all " +
      "when nothing is worth interrupting for. Never call it in a developer-ask turn: there your " +
      "final text is the reply.",
    parameters: {
      type: "object",
      properties: {
        briefing: {
          type: "string",
          description: `What Luke says aloud, in his own voice, under ${maximumBriefingLength} characters.`,
        },
      },
      required: ["briefing"],
    },
  },
];

/** The tool schemas one brain turn is configured with; acts only when the turn allows them. */
export function brainToolDefinitions(withActs = true): readonly RealtimeToolWireDefinition[] {
  const acts = withActs
    ? realtimeToolDefinitions().filter(
        (tool) => tool.name !== REALTIME_TOOL.READ_SESSION_TRANSCRIPT,
      )
    : [];
  return [...acts, ...BRAIN_ONLY_TOOLS];
}

const BRAIN_ONLY_TOOL_NAMES: ReadonlySet<string> = new Set(Object.values(BRAIN_TOOL));

/** Whether a call names a tool the agent answers itself rather than an act. */
export function isBrainOnlyTool(name: string): name is BrainToolName {
  return BRAIN_ONLY_TOOL_NAMES.has(name);
}
