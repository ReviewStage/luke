/**
 * The actions Luke can carry for the developer, named as function tools, in one
 * table. Family membership, the spoken tool count, and the schema list are
 * derived from it; adding a tool is adding a row.
 *
 * The session actions are the ones the panel's rows offer — the writes, and the
 * press that opens a session where its provider keeps it — and the issue pair
 * are the two actions a connected tracker takes. Creating a workspace is the
 * session action with no row yet to mirror. The last six are the same presses
 * turned toward the app itself: a settings change, showing the panel, opening
 * the feedback composer, the Updates row's button, and the notebook's two writes.
 *
 * Whether a call may run is not this file's question: `admit` answers it once,
 * and a row declares only its name, its family, its kind, its prose, and its
 * schema. Luke is another way to ask, never a wider one.
 */

import {
  type JsonSchemaNode,
  s,
  type UnparsedWireValue,
  type Schema as WireSchema,
} from "@sidecar/wire";
import { emitJsonSchema, readEither, toSchemaRead } from "@sidecar/wire/effect";
import { Schema } from "effect";
import { ACTION_FAMILY, ACTION_KIND, type ActionFamily, type ActionKind } from "./action-kinds.js";
import {
  ADD_AGENT_REQUEST,
  CONTROL_REQUEST,
  CREATE_WORKSPACE_REQUEST,
  FEEDBACK_REQUEST,
  FORGET_REQUEST,
  ISSUE_COMMENT_REQUEST,
  ISSUE_STATE_REQUEST,
  MESSAGE_REQUEST,
  OPEN_REQUEST,
  PANEL_REQUEST,
  REMEMBER_REQUEST,
  REMOTE_OPEN_REQUEST,
  REMOTE_PANEL_REQUEST,
  RENAME_SESSION_REQUEST,
  RENAME_WORKSPACE_REQUEST,
  SETTING_REQUEST,
  UPDATE_REQUEST,
} from "./action-schemas.js";

/** What a row declares: what it is called, what it is, what it says, and what it takes. */
export interface ToolSpec<Family extends ActionFamily, Kind extends ActionKind> {
  readonly name: string;
  readonly family: Family;
  readonly kind: Kind;
  readonly description: string;
  /** The action's own field vocabulary: what admission reads and what the model is shown. */
  readonly request: Schema.Schema<unknown, UnparsedWireValue>;
  /**
   * The same action as the phone offers it, where the phone's surface gives the
   * action a different shape: an open lands on the app's own screen rather than
   * a provider's address, and the list narrows on the axes its chips hold.
   * Absent, the phone is handed the desktop's.
   */
  readonly remote?: {
    readonly description: string;
    readonly request: Schema.Schema<unknown, UnparsedWireValue>;
  };
}

/**
 * A request as `action-schemas.ts` declares it, over its own concrete field
 * table, restated as the vocabulary every `ToolSpec.request` shares: Effect's
 * `Schema` is invariant in its decoded type, so a concrete struct is never
 * itself assignable there, and this is the one cast — through `Schema.make`
 * over the same AST, never `as` — that states it.
 */
