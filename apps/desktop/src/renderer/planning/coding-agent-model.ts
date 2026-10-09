import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentCallFailure,
} from "@sidecar/hosted/coding-agent-view";
import {
  CODING_AGENT_STATUS,
  type CodingAgentMessage,
  type CodingAgentStatus,
  type CodingAgentSummary,
} from "@sidecar/hosted/coding-agent-wire";
import { type CatalogModel, MODEL_PROVIDER } from "@sidecar/hosted/models-wire";
import { isRecord, isWireString, type WireValue } from "@sidecar/wire";
import { TOOL_STATE, type ToolState } from "../ai-elements/tool";

/**
 * coding-agent-model.ts -- what the agent tabs, the Start button, and an agent's transcript draw, decided from what the service answered.
 *
 * Pure decisions over the wire's shapes: how an agent is named on its tab,
 * what its status dot says, whether its transcript is still followed, how
 * a page of its messages joins the ones held, how a stored message's parts
 * are read for drawing, and what a Start that did not start says. Nothing
 * here asks anything.
 */

/** What each status says beside its dot. */
export const AGENT_STATUS_LABEL = {
  [CODING_AGENT_STATUS.STARTING]: "Starting",
  [CODING_AGENT_STATUS.RUNNING]: "Running",
  [CODING_AGENT_STATUS.COMPLETED]: "Completed",
  [CODING_AGENT_STATUS.FAILED]: "Failed",
  [CODING_AGENT_STATUS.CANCELLED]: "Cancelled",
} as const satisfies Record<CodingAgentStatus, string>;

/** The statuses an agent may still write under, which is when its transcript is followed and it can be stopped. */
const FOLLOWED_STATUSES: ReadonlySet<CodingAgentStatus> = new Set([
  CODING_AGENT_STATUS.STARTING,
  CODING_AGENT_STATUS.RUNNING,
]);

/** Whether an agent in this status may still write more. */
export function agentStillWriting(status: CodingAgentStatus): boolean {
  return FOLLOWED_STATUSES.has(status);
}

/**
 * Whether an agent's transcript is read on the held long-poll now: only
 * while its tab is on screen and the agent may still write. A tab hidden,
 * a plan left, and an agent that ended each stop the reads.
 */
export function followsAgent(input: { shown: boolean; status: CodingAgentStatus }): boolean {
  return input.shown && agentStillWriting(input.status);
}

/** What the Start button says while it cannot start: the plan names no repository yet. */
export const START_NEEDS_REPOSITORY = "Choose a repository first.";

/** What a Start that did not start says beside the button. */
export function startFailureNote(failure: CodingAgentCallFailure): string {
  switch (failure) {
    case CODING_AGENT_CALL_FAILURE.NO_REPOSITORY:
      return START_NEEDS_REPOSITORY;
    case CODING_AGENT_CALL_FAILURE.REPOSITORY_NOT_REACHABLE:
      return "Luke can't reach this plan's repository on GitHub.";
    case CODING_AGENT_CALL_FAILURE.GITHUB_SIGN_IN_REQUIRED:
      return "Sign in with GitHub again to start an agent.";
    case CODING_AGENT_CALL_FAILURE.INVALID_CHOICE:
      return "That model isn't offered any more. Choose another.";
    case CODING_AGENT_CALL_FAILURE.NOT_FOUND:
      return "This plan no longer exists.";
    case CODING_AGENT_CALL_FAILURE.UNANSWERED:
      return "The agent could not be started. Try again.";
  }
}

/** The one separator a catalog id has between its provider and the model's own name. */
const CATALOG_ID_SEPARATOR = "/";

/** Words a model's own name is joined by, which its label spaces. */
const MODEL_NAME_SEPARATOR = "-";

/** The one model family whose name is an initialism, drawn in capitals. */
const GPT = "gpt";

/**
 * A model as a tab or a menu names it: the catalog's own name where the
 * catalog has been read, else the id's own name past its provider with its
 * words capitalised, so a tab never shows a bare id.
 */
export function modelLabel(modelId: string, models?: readonly CatalogModel[]): string {
  const listed = models?.find((model) => model.id === modelId);
  if (listed !== undefined) return listed.name;
  const separator = modelId.indexOf(CATALOG_ID_SEPARATOR);
  const name = separator === -1 ? modelId : modelId.slice(separator + 1);
  return name
    .split(MODEL_NAME_SEPARATOR)
    .filter((word) => word.length > 0)
    .map((word) =>
      word === GPT ? word.toUpperCase() : `${word.charAt(0).toUpperCase()}${word.slice(1)}`,
    )
    .join(" ");
}

/** The agent's tab label: its model's name. */
export function agentTabLabel(agent: CodingAgentSummary, models?: readonly CatalogModel[]): string {
  return modelLabel(agent.model, models);
}

/** The first run of digits and points in a model's own name, which is its version: `claude-opus-5.5` is 5.5, `gpt-6-astra` is 6. */
const MODEL_VERSION = /\d+(?:\.\d+)*/u;

/** The version's numbers, most significant first; none for a name that carries no version. */
function modelVersion(modelId: string): number[] {
  const separator = modelId.indexOf(CATALOG_ID_SEPARATOR);
  const name = separator === -1 ? modelId : modelId.slice(separator + 1);
  const found = MODEL_VERSION.exec(name)?.[0];
  return found === undefined ? [] : found.split(".").map(Number);
}

