import {
  REALTIME_TOOL,
  type RealtimeToolWireDefinition,
  realtimeToolDefinitions,
} from "@sidecar/acts";
import { BRAIN_TURN_AUTHORITY, type BrainTurnAuthority } from "@sidecar/hosted";

/**
 * The tools the brain is offered, fixed by the authority of the turn. A
 * developer turn — an ask they typed or spoke — is offered every act the voice
 * model could carry, less the spoken transcript reading, plus the two reads
 * that exist only for a brain: the roster in full and a whole transcript. An
 * observation turn — a wake, a roster look, a hold release — is offered the
 * two reads and `announce`, and no act at all: nothing a transcript said, a
 * standing ask implied, or a tool answered can widen it, because the toolset
 * is chosen from how the turn was invoked and never from its content.
 *
 * The act rows come from the same table the Realtime session was configured
 * from, so the brain can ask for nothing the acts package does not validate;
 * the brain-only tools are dispatched inside the agent and reach no act path.
 * `read_session_transcript` is left out because its result was a reading for
 * the developer's ear, and the brain reads for itself.
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

const BRAIN_ONLY_TOOLS: readonly RealtimeToolWireDefinition[] = [
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

const BRAIN_ONLY_TOOLS_BY_AUTHORITY = {
  [BRAIN_TURN_AUTHORITY.DEVELOPER]: new Set<string>([
    BRAIN_TOOL.LIST_SESSIONS,
    BRAIN_TOOL.READ_TRANSCRIPT,
  ]),
  [BRAIN_TURN_AUTHORITY.OBSERVATION]: new Set<string>([
    BRAIN_TOOL.LIST_SESSIONS,
    BRAIN_TOOL.READ_TRANSCRIPT,
    BRAIN_TOOL.ANNOUNCE,
  ]),
} as const satisfies Record<BrainTurnAuthority, ReadonlySet<string>>;

function actToolDefinitions(): readonly RealtimeToolWireDefinition[] {
  return realtimeToolDefinitions().filter((tool) => !EXCLUDED_ACT_TOOLS.has(tool.name));
}

/** The tool schemas one brain turn is configured with, fixed by the turn's authority. */
export function brainToolDefinitions(
  authority: BrainTurnAuthority,
): readonly RealtimeToolWireDefinition[] {
  const own = BRAIN_ONLY_TOOLS.filter((tool) =>
    BRAIN_ONLY_TOOLS_BY_AUTHORITY[authority].has(tool.name),
  );
  return authority === BRAIN_TURN_AUTHORITY.DEVELOPER ? [...actToolDefinitions(), ...own] : own;
}

/**
 * Whether a turn of this authority may run a tool of this name at all. It is
 * the runtime side of `brainToolDefinitions`: a model that emits a call for a
 * tool it was never offered is refused here before any performer sees it.
 */
export function brainToolAllowed(authority: BrainTurnAuthority, name: string): boolean {
  return brainToolDefinitions(authority).some((tool) => tool.name === name);
}

const BRAIN_ONLY_TOOL_NAMES: ReadonlySet<string> = new Set(Object.values(BRAIN_TOOL));

/** Whether a call names a tool the agent answers itself rather than an act. */
export function isBrainOnlyTool(name: string): name is BrainToolName {
  return BRAIN_ONLY_TOOL_NAMES.has(name);
}