function erase<A, I>(request: Schema.Schema<A, I>): Schema.Schema<unknown, UnparsedWireValue> {
  return Schema.make(request.ast);
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
  OPEN_SESSION: {
    name: "open_session",
    family: ACTION_FAMILY.SESSION,
    kind: ACTION_KIND.OPEN,
    description:
      "Open one observed session where its provider keeps it — only when the developer asks " +
      "to open, go to, or jump into that specific session. An ask to show, see, or list " +
      'sessions or agents — "show me the cloud agents" — filters the panel through ' +
      "show_panel instead, never this. An ask to open one session per provider uses this tool " +
      "once per matching provider in the same response, without filtering the panel first.",
    request: erase(OPEN_REQUEST),
    remote: {
      description:
        "Open one observed session's own screen in this app, leaving this conversation — only " +
        "when the developer asks to open, go to, or jump into that specific session. An ask to " +
        'show, see, or list sessions or agents — "show me the waiting sessions" — narrows the ' +
        "list through show_panel instead, never this. The phone shows one screen, so open one " +
        "session per response; asked for several, ask which.",
      request: erase(REMOTE_OPEN_REQUEST),
    },
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
  UPDATE_ISSUE_STATE: {
    name: "update_issue_state",
    family: ACTION_FAMILY.ISSUE,
    kind: ACTION_KIND.ISSUE_STATE,
    description: "Update a tracked issue's state.",
    request: erase(ISSUE_STATE_REQUEST),
  },
  COMMENT_ON_ISSUE: {
    name: "comment_on_issue",
    family: ACTION_FAMILY.ISSUE,
    kind: ACTION_KIND.ISSUE_COMMENT,
    description: "Add a comment to a tracked issue.",
    request: erase(ISSUE_COMMENT_REQUEST),
  },
  CHANGE_APP_SETTING: {
    name: "change_app_setting",
    family: ACTION_FAMILY.APP,
    kind: ACTION_KIND.SETTING,
    description: "Change a Luke setting.",
    request: erase(SETTING_REQUEST),
  },
  SHOW_PANEL: {
    name: "show_panel",
    family: ACTION_FAMILY.APP,
    kind: ACTION_KIND.PANEL,
    description:
      "Show Luke's panel on a tab — and, on the sessions tab, narrow or reorder the list. " +
      'An ask to show, see, or list sessions or agents of some kind — "show me the Codex ' +
      'agents", "show me my local sessions" — is this tool with a filter, not open_session.',
    request: erase(PANEL_REQUEST),
    remote: {
      description:
        "Show the session list — and narrow, search, or reorder it. An ask to show, see, or " +
        'list sessions of some kind — "show me the waiting sessions", "show me the Conductor ' +
        'agents" — is this tool with a filter, not open_session.',
      request: erase(REMOTE_PANEL_REQUEST),
    },
  },
  OPEN_FEEDBACK_COMPOSER: {
    name: "open_feedback_composer",
    family: ACTION_FAMILY.APP,
    kind: ACTION_KIND.FEEDBACK,
    description: "Open the feedback composer.",
    request: erase(FEEDBACK_REQUEST),
  },
  RUN_UPDATE_ACTION: {
    name: "run_update_action",
    family: ACTION_FAMILY.APP,
    kind: ACTION_KIND.UPDATE,
    description:
      "Press the Updates row's button for the developer: check for updates, open the latest " +
      "release's page in the browser to download by hand, or restart into an update already " +
      "downloaded. Only the action the button currently offers runs — the app guide's Updates " +
      "line names it.",
    request: erase(UPDATE_REQUEST),
  },
  REMEMBER_FACT: {
    name: "remember_fact",
    family: ACTION_FAMILY.APP,
    kind: ACTION_KIND.REMEMBER,
    description:
      "Silently save a concise stable preference, personal fact, goal, or recurring constraint " +
      "from this developer-opened turn. Skip transient details and uncertain inferences. Never " +
      "save credentials; save sensitive facts only when explicitly asked. Do not mention routine " +
      "memory changes. Skip duplicates, and pass an existing id as replaces when updating a " +
      "contradiction.",
    request: erase(REMEMBER_REQUEST),
  },
  FORGET_FACT: {
    name: "forget_fact",
    family: ACTION_FAMILY.APP,
    kind: ACTION_KIND.FORGET,
    description:
      "Silently forget an outdated or explicitly unwanted memory. Only an id from the remembered " +
      "list can be named. Do not mention routine memory changes.",
    request: erase(FORGET_REQUEST),
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

/** The family a named tool belongs to, or nothing when no such tool exists. */
export function actionToolFamily(name: string): ActionFamily | undefined {
  return ACTS_BY_NAME.get(name)?.family;
}

/** The kind of action a named tool carries, or nothing when no such tool exists. */
export function actionToolKind(name: string): ActionKind | undefined {
  return ACTS_BY_NAME.get(name)?.kind;
}

/**
 * A tool's request as the `@sidecar/wire` facade still-held callers take: the
 * brain's action tool modules and the desktop renderer's own re-parse of a
 * stored call both read a call back through it. `read` runs `readEither`
 * over the same schema {@link definitionOf} showed the model, and `jsonSchema`
 * walks it with the same emitter, so the two never drift.
 */
export function requestSchema<Value, Encoded>(
  request: Schema.Schema<Value, Encoded>,
): WireSchema<Value> {
  const read = readEither(request);
  return s.reader({
    read: (value) => toSchemaRead(read(value)),
    jsonSchema: () => emitJsonSchema(request),
  });
}

/** One function tool as a function-calling request carries it. */
export interface ActionToolDefinition {
  type: "function";
  name: string;
  description: string;
  parameters: JsonSchemaNode;
}

function definitionOf(
  spec: ToolSpec<ActionFamily, ActionKind>,
  remote: boolean,
): ActionToolDefinition {
  const shape = (remote ? spec.remote : undefined) ?? spec;
  return {
    type: "function",
    name: spec.name,
    description: shape.description,
    parameters: emitJsonSchema(shape.request),
  };
}

/** The tool schemas the brain's action catalog is declared from. */
export function actionToolDefinitions(): readonly ActionToolDefinition[] {
  return ACTION_LIST.map((tool) => definitionOf(tool, false));
}

/**
 * The actions the phone carries, as tool schemas for a mobile Realtime session.
 * The session writes are the ones the hosted action endpoints serve — MESSAGE,
 * CONTROL, CREATE_WORKSPACE, ADD_AGENT, RENAME_WORKSPACE, RENAME_SESSION —
 * and the phone validates each against the roster and projects it was shown
 * before an endpoint sees it. OPEN lands on the session's own screen in the
 * app and PANEL on the app's own list, so each is performed on the phone and
 * reaches no endpoint at all.
 *
 * The issue actions are absent because no tracker is connected on the phone; a
 * setting change, the feedback composer, and the Updates row are surfaces the
 * phone does not draw. REMEMBER and FORGET are absent because the phone keeps
 * no memory: Luke's durable facts live on the Mac alone.
 */
const REMOTE_ACTION_KINDS: ReadonlySet<string> = new Set<ActionKind>([
  ACTION_KIND.MESSAGE,
  ACTION_KIND.CONTROL,
  ACTION_KIND.OPEN,
  ACTION_KIND.CREATE_WORKSPACE,
  ACTION_KIND.ADD_AGENT,
  ACTION_KIND.RENAME_WORKSPACE,
  ACTION_KIND.RENAME_SESSION,
  ACTION_KIND.PANEL,
]);

export function remoteRealtimeToolDefinitions(): readonly ActionToolDefinition[] {
  return ACTION_LIST.filter((tool) => REMOTE_ACTION_KINDS.has(tool.kind)).map((tool) =>
    definitionOf(tool, true),
  );
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
