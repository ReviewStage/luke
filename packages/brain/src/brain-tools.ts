import { REALTIME_TOOL, realtimeToolDefinitions } from "@sidecar/acts";

/**
 * The tools the brain is offered: every act the voice model could carry, less
 * the spoken transcript reading, plus the three that exist only for a brain —
 * the roster in full, a whole transcript, and the briefing it hands the mouth.
 *
 * The act rows come from the same table the Realtime session was configured
 * from, so the brain can ask for nothing the acts package does not validate;
 * the three brain-only tools are dispatched inside the agent and reach no act
 * path. `read_session_transcript` is left out because its result was a
 * reading for the developer's ear, and the brain reads for itself.
 */

const BRAIN_TOOL_TYPE = "function";

const SESSION_IDENTITY_PROPERTIES = {
  provider_id: { type: "string", description: "The session provider ID, as the roster lists it." },
  provider_session_id: { type: "string", description: "The session ID, as the roster lists it." },
} as const;

const SESSION_IDENTITY_REQUIRED = ["provider_id", "provider_session_id"] as const;

export const BRAIN_TOOL = {
  LIST_SESSIONS: "list_sessions",
  READ_TRANSCRIPT: "read_transcript",
  ANNOUNCE: "announce",
} as const;

export type BrainToolName = (typeof BRAIN_TOOL)[keyof typeof BRAIN_TOOL];

/** The longest briefing the mouth is handed; a briefing is a breath, not a report. */
export const maximumBriefingLength = 600;

/** The JSON Schema a brain tool's parameters are described in: the acts table's own vocabulary. */
export type BrainSchemaProperty =
  | { type: "string"; description?: string; enum?: readonly string[] }
  | {
      type: "object";
      description?: string;
      properties?: BrainSchemaPropertyMap;
      required?: readonly string[];
      additionalProperties?: boolean;
    }
  | {
      type: "array";
      description?: string;
      items: { type: "string"; description?: string; enum?: readonly string[] };
    };

export type BrainSchemaPropertyMap = { readonly [key: string]: BrainSchemaProperty };

export interface BrainToolParameters {
  type: "object";
  properties: BrainSchemaPropertyMap;
  required: readonly string[];
}

/** A function tool as the Responses API takes it. */
export interface BrainToolWireDefinition {
  type: typeof BRAIN_TOOL_TYPE;
  name: string;
  description: string;
  parameters: BrainToolParameters;
}

const BRAIN_ONLY_TOOLS: readonly BrainToolWireDefinition[] = [
  {
    type: BRAIN_TOOL_TYPE,
    name: BRAIN_TOOL.LIST_SESSIONS,
    description:
      "Read the full roster of observed sessions as it stands right now, with each session's " +
      "identity, status, and capabilities. The standing context already carries it; call this " +
      "only when you need it fresher than the turn's opening.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    type: BRAIN_TOOL_TYPE,
    name: BRAIN_TOOL.READ_TRANSCRIPT,
    description:
      "Read the recent transcript of one observed session in full, bounded to its tail. Use it " +
      "when an event's transcript delta is not enough to judge what the agent is doing. Only a " +
      "local session whose provider's transcript this build reads answers; a cloud session " +
      "returns a refusal.",
    parameters: {
      type: "object",
      properties: SESSION_IDENTITY_PROPERTIES,
      required: SESSION_IDENTITY_REQUIRED,
    },
  },
  {
    type: BRAIN_TOOL_TYPE,
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

const EXCLUDED_ACT_TOOLS: ReadonlySet<string> = new Set([REALTIME_TOOL.READ_SESSION_TRANSCRIPT]);

/** The tool schemas one brain turn is configured with. */
export function brainToolDefinitions(): readonly BrainToolWireDefinition[] {
  const acts = realtimeToolDefinitions()
    .filter((tool) => !EXCLUDED_ACT_TOOLS.has(tool.name))
    .map(
      (tool): BrainToolWireDefinition => ({
        type: BRAIN_TOOL_TYPE,
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      }),
    );
  return [...acts, ...BRAIN_ONLY_TOOLS];
}

const BRAIN_ONLY_TOOL_NAMES: ReadonlySet<string> = new Set(Object.values(BRAIN_TOOL));

/** Whether a call names a tool the agent answers itself rather than an act. */
export function isBrainOnlyTool(name: string): name is BrainToolName {
  return BRAIN_ONLY_TOOL_NAMES.has(name);
}
