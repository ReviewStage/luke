/**
 * The actions Luke can carry for the developer, named as function tools, in one
 * table. Family membership, the spoken tool count, and the schema list are
 * derived from it; adding a tool is adding a row.
 *
 * The session actions are the writes the panel's rows offer. Creating a
 * workspace is the session action with no row yet to mirror. Nothing here
 * reaches the developer's machine: the hosted brain is the only brain, and a
 * device-reaching action is a fresh design over the hosted relay.
 *
 * Whether a call may run is not this file's question: `admit` answers it once,
 * and a row declares only its name, its family, its kind, its prose, and its
 * schema. Luke is another way to ask, never a wider one.
 */

import type { JsonSchemaNode, UnparsedWireValue, WireRecord } from "@sidecar/wire";
import { emitJsonSchema } from "@sidecar/wire/effect";
import { Schema } from "effect";
import { ACTION_FAMILY, ACTION_KIND, type ActionFamily, type ActionKind } from "./action-kinds.js";
import {
  ADD_AGENT_REQUEST,
  CONTROL_REQUEST,
  CREATE_WORKSPACE_REQUEST,
  MESSAGE_REQUEST,
  RENAME_SESSION_REQUEST,
  RENAME_WORKSPACE_REQUEST,
} from "./action-schemas.js";

/** What a row declares: what it is called, what it is, what it says, and what it takes. */
export interface ToolSpec<Family extends ActionFamily, Kind extends ActionKind> {
  readonly name: string;
  readonly family: Family;
  readonly kind: Kind;
  readonly description: string;
  /** The action's own field vocabulary: what admission reads and what the model is shown. */
  readonly request: Schema.Codec<unknown, UnparsedWireValue>;
}

/**
 * A call's fields under the request's own declaration: a key the model was
 * not shown is dropped before admission reads anything, so what is written
 * outside the declaration — a model beside a creation, say — is no ask at all
 * rather than one admission has to argue with. Every request is a struct, so
 * its AST names its own keys.
 */
export function declaredFields(
  spec: ToolSpec<ActionFamily, ActionKind>,
  fields: WireRecord,
): WireRecord {
  const ast = spec.request.ast;
  if (ast._tag !== "Objects") throw new Error(`${spec.name} declares no field table`);
  const declared = new Set<PropertyKey>(ast.propertySignatures.map((signature) => signature.name));
  return Object.fromEntries(Object.entries(fields).filter(([key]) => declared.has(key)));
}

/**
 * A request as `action-schemas.ts` declares it, over its own concrete field
 * table, restated as the vocabulary every `ToolSpec.request` shares: Effect's
 * `Schema` is invariant in its decoded type, so a concrete struct is never
 * itself assignable there, and this is the one cast — through `Schema.make`
 * over the same AST, never `as` — that states it.
 */
function erase(request: Schema.Top): Schema.Codec<unknown, UnparsedWireValue> {
  return Schema.make<Schema.Codec<unknown, UnparsedWireValue>>(request.ast);
}

/**
 * The actions Luke can carry, keyed the way a value set is: adding a tool is
 * adding a key, and the family sets, the spoken count, and the schema list
 * follow.
 */
export const ACTIONS = {
  SEND_SESSION_MESSAGE: {
    name: "send_session_message",
    family: ACTION_FAMILY.SESSION,
    kind: ACTION_KIND.MESSAGE,
    description: "Send a message to an observed session.",
    request: erase(MESSAGE_REQUEST),
  },
  RUN_SESSION_CONTROL: {
    name: "run_session_control",
    family: ACTION_FAMILY.SESSION,
    kind: ACTION_KIND.CONTROL,
    description: "Run a control advertised by an observed session.",
    request: erase(CONTROL_REQUEST),
  },
  CREATE_WORKSPACE: {
    name: "create_workspace",
    family: ACTION_FAMILY.SESSION,
    kind: ACTION_KIND.CREATE_WORKSPACE,
    description: "Create a workspace for a new agent.",
    request: erase(CREATE_WORKSPACE_REQUEST),
  },
  ADD_WORKSPACE_AGENT: {
    name: "add_workspace_agent",
    family: ACTION_FAMILY.SESSION,
    kind: ACTION_KIND.ADD_AGENT,
    description: "Add an agent to an observed workspace.",
    request: erase(ADD_AGENT_REQUEST),
  },
  RENAME_WORKSPACE: {
    name: "rename_workspace",
    family: ACTION_FAMILY.SESSION,
    kind: ACTION_KIND.RENAME_WORKSPACE,
    description:
      "Rename the workspace one observed session runs in, to a name the developer just " +
      "chose — their own words, never a name composed for them. Only sessions whose roster " +
      "entry says the workspace can be renamed take one.",
    request: erase(RENAME_WORKSPACE_REQUEST),
  },
  RENAME_SESSION: {
    name: "rename_session",
    family: ACTION_FAMILY.SESSION,
    kind: ACTION_KIND.RENAME_SESSION,
    description:
      "Rename one observed chat itself — not the workspace around it — to a name the " +
      "developer just chose, in their own words. Only chats whose roster entry says they can " +
      "be renamed take one; an ask that names the workspace renames the workspace instead.",
    request: erase(RENAME_SESSION_REQUEST),
  },
} as const satisfies Record<string, ToolSpec<ActionFamily, ActionKind>>;

function namesFromToolTable<T extends Record<string, { readonly name: string }>>(table: T) {
  // SAFETY: keys are drawn from the same table object; each entry's name field is the tool id.
  const names = {} as { [K in keyof T]: T[K]["name"] };
  // SAFETY: Object.keys returns string[]; every key exists on table because keys are table's own keys.
  for (const key of Object.keys(table) as (keyof T & string)[]) {
    const tool = table[key];
    if (tool) names[key] = tool.name;
  }
  return names;
}

export const ACTION_TOOL = namesFromToolTable(ACTIONS);

const ACTION_LIST: readonly ToolSpec<ActionFamily, ActionKind>[] = Object.values(ACTIONS);

const ACTS_BY_NAME = new Map<string, ToolSpec<ActionFamily, ActionKind>>(
  ACTION_LIST.map((tool) => [tool.name, tool]),
);

/** The kind of action a named tool carries, or nothing when no such tool exists. */
export function actionToolKind(name: string): ActionKind | undefined {
  return ACTS_BY_NAME.get(name)?.kind;
}

/** One function tool as a function-calling request carries it. */
export interface ActionToolDefinition {
  type: "function";
  name: string;
  description: string;
  parameters: JsonSchemaNode;
}

function definitionOf(spec: ToolSpec<ActionFamily, ActionKind>): ActionToolDefinition {
  return {
    type: "function",
    name: spec.name,
    description: spec.description,
    parameters: emitJsonSchema(spec.request),
  };
}

/** The tool schemas the brain's action catalog is declared from. */
export function actionToolDefinitions(): readonly ActionToolDefinition[] {
  return ACTION_LIST.map((tool) => definitionOf(tool));
}

/**
 * Picks the handler for a discriminated `kind`. The map is exhaustive over
 * the union, so a new kind does not compile until its handler is written.
 */
export function dispatchByKind<
  T extends { kind: string },
  R,
  M extends { [K in T["kind"]]: (action: Extract<T, { kind: K }>) => R },
>(action: T, handlers: M): R {
  const kind = action.kind;
  // SAFETY: action.kind is T["kind"]; M is keyed by every member of that union.
  const handle = handlers[kind as T["kind"]];
  // SAFETY: M is keyed by T["kind"]; kind selects the handler that accepts this action shape.
  return handle(action as Extract<T, { kind: typeof kind }>);
}
