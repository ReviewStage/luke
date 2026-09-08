import {
  type RealtimeToolWireDefinition,
  realtimeToolDefinitions,
  realtimeToolFamily,
} from "@sidecar/acts";
import { BRAIN_TURN_AUTHORITY, type BrainTurnAuthority } from "@sidecar/hosted";
import {
  type EffectiveToolPolicy,
  resolveToolPolicy,
  TOOL_EFFECT,
  TOOL_EXECUTION,
  type ToolDescriptor,
  type ToolPolicy,
  type ToolPolicyLayers,
} from "@sidecar/runtime";
import type { ToolSchema } from "@sidecar/runtime-contracts";
import {
  type ResponsesFunctionTool,
  responsesToolDefinition,
  toolSchemaFromDefinition,
} from "./responses-api.js";
import { BRAIN_TURN_TRIGGER, type BrainTurnTrigger } from "./turn.js";

/**
 * The brain's tool catalog: every tool a turn could be offered, as the
 * registry describes it. The act rows come from the same table the Realtime
 * session was configured from, so the brain can ask for nothing the acts
 * package does not validate; the brain's own tools — the roster in full, a
 * whole transcript, the briefing, the workspace files, a skill's
 * instructions — are dispatched inside the agent and reach no act path.
 * Which of the catalog a turn is offered is the effective tool policy's
 * decision, resolved from the configuration's layers and enforced twice by
 * the host: when the schemas are built and again at every dispatch. The one
 * rule fixed by the turn's kind rather than by configuration is the
 * briefing's: `announce` is the voice's channel out of a turn nobody is
 * listening to, so a developer's ask, whose reply is the speech, is not
 * offered it.
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
  READ_WORKSPACE_FILE: "read_workspace_file",
  WRITE_WORKSPACE_FILE: "write_workspace_file",
  LOAD_SKILL: "load_skill",
} as const;

export type BrainToolName = (typeof BRAIN_TOOL)[keyof typeof BRAIN_TOOL];

/** The longest briefing the mouth is handed; a briefing is a breath, not a report. */
export const maximumBriefingLength = 600;

export const TOOL_GROUP = {
  READ: "read",
  ACTS: "acts",
  SPEAK: "speak",
  WORKSPACE: "workspace",
  SKILLS: "skills",
} as const;

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
  {
    type: BRAIN_TOOL_TYPE,
    name: BRAIN_TOOL.READ_WORKSPACE_FILE,
    description:
      "Read one of your own workspace files whole: AGENTS.md, SOUL.md, IDENTITY.md, USER.md, " +
      "MEMORY.md, BOOTSTRAP.md, HEARTBEAT.md, or a dated note as memory/YYYY-MM-DD.md. Nothing " +
      "outside the workspace can be named.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "The file's name relative to the workspace." },
      },
      required: ["name"],
    },
  },
  {
    type: BRAIN_TOOL_TYPE,
    name: BRAIN_TOOL.WRITE_WORKSPACE_FILE,
    description:
      "Replace one of your own workspace files with new content, whole. Use it to keep " +
      "MEMORY.md, USER.md, and dated notes current; read the file first so nothing is lost. " +
      "Content past the per-file bound is refused rather than cut.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "The file's name relative to the workspace." },
        content: { type: "string", description: "The file's whole new content." },
      },
      required: ["name", "content"],
    },
  },
  {
    type: BRAIN_TOOL_TYPE,
    name: BRAIN_TOOL.LOAD_SKILL,
    description:
      "Load one skill's full instructions by the location the available skills list gave. Only " +
      "a listed location answers.",
    parameters: {
      type: "object",
      properties: {
        location: { type: "string", description: "The SKILL.md location exactly as listed." },
      },
      required: ["location"],
    },
  },
];

const BRAIN_ONLY_TOOL_NAMES: ReadonlySet<string> = new Set(Object.values(BRAIN_TOOL));

/** Whether a call names a tool the agent answers itself rather than an act. */
export function isBrainOnlyTool(name: string): name is BrainToolName {
  return BRAIN_ONLY_TOOL_NAMES.has(name);
}

