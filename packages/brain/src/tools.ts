import { ACTION_KIND, type ActionKind, type ActionToolDefinition } from "@sidecar/actions";
import { type NotebookMemoryToolShape, notebookMemoryToolShapes } from "@sidecar/memory";
import {
  type ChildPolicyContext,
  type EffectiveToolPolicy,
  resolveToolPolicy,
  TOOL_EFFECT,
  TOOL_EXECUTION,
  type ToolDescriptor,
  type ToolPlacement,
  type ToolPolicy,
  type ToolPolicyLayers,
} from "@sidecar/runtime";
import type { ToolSchema } from "@sidecar/runtime/vocabulary";
import type { Schema, WireRecord } from "@sidecar/wire";
import {
  type ResponsesToolDefinition,
  responsesToolDefinition,
  toolSchemaFromDefinition,
} from "./responses-api.js";
import { ACTION_TOOLS, type ActionToolModule } from "./tools/action-tools.js";
import { ANNOUNCE_TOOL } from "./tools/announce-tool.js";
import { BRAIN_TOOL, type BrainToolName, isBrainOnlyTool, TOOL_GROUP } from "./tools/names.js";
import { READ_TOOLS } from "./tools/read-tools.js";
import { SESSION_TOOLS } from "./tools/session-tools.js";
import type { ToolContext, ToolModule } from "./tools/tool-module.js";
import { WORKSPACE_TOOLS } from "./tools/workspace-tools.js";
import { BRAIN_TURN_TRIGGER, type BrainTurnTrigger } from "./turn.js";

export { BRAIN_TOOL, isBrainOnlyTool, maximumBriefingLength, TOOL_GROUP } from "./tools/names.js";

/**
 * The brain's tool catalog: every tool a turn could be offered, as the
 * registry describes it, each one a module. The action rows are the action
 * tool modules, each declared from the same action table the voice's tools were once
 * configured from, so the brain can ask for nothing the actions package does
 * not validate; the brain's own tools — the roster in full, a whole
 * transcript, the briefing, the workspace files, a skill's instructions, and
 * delegation — are dispatched inside the agent and reach no action path; the
 * memory tools are the configured memory provider's own, the notebook's
 * search and read, and the provider's declarations are what the catalog lists
 * for them. Which of the catalog a turn is offered is the effective tool
 * policy's decision, resolved from the configuration's layers and enforced
 * twice by the host: when the schemas are built and again at every dispatch.
 * The one rule fixed by the turn's kind rather than by configuration is the
 * briefing's: `announce` is the voice's channel out of a turn nobody is
 * listening to, so a developer's ask, whose reply is the speech, is not
 * offered it, and neither is a child's task, whose final text is the result
 * its requester reviews; a child reaches the developer only through the
 * conversation that asked for it.
 */

const BRAIN_TOOL_TYPE = "function";

/** The brain's own tools, in the order the catalog lists them. */
export const BRAIN_TOOLS: readonly ToolModule<WireRecord, ToolContext>[] = [
  ...READ_TOOLS,
  ANNOUNCE_TOOL,
  ...WORKSPACE_TOOLS,
  ...SESSION_TOOLS,
];

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
} as const satisfies Record<BrainToolName, ToolPlacement & { groups: readonly string[] }>;

/** A module's schema as the registry carries it: the name, the words, and the JSON its wire schema emits. */
function schemaOf(module: {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Schema<unknown>;
}): ToolSchema {
  const definition: ActionToolDefinition = {
    type: BRAIN_TOOL_TYPE,
    name: module.name,
    description: module.description,
    parameters: module.inputSchema.jsonSchema(),
  };
  return toolSchemaFromDefinition(definition);
}

/** The notebook's two writes keep the memory group beside the action groups, so `group:memory` names the whole of what the notebook does. */
const NOTEBOOK_ACTION_KINDS: ReadonlySet<ActionKind> = new Set([
  ACTION_KIND.REMEMBER,
  ACTION_KIND.FORGET,
]);

function actionDescriptor(tool: ActionToolModule): ToolDescriptor {
  return {
    schema: schemaOf(tool),
    execution: TOOL_EXECUTION.PERFORMER,
    effect: TOOL_EFFECT.WRITE,
    groups: NOTEBOOK_ACTION_KINDS.has(tool.kind)
      ? [TOOL_GROUP.MEMORY, TOOL_GROUP.ACTIONS, tool.family]
      : [TOOL_GROUP.ACTIONS, tool.family],
  };
}

function brainOnlyDescriptor(module: ToolModule<WireRecord, ToolContext>): ToolDescriptor {
  const name = module.name;
  if (!isBrainOnlyTool(name)) throw new TypeError(`${name} is not a brain tool`);
  return { schema: schemaOf(module), ...BRAIN_ONLY_DESCRIPTORS[name] };
}

/** The memory provider's reads as the catalog places them: a read like the roster's, under the memory group. */
function memoryDescriptor(shape: NotebookMemoryToolShape): ToolDescriptor {
  return {
    schema: schemaOf(shape),
    execution: TOOL_EXECUTION.MEMORY,
    effect: shape.effect,
    groups: [TOOL_GROUP.MEMORY, TOOL_GROUP.READ],
  };
}

/** The whole catalog as descriptors: every action, then the brain's own tools, then the memory provider's, in a fixed order. */
export function brainToolCatalog(): readonly ToolDescriptor[] {
  return [
    ...ACTION_TOOLS.map(actionDescriptor),
    ...BRAIN_TOOLS.map(brainOnlyDescriptor),
    ...notebookMemoryToolShapes().map(memoryDescriptor),
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
 * A tool as a reader's registry holds it: its name, its words, and the wire
 * schema its input is declared in once. The catalog's descriptor carries that
 * schema only as the emitted JSON a model is shown; a store reading a tool
 * part back needs the declaration itself, so the input it finds in a row is
 * read under the same rule the model was offered rather than under a copy.
 */
export interface BrainToolRegistration {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Schema<unknown>;
}

/** Every catalog tool with its wire schema, keyed by name, in the catalog's order. */
export function brainToolRegistry(): ReadonlyMap<string, BrainToolRegistration> {
  const modules: readonly BrainToolRegistration[] = [
    ...ACTION_TOOLS,
    ...BRAIN_TOOLS,
    ...notebookMemoryToolShapes(),
  ];
  return new Map(
    modules.map(({ name, description, inputSchema }) => [name, { name, description, inputSchema }]),
  );
}

/**
 * Every tool a hosted request may select by name, in the Responses
 * function-tool form: the catalog's own schemas, act and brain tool alike.
 * The service selects schemas from this catalog and nothing a caller sends;
 * a desktop checks the names it means to send against the catalog the
 * service advertised; the trace viewer renders a turn's tools from it.
 */
export function hostedBrainToolCatalog(): ReadonlyMap<string, ResponsesToolDefinition> {
  return new Map(
    brainToolCatalog().map((tool) => [tool.schema.name, responsesToolDefinition(tool.schema)]),
  );
}
