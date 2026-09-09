import { type ActToolDefinition, realtimeToolDefinitions, realtimeToolFamily } from "@sidecar/acts";
import { MEMORY_QUERY_MAXIMUM_CHARS } from "@sidecar/memory";
import {
  type ChildPolicyContext,
  type EffectiveToolPolicy,
  resolveToolPolicy,
  TOOL_EFFECT,
  TOOL_EXECUTION,
  type ToolDescriptor,
  type ToolPolicy,
  type ToolPolicyLayers,
} from "@sidecar/runtime";
import type { ToolSchema } from "@sidecar/runtime/vocabulary";
import {
  type ResponsesToolDefinition,
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
 * instructions, the notebook's search and read — are dispatched inside the
 * agent and reach no act path.
 * Which of the catalog a turn is offered is the effective tool policy's
 * decision, resolved from the configuration's layers and enforced twice by
 * the host: when the schemas are built and again at every dispatch. The one
 * rule fixed by the turn's kind rather than by configuration is the
 * briefing's: `announce` is the voice's channel out of a turn nobody is
 * listening to, so a developer's ask, whose reply is the speech, is not
 * offered it, and neither is a child's task, whose final text is the result
 * its requester reviews; a child reaches the developer only through the
 * conversation that asked for it.
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
  SESSIONS_SPAWN: "sessions_spawn",
  SUBAGENTS: "subagents",
  SESSIONS_LIST: "sessions_list",
  SESSIONS_HISTORY: "sessions_history",
  MEMORY_SEARCH: "memory_search",
  MEMORY_GET: "memory_get",
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
  /** Delegation and the inspection of Luke's own conversations, OpenClaw's session tools. */
  SESSIONS: "sessions",
  /** The notebook's search and read, OpenClaw's memory tools. */
  MEMORY: "memory",
} as const;

/** The most results one memory search answers, and the longest query it takes. */
export const maximumMemorySearchResults = 20;
export const maximumMemoryQueryLength = MEMORY_QUERY_MAXIMUM_CHARS;

/** The most of a child task's words a spawn carries; a task is a brief, not a transcript. */
export const maximumChildTaskLength = 8_000;

/** The most history lines one `sessions_history` read answers with. */
export const maximumSessionsHistoryLines = 50;