/** Which of two versions is the newer: positive where `a` is, with a missing part counted as 0, so 5.1 is newer than 5. */
function compareVersions(a: readonly number[], b: readonly number[]): number {
  for (let part = 0; part < Math.max(a.length, b.length); part += 1) {
    const difference = (a[part] ?? 0) - (b[part] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/** The providers in the order the menu groups them. */
const PROVIDER_ORDER: readonly string[] = Object.values(MODEL_PROVIDER);

/**
 * The models as the menus list them: grouped by provider, Anthropic's first,
 * and within each the newest version first, so a catalog that lists forty
 * models leads with the ones worth starting on. The catalog carries no
 * release date, so the version in the id stands for one; models of one
 * version keep the catalog's own order between them.
 */
export function orderedModels(models: readonly CatalogModel[]): readonly CatalogModel[] {
  return models
    .map((model, index) => ({ model, index, version: modelVersion(model.id) }))
    .sort(
      (a, b) =>
        PROVIDER_ORDER.indexOf(a.model.provider) - PROVIDER_ORDER.indexOf(b.model.provider) ||
        compareVersions(b.version, a.version) ||
        a.index - b.index,
    )
    .map((each) => each.model);
}

/** The efforts a model lists, or nothing for a model the catalog does not offer now. */
export function effortsOf(models: readonly CatalogModel[], modelId: string): readonly string[] {
  return models.find((model) => model.id === modelId)?.efforts ?? [];
}

/**
 * A page of an agent's messages joined to the ones held: a message heard
 * again replaces the one held under its id, in place, and a new one joins
 * at the end, so a journal that grows in place is redrawn where it stands.
 */
export function applyMessagesPage(
  held: readonly CodingAgentMessage[],
  page: readonly CodingAgentMessage[],
): readonly CodingAgentMessage[] {
  if (page.length === 0) return held;
  const heard = new Map(page.map((message) => [message.id, message]));
  const joined = held.map((message) => heard.get(message.id) ?? message);
  const known = new Set(held.map((message) => message.id));
  const appended = page.filter((message) => !known.has(message.id));
  return [...joined, ...appended];
}

/** The agents with one agent's status read from its own transcript page, where the page knows better than the list. */
export function withAgentStatus(
  agents: readonly CodingAgentSummary[],
  agentId: string,
  status: CodingAgentStatus,
): readonly CodingAgentSummary[] {
  return agents.map((agent) =>
    agent.id === agentId && agent.status !== status ? { ...agent, status } : agent,
  );
}

/** The kinds of part a stored message holds that the tab draws apart. */
export const AGENT_PART = {
  TEXT: "text",
  REASONING: "reasoning",
  TOOL: "tool",
  STEP_START: "step-start",
  /** A part of a kind this build does not draw, which is skipped rather than refused. */
  OTHER: "other",
} as const;

/** How the SDK spells a tool part's type: the tool's name behind this prefix. */
const TOOL_PART_TYPE_PREFIX = "tool-";

const TOOL_STATES: ReadonlySet<string> = new Set(Object.values(TOOL_STATE));

/** One part of a stored message as the tab draws it. */
export type AgentPart =
  | { readonly kind: typeof AGENT_PART.TEXT; readonly text: string }
  | { readonly kind: typeof AGENT_PART.REASONING; readonly text: string }
  | {
      readonly kind: typeof AGENT_PART.TOOL;
      readonly tool: string;
      readonly callId: string;
      readonly state: ToolState;
      readonly input: WireValue | undefined;
      readonly output: WireValue | undefined;
      /** The error's own text, on a call that ended in one. */
      readonly errorText: string | undefined;
    }
  | { readonly kind: typeof AGENT_PART.STEP_START }
  | { readonly kind: typeof AGENT_PART.OTHER };

function toolState(value: WireValue | undefined): ToolState {
  // SAFETY: membership in the set built from TOOL_STATE's values is what the union names.
  return isWireString(value) && TOOL_STATES.has(value)
    ? (value as ToolState)
    : TOOL_STATE.INPUT_AVAILABLE;
}

/**
 * A stored part read for drawing. The row carries the SDK's own vocabulary
 * rather than one this wire declares, so the read is forgiving: a text or
 * reasoning part without its words, and any kind this build does not know,
 * draws nothing rather than refusing the message.
 */
function agentPart(part: WireValue): AgentPart {
  if (!isRecord(part) || !isWireString(part.type)) return { kind: AGENT_PART.OTHER };
  if (part.type === AGENT_PART.TEXT || part.type === AGENT_PART.REASONING) {
    return isWireString(part.text)
      ? { kind: part.type, text: part.text }
      : { kind: AGENT_PART.OTHER };
  }
  if (part.type === AGENT_PART.STEP_START) return { kind: AGENT_PART.STEP_START };
  if (part.type.startsWith(TOOL_PART_TYPE_PREFIX)) {
    return {
      kind: AGENT_PART.TOOL,
      tool: part.type.slice(TOOL_PART_TYPE_PREFIX.length),
      callId: isWireString(part.toolCallId) ? part.toolCallId : "",
      state: toolState(part.state),
      input: part.input,
      output: part.output,
      errorText: isWireString(part.errorText) ? part.errorText : undefined,
    };
  }
  return { kind: AGENT_PART.OTHER };
}

/** The parts of a message as the tab draws them, in the row's order. */
export function agentParts(message: CodingAgentMessage): readonly AgentPart[] {
  return message.parts.map(agentPart);
}

/** Where a pull request lives: GitHub's own pages, which are the one address the tab opens in the browser. */
const GITHUB_ADDRESS = /^https:\/\/github\.com\//u;

/** Whether a link in the transcript is one the tab opens: a page on GitHub, such as the pull request the agent opened. */
export function opensOnGitHub(href: string): boolean {
  return GITHUB_ADDRESS.test(href);
}