const BRAIN_ONLY_DESCRIPTORS = {
  [BRAIN_TOOL.LIST_SESSIONS]: {
    execution: TOOL_EXECUTION.HOST,
    effect: TOOL_EFFECT.READ,
    groups: [TOOL_GROUP.READ],
  },
  [BRAIN_TOOL.READ_TRANSCRIPT]: {
    execution: TOOL_EXECUTION.HOST,
    effect: TOOL_EFFECT.READ,
    groups: [TOOL_GROUP.READ],
  },
  [BRAIN_TOOL.ANNOUNCE]: {
    execution: TOOL_EXECUTION.HOST,
    effect: TOOL_EFFECT.SPEAK,
    groups: [TOOL_GROUP.SPEAK],
  },
  [BRAIN_TOOL.READ_WORKSPACE_FILE]: {
    execution: TOOL_EXECUTION.WORKSPACE,
    effect: TOOL_EFFECT.READ,
    groups: [TOOL_GROUP.WORKSPACE, TOOL_GROUP.READ],
  },
  [BRAIN_TOOL.WRITE_WORKSPACE_FILE]: {
    execution: TOOL_EXECUTION.WORKSPACE,
    effect: TOOL_EFFECT.WRITE,
    groups: [TOOL_GROUP.WORKSPACE],
  },
  [BRAIN_TOOL.LOAD_SKILL]: {
    execution: TOOL_EXECUTION.WORKSPACE,
    effect: TOOL_EFFECT.READ,
    groups: [TOOL_GROUP.SKILLS, TOOL_GROUP.READ],
  },
} as const satisfies Record<BrainToolName, Pick<ToolDescriptor, "execution" | "effect" | "groups">>;

function actDescriptor(definition: RealtimeToolWireDefinition): ToolDescriptor {
  const family = realtimeToolFamily(definition.name);
  if (family === undefined) throw new TypeError(`${definition.name} is not an act`);
  return {
    id: definition.name,
    schema: toolSchemaFromDefinition(definition),
    execution: TOOL_EXECUTION.PERFORMER,
    effect: TOOL_EFFECT.WRITE,
    groups: [TOOL_GROUP.ACTS, family],
  };
}

function brainOnlyDescriptor(definition: RealtimeToolWireDefinition): ToolDescriptor {
  const name = definition.name;
  if (!isBrainOnlyTool(name)) throw new TypeError(`${name} is not a brain tool`);
  return {
    id: name,
    schema: toolSchemaFromDefinition(definition),
    ...BRAIN_ONLY_DESCRIPTORS[name],
  };
}

/** The whole catalog as descriptors: every act, then the brain's own tools, in a fixed order. */
export function brainToolCatalog(): readonly ToolDescriptor[] {
  return [
    ...realtimeToolDefinitions().map(actDescriptor),
    ...BRAIN_ONLY_TOOLS.map(brainOnlyDescriptor),
  ];
}

/**
 * The layer a turn's kind adds beneath the configured policy: the briefing
 * channel is offered only where the reply is not itself the speech. It is a
 * fact about the voice, not a permission decided from who opened the turn.
 */
export function turnToolPolicy(trigger: BrainTurnTrigger): ToolPolicy {
  return trigger === BRAIN_TURN_TRIGGER.ASK ? { deny: [BRAIN_TOOL.ANNOUNCE] } : {};
}

/**
 * The one resolution a turn's tools get: the configured layers over the
 * catalog, then the turn's own layer. Maintenance names no trigger and adds
 * no layer of its own, because it runs no tools.
 */
export function resolveTurnToolPolicy(
  catalog: readonly ToolDescriptor[],
  layers: ToolPolicyLayers,
  trigger?: BrainTurnTrigger,
): EffectiveToolPolicy {
  return resolveToolPolicy(
    catalog,
    layers,
    undefined,
    trigger === undefined ? undefined : turnToolPolicy(trigger),
  );
}

/** The schemas an effective policy leaves, in catalog order. */
export function brainToolSchemas(policy: EffectiveToolPolicy): readonly ToolSchema[] {
  return policy.allowed.map((tool) => tool.schema);
}

/**
 * Every tool a hosted request may select by name, in the Responses
 * function-tool form: the catalog's own schemas, act and brain tool alike.
 * The service selects schemas from this catalog and nothing a caller sends;
 * a desktop checks the names it means to send against the catalog the
 * service advertised; the trace viewer renders a turn's tools from it.
 */
export function hostedBrainToolCatalog(): ReadonlyMap<string, ResponsesFunctionTool> {
  return new Map(brainToolCatalog().map((tool) => [tool.id, responsesToolDefinition(tool.schema)]));
}

/**
 * The toolsets the first hosted contract fixed from a turn's authority, kept
 * for installed clients still speaking it: a developer turn was offered every
 * act and the two reads, an observation turn the two reads and the briefing.
 * The current desktop names its tools itself under the second contract and
 * never sends an authority; nothing new is built on this table.
 */
export function hostedBrainV1ToolDefinitions(
  authority: BrainTurnAuthority,
): readonly RealtimeToolWireDefinition[] {
  const reads = BRAIN_ONLY_TOOLS.filter(
    (tool) => tool.name === BRAIN_TOOL.LIST_SESSIONS || tool.name === BRAIN_TOOL.READ_TRANSCRIPT,
  );
  if (authority === BRAIN_TURN_AUTHORITY.DEVELOPER) {
    return [...realtimeToolDefinitions(), ...reads];
  }
  return [...reads, ...BRAIN_ONLY_TOOLS.filter((tool) => tool.name === BRAIN_TOOL.ANNOUNCE)];
}