const BRAIN_ONLY_TOOLS: readonly ActToolDefinition[] = [
  {
    type: BRAIN_TOOL_TYPE,
    name: BRAIN_TOOL.LIST_SESSIONS,
    description:
      "Read the full roster of observed sessions as it stands right now, with each session's " +
      "identity, status, and capabilities. The standing context already carries it; call this " +
      "only when you need it fresher than the turn's opening.",
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
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
      additionalProperties: false,
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
      additionalProperties: false,
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
      additionalProperties: false,
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
      additionalProperties: false,
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
      additionalProperties: false,
    },
  },
  {
    type: BRAIN_TOOL_TYPE,
    name: BRAIN_TOOL.SESSIONS_SPAWN,
    description:
      "Delegate a task to a child agent that runs in a conversation of its own and reports back " +
      "when it ends. The answer is a receipt that the child was accepted — its identifiers, the " +
      "model it runs on, and the context it actually started with — never its result. Do not " +
      "poll for the result: end your turn as usual and the completion arrives in this " +
      'conversation as its own item. Children start isolated unless context is "fork", ' +
      "which branches this conversation's current context into the child when it fits the cap.",
    parameters: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: `The task, briefed in full, under ${maximumChildTaskLength} characters.`,
        },
        label: { type: "string", description: "A short title for the work, for listings." },
        context: {
          type: "string",
          enum: ["isolated", "fork"],
          description: "How the child's context starts; isolated by default.",
        },
        cleanup: {
          type: "string",
          enum: ["keep", "delete"],
          description:
            "Whether the child's conversation is kept for an hour after it ends (default) or archived at once.",
        },
        run_timeout_seconds: {
          type: "integer",
          description:
            "A deadline for this child alone; 0, the default, means none beyond the ordinary run deadline.",
        },
        expects_completion: {
          type: "boolean",
          description:
            "False for a fire-and-forget child whose end is not reported back; true by default.",
        },
      },
      required: ["task"],
      additionalProperties: false,
    },
  },
  {
    type: BRAIN_TOOL_TYPE,
    name: BRAIN_TOOL.SUBAGENTS,
    description:
      "List the children this conversation asked for — each with its id, label, status, and " +
      "when it was accepted and settled — or cancel one by id. Cancelling reaches every child " +
      "it spawned in turn. Check status only when debugging; completions arrive on their own.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list", "cancel"],
          description: "What to do; list by default.",
        },
        child_id: { type: "string", description: "The child to cancel, as the list gave it." },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    type: BRAIN_TOOL_TYPE,
    name: BRAIN_TOOL.SESSIONS_LIST,
    description:
      "List Luke's own conversations — main, the developer's threads, the observed sessions' " +
      "conversations, and child conversations — by key, kind, name, and last activity. These " +
      "are your own conversations, not the coding agents the roster lists.",
    parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  {
    type: BRAIN_TOOL_TYPE,
    name: BRAIN_TOOL.SESSIONS_HISTORY,
    description:
      "Read the recent history of one child this conversation asked for, most recent last, " +
      `bounded to ${maximumSessionsHistoryLines} lines. Only a child of this conversation answers.`,
    parameters: {
      type: "object",
      properties: {
        child_id: { type: "string", description: "The child, as the subagents list gave it." },
        limit: { type: "integer", description: "How many lines at most." },
      },
      required: ["child_id"],
      additionalProperties: false,
    },
  },
  {
    type: BRAIN_TOOL_TYPE,
    name: BRAIN_TOOL.MEMORY_SEARCH,
    description:
      "Mandatory recall step: search your notebook — MEMORY.md, USER.md, and the notes under " +
      "memory/ — before answering anything about prior work, decisions, dates, people, " +
      "preferences, or todos. Each result names its file, line range, score, and provenance; " +
      "the answer names the retrieval mode it actually ran in (hybrid or keyword-only) and a " +
      "note when it was not hybrid. Say you checked when confidence is low.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: `What to look for, under ${maximumMemoryQueryLength} characters.`,
        },
        max_results: {
          type: "integer",
          description: `How many results at most; ${maximumMemorySearchResults} is the ceiling.`,
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    type: BRAIN_TOOL_TYPE,
    name: BRAIN_TOOL.MEMORY_GET,
    description:
      "Read an exact excerpt of one notebook file by the path a memory_search result named: " +
      "MEMORY.md, USER.md, or memory/<note>.md. Defaults to a bounded excerpt when lines are " +
      "omitted and says when more content follows. Nothing outside the notebook can be named.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "The file's path relative to the notebook, as a result named it.",
        },
        from: { type: "integer", description: "The first line to read, counting from 1." },
        lines: { type: "integer", description: "How many lines to read." },
      },
      required: ["path"],
      additionalProperties: false,
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
  [BRAIN_TOOL.SESSIONS_SPAWN]: {
    execution: TOOL_EXECUTION.HOST,
    effect: TOOL_EFFECT.WRITE,
    groups: [TOOL_GROUP.SESSIONS],
  },
  [BRAIN_TOOL.SUBAGENTS]: {
    execution: TOOL_EXECUTION.HOST,
    effect: TOOL_EFFECT.WRITE,
    groups: [TOOL_GROUP.SESSIONS],
  },
  [BRAIN_TOOL.SESSIONS_LIST]: {
    execution: TOOL_EXECUTION.HOST,
    effect: TOOL_EFFECT.READ,
    groups: [TOOL_GROUP.SESSIONS, TOOL_GROUP.READ],
  },
  [BRAIN_TOOL.SESSIONS_HISTORY]: {
    execution: TOOL_EXECUTION.HOST,
    effect: TOOL_EFFECT.READ,
    groups: [TOOL_GROUP.SESSIONS, TOOL_GROUP.READ],
  },
  [BRAIN_TOOL.MEMORY_SEARCH]: {
    execution: TOOL_EXECUTION.HOST,
    effect: TOOL_EFFECT.READ,
    groups: [TOOL_GROUP.MEMORY, TOOL_GROUP.READ],
  },
  [BRAIN_TOOL.MEMORY_GET]: {
    execution: TOOL_EXECUTION.HOST,
    effect: TOOL_EFFECT.READ,
    groups: [TOOL_GROUP.MEMORY, TOOL_GROUP.READ],
  },
} as const satisfies Record<BrainToolName, Pick<ToolDescriptor, "execution" | "effect" | "groups">>;

function actDescriptor(definition: ActToolDefinition): ToolDescriptor {
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

function brainOnlyDescriptor(definition: ActToolDefinition): ToolDescriptor {
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
  return trigger === BRAIN_TURN_TRIGGER.ASK || trigger === BRAIN_TURN_TRIGGER.CHILD_TASK
    ? { deny: [BRAIN_TOOL.ANNOUNCE] }
    : {};
}

/**
 * The one resolution a turn's tools get: the configured layers over the
 * catalog, the child restriction when the conversation is a child's, then
 * the turn's own layer. Maintenance names no trigger and adds no layer of
 * its own, because it runs no tools.
 */
export function resolveTurnToolPolicy(
  catalog: readonly ToolDescriptor[],
  layers: ToolPolicyLayers,
  trigger?: BrainTurnTrigger,
  child?: ChildPolicyContext,
): EffectiveToolPolicy {
  return resolveToolPolicy(
    catalog,
    layers,
    child,
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
export function hostedBrainToolCatalog(): ReadonlyMap<string, ResponsesToolDefinition> {
  return new Map(brainToolCatalog().map((tool) => [tool.id, responsesToolDefinition(tool.schema)]));
}
