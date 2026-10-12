import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentCallFailure,
} from "@sidecar/hosted/coding-agent-view";
import {
  CODING_AGENT_DELEGATE_TOOL,
  CODING_AGENT_FAILURE,
  CODING_AGENT_STATUS,
  CODING_AGENT_TODO_STATUS,
  CONTEXT_WINDOW,
  type CodingAgentAttachment,
  type CodingAgentFailure,
  type CodingAgentMessage,
  type CodingAgentPullRequest,
  type CodingAgentPullRequestAnswer,
  type CodingAgentStatus,
  type CodingAgentSummary,
  type CodingAgentTodos,
  type CodingAgentUsage,
  type ContextWindow,
  PULL_REQUEST_STATE,
  type PullRequestState,
} from "@sidecar/hosted/coding-agent-wire";
import { CATALOG_ID_SEPARATOR, modelLabel } from "@sidecar/hosted/model-label";
import {
  type CatalogModel,
  type ContextWindows,
  MODEL_PROVIDER,
  type ModelChoice,
  type ModelProvider,
} from "@sidecar/hosted/models-wire";
import { isRecord, isWireString, MESSAGE_ROLE, type WireValue } from "@sidecar/wire";
import { TOOL_STATE, type ToolState } from "../ai-elements/tool";
import { GLYPH_STATE, GLYPH_STATE_WORDS, type GlyphState } from "../state-glyph";
import { AGENT_TOOL, todosView } from "./tool-call-model";
import { ROW_PART, type RowReading, type TurnRow, turnRows } from "./turn-rows";

/**
 * coding-agent-model.ts -- what the agent tabs, the Start button, and an agent's transcript draw, decided from what the service answered.
 *
 * Pure decisions over the wire's shapes: how an agent is named on its tab,
 * what its tab's glyph says of where it stands, what line ends a transcript whose turn failed
 * or was stopped, whether its transcript is still followed, how
 * a page of its messages joins the ones held, how a stored message's parts
 * are read for drawing, which of its rows wait above the composer rather
 * than in the transcript, what its working line says it is doing, when a
 * line the developer sent has been read back, what a Start or a message
 * that did not land says, and what its
 * pull request chip, its branch chip, and the pull request's row say and
 * open, and how what an agent or a turn cost is told.
 * Nothing here asks anything.
 */

/** The words that separate the parts of a line. */
const LINE_SEPARATOR = " · ";

/** How many tokens are a thousand and a million, as the compact count spells them. */
const THOUSAND = 1_000;
const MILLION = 1_000_000;

/** The least dollars drawn as an amount; under it the cost reads as less than a cent. */
const LEAST_CENTS = 0.005;

/** A count of tokens compact enough for a line: 812, 12.3k, 1.2M. */
export function compactCount(count: number): string {
  if (count >= MILLION) return `${(count / MILLION).toFixed(1)}M`;
  if (count >= THOUSAND) return `${(count / THOUSAND).toFixed(1)}k`;
  return String(count);
}

/** Dollars as a line draws them: to the cent, and under a cent "<$0.01". */
function dollars(costUsd: number): string {
  return costUsd > 0 && costUsd < LEAST_CENTS ? "<$0.01" : `$${costUsd.toFixed(2)}`;
}

/** The dollars some turns cost, where the service put a price on every step; nothing where it could not. */
function costLabel(usage: CodingAgentUsage | undefined): string | undefined {
  return usage?.costUsd === undefined ? undefined : dollars(usage.costUsd);
}

/** What the agent has cost, for the model menu's foot: "This agent: 1.2M tokens · $0.42", the dollars left off where unknown; nothing before a turn settled. */
export function agentUsageLine(usage: CodingAgentUsage | undefined): string | undefined {
  if (usage === undefined) return undefined;
  const tokens = `${compactCount(usage.inputTokens + usage.outputTokens)} tokens`;
  const cost = costLabel(usage);
  return `This agent: ${cost === undefined ? tokens : `${tokens}${LINE_SEPARATOR}${cost}`}`;
}

/** The line with what the turn cost after it, where known. */
function withCost(line: string, usage: CodingAgentUsage | undefined): string {
  const cost = costLabel(usage);
  return cost === undefined ? line : `${line}${LINE_SEPARATOR}${cost}`;
}

/** What a failed turn's end line says after "Failed", by the service's one word for why; nothing for a reason it has no words for. */
const AGENT_FAILURE_WORDS = {
  [CODING_AGENT_FAILURE.MODEL]: "the model call failed",
  [CODING_AGENT_FAILURE.SANDBOX]: "the sandbox or checkout failed",
  [CODING_AGENT_FAILURE.GITHUB]: "GitHub refused or could not be reached",
  [CODING_AGENT_FAILURE.ABANDONED]: "the turn ran past its bound and was ended",
  [CODING_AGENT_FAILURE.PROVIDER_KEY]:
    "your API key was refused or can't be read; check Settings › API keys",
  [CODING_AGENT_FAILURE.NOT_STARTED]: "the agent never started; start a new one",
  [CODING_AGENT_FAILURE.OTHER]: undefined,
} as const satisfies Record<CodingAgentFailure, string | undefined>;

/** The quiet line a transcript ends on once its turn failed or was stopped, with what the turn cost where known; nothing for an agent still writing or one that completed. */
export function endLine(
  status: CodingAgentStatus,
  failure: CodingAgentFailure | undefined,
  turnUsage?: CodingAgentUsage,
): string | undefined {
  switch (status) {
    case CODING_AGENT_STATUS.CANCELLED:
      return withCost("Stopped", turnUsage);
    case CODING_AGENT_STATUS.FAILED: {
      const words = failure === undefined ? undefined : AGENT_FAILURE_WORDS[failure];
      return withCost(words === undefined ? "Failed" : `Failed: ${words}`, turnUsage);
    }
    case CODING_AGENT_STATUS.STARTING:
    case CODING_AGENT_STATUS.RUNNING:
    case CODING_AGENT_STATUS.COMPLETED:
      return undefined;
  }
}

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
 * Where an agent stands as its tab's glyph wears it: working while it may
 * still write, failed once its turn failed, and at rest once it finished
 * or the developer stopped it, since a stop is the developer's own doing.
 */
export function agentGlyphState(status: CodingAgentStatus): GlyphState {
  if (agentStillWriting(status)) return GLYPH_STATE.WORKING;
  return status === CODING_AGENT_STATUS.FAILED ? GLYPH_STATE.FAILED : GLYPH_STATE.REST;
}

/** What an agent's tab says of where it stands beyond its glyph: a stop, which its glyph at rest does not tell from a finish. */
export function agentStateWords(status: CodingAgentStatus): string | undefined {
  return status === CODING_AGENT_STATUS.CANCELLED
    ? "Stopped"
    : GLYPH_STATE_WORDS[agentGlyphState(status)];
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

/** Why Start, and a draft's first message, cannot run on an archived plan. */
export const START_ARCHIVED = "Unarchive the plan to start a coding agent.";

/** What the refusals a Start and a message meet alike say, worded once. */
const SHARED_FAILURE_NOTE = {
  [CODING_AGENT_CALL_FAILURE.REPOSITORY_NOT_REACHABLE]:
    "Luke can't reach this plan's repository on GitHub.",
  [CODING_AGENT_CALL_FAILURE.MESSAGE_TOO_LONG]: "That message is too long.",
  [CODING_AGENT_CALL_FAILURE.AGENT_NOT_READY]:
    "The agent is still starting. Try again in a moment.",
  [CODING_AGENT_CALL_FAILURE.AGENT_RETIRED]:
    "This agent has ended for good. Start a new one to go on from here.",
  [CODING_AGENT_CALL_FAILURE.PLAN_ARCHIVED]: "This plan is archived. Unarchive it first.",
} as const;

/** Said beside Start when the model or effort the menu chose could not be kept as the default. */
export const MODEL_CHANGE_FAILED = "The model could not be changed. Try again.";

/** What a change of an agent's model that did not take says under its box. */
export function chooseFailureNote(failure: CodingAgentCallFailure): string {
  switch (failure) {
    case CODING_AGENT_CALL_FAILURE.NOT_FOUND:
      return "This agent no longer exists.";
    case CODING_AGENT_CALL_FAILURE.INVALID_CHOICE:
      return "That model isn't offered any more. Choose another.";
    case CODING_AGENT_CALL_FAILURE.UNANSWERED:
    case CODING_AGENT_CALL_FAILURE.NO_REPOSITORY:
    case CODING_AGENT_CALL_FAILURE.GITHUB_SIGN_IN_REQUIRED:
    case CODING_AGENT_CALL_FAILURE.REPOSITORY_NOT_REACHABLE:
    case CODING_AGENT_CALL_FAILURE.MESSAGE_TOO_LONG:
    case CODING_AGENT_CALL_FAILURE.AGENT_NOT_READY:
    case CODING_AGENT_CALL_FAILURE.AGENT_RETIRED:
    case CODING_AGENT_CALL_FAILURE.PLAN_ARCHIVED:
      return MODEL_CHANGE_FAILED;
  }
}

/** What the toast says when a Start the developer left the plan behind did not start; the plan's own note says why. */
export const START_FAILED_AWAY = "The coding agent could not be started.";

/** What the toast says when the service did not stop an agent. */
export const STOP_FAILED = "The agent could not be stopped. Try again.";

/** What the toast says when the service did not rename an agent, whose old name is drawn again. */
export const RENAME_FAILED = "The agent could not be renamed. Try again.";

/** What a Start that did not start says beside the button. */
export function startFailureNote(failure: CodingAgentCallFailure): string {
  switch (failure) {
    case CODING_AGENT_CALL_FAILURE.NO_REPOSITORY:
      return START_NEEDS_REPOSITORY;
    case CODING_AGENT_CALL_FAILURE.GITHUB_SIGN_IN_REQUIRED:
      return "Sign in with GitHub again to start an agent.";
    case CODING_AGENT_CALL_FAILURE.INVALID_CHOICE:
      return "That model isn't offered any more. Choose another.";
    case CODING_AGENT_CALL_FAILURE.NOT_FOUND:
      return "This plan no longer exists.";
    case CODING_AGENT_CALL_FAILURE.UNANSWERED:
      return "The agent could not be started. Try again.";
    case CODING_AGENT_CALL_FAILURE.REPOSITORY_NOT_REACHABLE:
    case CODING_AGENT_CALL_FAILURE.MESSAGE_TOO_LONG:
    case CODING_AGENT_CALL_FAILURE.AGENT_NOT_READY:
    case CODING_AGENT_CALL_FAILURE.AGENT_RETIRED:
    case CODING_AGENT_CALL_FAILURE.PLAN_ARCHIVED:
      return SHARED_FAILURE_NOTE[failure];
  }
}

/** What a message that did not reach the agent says under the composer, beside Retry. */
export function messageFailureNote(failure: CodingAgentCallFailure): string {
  switch (failure) {
    case CODING_AGENT_CALL_FAILURE.NOT_FOUND:
      return "This agent no longer exists.";
    case CODING_AGENT_CALL_FAILURE.GITHUB_SIGN_IN_REQUIRED:
      return "Sign in with GitHub again to message the agent.";
    // A message names no repository and no model, so neither refusal is its own.
    case CODING_AGENT_CALL_FAILURE.NO_REPOSITORY:
    case CODING_AGENT_CALL_FAILURE.INVALID_CHOICE:
      return "The message could not be sent. Try again.";
    // No answer is not a refusal: the words may have reached the agent, and Retry carries the same key, so they reach it once.
    case CODING_AGENT_CALL_FAILURE.UNANSWERED:
      return "Luke didn't hear back. Retry sends it again, once.";
    case CODING_AGENT_CALL_FAILURE.REPOSITORY_NOT_REACHABLE:
    case CODING_AGENT_CALL_FAILURE.MESSAGE_TOO_LONG:
    case CODING_AGENT_CALL_FAILURE.AGENT_NOT_READY:
    case CODING_AGENT_CALL_FAILURE.AGENT_RETIRED:
    case CODING_AGENT_CALL_FAILURE.PLAN_ARCHIVED:
      return SHARED_FAILURE_NOTE[failure];
  }
}

/** Whether a refusal is for good, so the composer closes on it rather than offering Retry: the agent's session has ended. */
export function closesComposer(failure: CodingAgentCallFailure): boolean {
  return failure === CODING_AGENT_CALL_FAILURE.AGENT_RETIRED;
}

/**
 * A model as a tab or a menu names it, shared with the main process's
 * notifications so one model is never named two ways (`@sidecar/hosted/model-label`).
 */
export { modelLabel };

/** The agent's tab label: its title, or its model's name until it has one. */
export function agentTabLabel(agent: CodingAgentSummary, models?: readonly CatalogModel[]): string {
  return agent.title ?? modelLabel(agent.model, models);
}

/**
 * The provider whose harness runs a model, read from its catalog id, whose
 * prefix is the provider's word (`models-wire.ts`), so a tab wears its
 * harness's mark before the catalog itself is read; none for a provider
 * Luke runs no agent on.
 */
export function providerOf(modelId: string): ModelProvider | undefined {
  const prefix = modelId.slice(0, Math.max(0, modelId.indexOf(CATALOG_ID_SEPARATOR)));
  return Object.values(MODEL_PROVIDER).find((provider) => provider === prefix);
}

/** The first run of digits and points in a model's own name, which is its version: `claude-opus-5.5` is 5.5, `gpt-6-astra` is 6. */
const MODEL_VERSION = /\d+(?:\.\d+)*/u;

/** A word of a model's own name that is its version whole: `5.5` in `claude-opus-5.5`. */
const VERSION_WORD = /^\d+(?:\.\d+)*$/u;

/** What separates the words of a model's own name. */
const NAME_WORD_SEPARATOR = "-";

/** A model's own name, past its provider: `claude-opus-5.5` of `anthropic/claude-opus-5.5`. */
function ownName(modelId: string): string {
  const separator = modelId.indexOf(CATALOG_ID_SEPARATOR);
  return separator === -1 ? modelId : modelId.slice(separator + 1);
}

/** The version's numbers, most significant first; none for a name that carries no version. */
function modelVersion(modelId: string): number[] {
  const found = MODEL_VERSION.exec(ownName(modelId))?.[0];
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
 * The model families the menus lead with, in the order they list them,
 * Anthropic's and then OpenAI's: the newest of each is listed before
 * anything is searched, and every other version only once something is. A
 * new version needs nothing here; a new family is one word.
 */
const LEAD_FAMILIES: readonly string[] = [
  "opus",
  "fable",
  "sonnet",
  "haiku",
  "astra",
  "sol",
  "luna",
  "terra",
];

/** The suffix AI Gateway gives a model's fast version's id: `anthropic/claude-opus-5.5-fast` beside `anthropic/claude-opus-5.5`. */
const FAST_ID_SUFFIX = "-fast";

/**
 * Where a model's family stands in `LEAD_FAMILIES`: the last word of its
 * own name, its version and any fast suffix aside, so `claude-opus-5.5` is
 * Opus and `gpt-6-astra` Astra, while `gpt-6-astra-mini` is no lead family's
 * and stands after them all.
 */
function familyRank(modelId: string): number {
  const name = ownName(baseIdOf(modelId) ?? modelId);
  const words = name.split(NAME_WORD_SEPARATOR).filter((word) => !VERSION_WORD.test(word));
  const rank = LEAD_FAMILIES.indexOf(words.at(-1) ?? "");
  return rank === -1 ? LEAD_FAMILIES.length : rank;
}

/**
 * The models as the menus list them: grouped by provider, Anthropic's first,
 * within each by family in `LEAD_FAMILIES`' order and the rest after, and
 * within a family the newest version first, so a catalog that lists forty
 * models leads with the ones worth starting on. The catalog carries no
 * release date, so the version in the id stands for one; models of one
 * version keep the catalog's own order between them.
 */
export function orderedModels(models: readonly CatalogModel[]): readonly CatalogModel[] {
  return models
    .map((model, index) => ({
      model,
      index,
      family: familyRank(model.id),
      version: modelVersion(model.id),
    }))
    .sort(
      (a, b) =>
        PROVIDER_ORDER.indexOf(a.model.provider) - PROVIDER_ORDER.indexOf(b.model.provider) ||
        a.family - b.family ||
        compareVersions(b.version, a.version) ||
        a.index - b.index,
    )
    .map((each) => each.model);
}

/** The word a choice label and the Fast row say for the fast version. */
export const FAST_WORD = "Fast";

/** What separates the words of a choice: "Opus 5.5 High Fast", the model's name and then its detail. */
const CHOICE_WORD_SEPARATOR = " ";

/** A model as the menus offer it: the base model, and its fast version where the catalog lists one beside it. */
export interface OfferedModel {
  readonly model: CatalogModel;
  readonly fast: CatalogModel | undefined;
}

/** The id a fast version's id is the fast version of, or nothing for an id without the suffix. */
function baseIdOf(id: string): string | undefined {
  return id.endsWith(FAST_ID_SUFFIX) ? id.slice(0, -FAST_ID_SUFFIX.length) : undefined;
}

/**
 * The catalog folded to its base models, each with its fast version, in the
 * menus' order. The signal is the id: a model whose id is another offered
 * model's with the fast suffix is that model's fast version, and is not
 * listed on its own. Neither the name's "(Fast)" nor the catalog's `fast`
 * tag would do: the tag sits on the base and the fast version alike, the
 * wire carries no tags in any case, and a name is display text. A suffixed
 * id with no base beside it is a model of its own.
 */
export function offeredModels(models: readonly CatalogModel[]): readonly OfferedModel[] {
  const ids = new Set(models.map((model) => model.id));
  const fastOf = new Map<string, CatalogModel>();
  for (const model of models) {
    const base = baseIdOf(model.id);
    if (base !== undefined && ids.has(base)) fastOf.set(base, model);
  }
  return orderedModels(models)
    .filter((model) => !isFastVersion(model.id, ids))
    .map((model) => ({ model, fast: fastOf.get(model.id) }));
}

/**
 * The base models a menu lists before anything is searched: the newest of
 * each lead family the catalog offers, and the one chosen, which stays on
 * screen however old; every model where the catalog offers no lead family,
 * so the list is never empty for want of a search.
 */
export function unsearchedModels(
  models: readonly CatalogModel[],
  chosen: string | undefined,
): ReadonlySet<string> {
  const offered = offeredModels(models).map((each) => each.model.id);
  const leads = new Map<number, string>();
  for (const id of offered) {
    const family = familyRank(id);
    if (family < LEAD_FAMILIES.length && !leads.has(family)) leads.set(family, id);
  }
  if (leads.size === 0) return new Set(offered);
  return new Set([...leads.values(), ...(chosen === undefined ? [] : [chosen])]);
}

/** Whether the id is the fast version of a model the catalog offers. */
function isFastVersion(id: string, ids: ReadonlySet<string>): boolean {
  const base = baseIdOf(id);
  return base !== undefined && ids.has(base);
}

/** A stored id as the menus draw it: the base model's id, and whether it named the fast version. */
export interface ModelChoiceRead {
  readonly base: string;
  readonly fast: boolean;
}

export function readModelChoice(models: readonly CatalogModel[], modelId: string): ModelChoiceRead {
  const offered = offeredModels(models).find(
    (each) => each.model.id === modelId || each.fast?.id === modelId,
  );
  if (offered === undefined) return { base: modelId, fast: false };
  return { base: offered.model.id, fast: offered.fast?.id === modelId };
}

/** The catalog id a base and a Fast switch name: the fast version's where it is on and the model has one, else the base's. */
export function choiceModelId(offered: OfferedModel, fast: boolean): string {
  return fast && offered.fast !== undefined ? offered.fast.id : offered.model.id;
}

/**
 * What a choice says after its model's name: the effort, Fast where the
 * fast version is on, and the standard window's size where it runs on that,
 * so the model's whole window, which every choice runs on unless it says,
 * says nothing.
 */
function choiceDetail(effort: string, fast: boolean, standardTokens?: number): string {
  const words = [effortLabel(effort)];
  if (fast) words.push(FAST_WORD);
  if (standardTokens !== undefined) words.push(windowLabel(standardTokens));
  return words.join(CHOICE_WORD_SEPARATOR);
}

/** The word the menu's pinned row and the settings row say for the context window. */
export const CONTEXT_WORD = "Context";

/** The tenth of a million a window's size in millions is cut to. */
const TENTH_OF_A_MILLION = MILLION / 10;

/** A window's size as a choice says it, cut to the thousand or the tenth of a million below: 272K, 1M for 1,050,000. */
export function windowLabel(tokens: number): string {
  if (tokens >= MILLION) return `${Math.floor(tokens / TENTH_OF_A_MILLION) / 10}M`;
  return `${Math.floor(tokens / THOUSAND)}K`;
}

/** The two windows the model offers, or nothing for a model with one, or one the catalog does not offer now. */
export function contextWindowsOf(
  models: readonly CatalogModel[],
  modelId: string,
): ContextWindows | undefined {
  return models.find((model) => model.id === modelId)?.contextWindows;
}

/** The window a choice runs on as the catalog stands: the standard one only where it was chosen and the model offers two, else the model's whole window. */
export function windowOf(models: readonly CatalogModel[], choice: ModelChoice): ContextWindow {
  return choice.contextWindow === CONTEXT_WINDOW.STANDARD &&
    contextWindowsOf(models, choice.model) !== undefined
    ? CONTEXT_WINDOW.STANDARD
    : CONTEXT_WINDOW.LONG;
}

/**
 * A model and effort on the window given, as a request names them: the
 * standard window only where the model offers two, so a change to a model
 * with one window drops it, and nothing for the model's whole window, the
 * default, so a service that predates the window is sent no key it would
 * refuse.
 */
export function choiceOn(
  models: readonly CatalogModel[],
  pair: { readonly model: string; readonly effort: string },
  window: ContextWindow | undefined,
): ModelChoice {
  const choice = { model: pair.model, effort: pair.effort };
  return windowOf(models, { ...choice, contextWindow: window ?? CONTEXT_WINDOW.LONG }) ===
    CONTEXT_WINDOW.STANDARD
    ? { ...choice, contextWindow: CONTEXT_WINDOW.STANDARD }
    : choice;
}

/** A choice as a request carries it: the model, the effort, and the window only where it is the standard one. */
export function choiceRequest(choice: ModelChoice): ModelChoice {
  return choice.contextWindow === CONTEXT_WINDOW.STANDARD
    ? { model: choice.model, effort: choice.effort, contextWindow: CONTEXT_WINDOW.STANDARD }
    : { model: choice.model, effort: choice.effort };
}

/** A price multiple as a note says it: 2×, 1.5×, to the hundredth. */
function factorLabel(factor: number): string {
  return `${Number(factor.toFixed(2))}×`;
}

/**
 * What the long window costs, as the catalog prices it, said of the long
 * window by name since only a prompt on it can grow past the standard one:
 * the multiple of the standard price a prompt past the standard window is
 * billed at, input and output each where the catalog says, else that it
 * costs more.
 */
export function longWindowNote(windows: ContextWindows): string {
  const past = `On ${windowLabel(windows.longTokens)}, prompts over ${windowLabel(windows.standardTokens)} tokens cost`;
  const parts: string[] = [];
  if (windows.longInputPriceFactor !== undefined)
    parts.push(`${factorLabel(windows.longInputPriceFactor)} for input`);
  if (windows.longOutputPriceFactor !== undefined)
    parts.push(`${factorLabel(windows.longOutputPriceFactor)} for output`);
  return parts.length === 0 ? `${past} more.` : `${past} ${parts.join(" and ")}.`;
}

/** A choice as the words it is drawn in: the base model's name, and the detail drawn dimmed after it. */
export interface ChoiceWords {
  readonly model: string;
  readonly detail: string;
}

export function choiceWords(choice: ModelChoice, models: readonly CatalogModel[]): ChoiceWords {
  const read = readModelChoice(models, choice.model);
  const standard =
    windowOf(models, choice) === CONTEXT_WINDOW.STANDARD
      ? contextWindowsOf(models, choice.model)?.standardTokens
      : undefined;
  return {
    model: modelLabel(read.base, models),
    detail: choiceDetail(choice.effort, read.fast, standard),
  };
}

/** A choice as one line, for a hint that holds no markup: "Opus 5.5 High Fast", "GPT-5.5 High 272K". */
export function choiceLabel(choice: ModelChoice, models: readonly CatalogModel[]): string {
  const words = choiceWords(choice, models);
  return `${words.model}${CHOICE_WORD_SEPARATOR}${words.detail}`;
}

/** The efforts a model lists, or nothing for a model the catalog does not offer now. */
export function effortsOf(models: readonly CatalogModel[], modelId: string): readonly string[] {
  return models.find((model) => model.id === modelId)?.efforts ?? [];
}

/** The standard effort scale, lowest first, which a fallback across models walks. */
const EFFORT_SCALE: readonly string[] = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

/** Where an effort stands on the scale; nothing for a name the scale does not know. */
function effortRank(effort: string): number | undefined {
  const rank = EFFORT_SCALE.indexOf(effort);
  return rank === -1 ? undefined : rank;
}

/**
 * The effort a model keeps across a change of model or of its fast version:
 * the one chosen where the model lists it; else the nearest the model lists
 * at or below it on the scale, so Extra high lands on High rather than on
 * Low; else, with nothing below, the lowest it lists above; else the model's
 * first, for a name the scale does not know.
 */
export function effortFor(
  efforts: readonly string[],
  chosen: string | undefined,
): string | undefined {
  if (chosen !== undefined && efforts.includes(chosen)) return chosen;
  const wanted = chosen === undefined ? undefined : effortRank(chosen);
  if (wanted === undefined) return efforts[0];
  const ranked = efforts
    .map((effort) => ({ effort, rank: effortRank(effort) }))
    .filter((each): each is { effort: string; rank: number } => each.rank !== undefined)
    .sort((a, b) => a.rank - b.rank);
  const below = ranked.filter((each) => each.rank < wanted).at(-1);
  return below?.effort ?? ranked[0]?.effort ?? efforts[0];
}

/** The catalog's effort names a sentence-case label does not spell by capitalising. */
const EFFORT_LABEL: ReadonlyMap<string, string> = new Map([["xhigh", "Extra high"]]);

/** The catalog's effort names are lowercase words; a menu and a segment read them in sentence case. */
export function effortLabel(effort: string): string {
  return EFFORT_LABEL.get(effort) ?? `${effort.charAt(0).toUpperCase()}${effort.slice(1)}`;
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

/** The agents with one agent as the service just answered it, in its place. */
export function withAgent(
  agents: readonly CodingAgentSummary[],
  answered: CodingAgentSummary,
): readonly CodingAgentSummary[] {
  return agents.map((agent) => (agent.id === answered.id ? answered : agent));
}

/** Where an agent stands as a page or an answer read it: its status, and when the run under way began where the service said. */
export type AgentRun = Pick<CodingAgentSummary, "status" | "runStartedAt">;

/**
 * The agents with one agent's run read from its own transcript page or an
 * answer about it, where that knows better than the list: its status, and
 * the start a working line counts from, which moves with each turn and is
 * none while a message awaits one.
 */
export function withAgentRun(
  agents: readonly CodingAgentSummary[],
  agentId: string,
  run: AgentRun,
): readonly CodingAgentSummary[] {
  return agents.map((agent) => {
    if (agent.id !== agentId) return agent;
    if (agent.status === run.status && agent.runStartedAt === run.runStartedAt) return agent;
    const { runStartedAt: _was, ...held } = agent;
    return run.runStartedAt === undefined
      ? { ...held, status: run.status }
      : { ...held, status: run.status, runStartedAt: run.runStartedAt };
  });
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

/** How many of the agent's plan edits have answered, which is when the plan the window holds is behind the service's. */
export function settledPlanEdits(messages: readonly CodingAgentMessage[]): number {
  return messages
    .flatMap(agentParts)
    .filter(
      (part) =>
        part.kind === AGENT_PART.TOOL &&
        part.tool === AGENT_TOOL.EDIT_PLAN &&
        part.state === TOOL_STATE.OUTPUT_AVAILABLE,
    ).length;
}

/** Whether a tool part is a delegation to a worker, which the tab draws as a subagent's row rather than a call's. */
export function isDelegation(
  part: AgentPart,
): part is Extract<AgentPart, { kind: typeof AGENT_PART.TOOL }> {
  return part.kind === AGENT_PART.TOOL && part.tool === CODING_AGENT_DELEGATE_TOOL;
}

/** Whether a tool part is a write of the agent's to-do list, which the tab draws as the list on a row of its own. */
function isTodos(part: AgentPart): part is Extract<AgentPart, { kind: typeof AGENT_PART.TOOL }> {
  return part.kind === AGENT_PART.TOOL && part.tool === AGENT_TOOL.WRITE_TODOS;
}

/** The agent's newest to-do list, and the call that wrote it. */
export interface StandingTodos {
  readonly callId: string;
  readonly todos: CodingAgentTodos["todos"];
}

/**
 * The agent's newest to-do list, which its tab keeps out of a finished
 * turn's fold and draws open, or docks above the composer while it is
 * worked (`dockedTodos`); nothing before the first. Note that a write whose
 * input does not yet read as a list is passed over, because while it
 * streams the list before it is still the one standing.
 */
export function newestTodos(messages: readonly CodingAgentMessage[]): StandingTodos | undefined {
  const writes = messages.flatMap(agentParts).flatMap((part) => {
    const todos = isTodos(part) ? todosView(part.input) : undefined;
    return todos === undefined || part.kind !== AGENT_PART.TOOL
      ? []
      : [{ callId: part.callId, todos }];
  });
  return writes.at(-1);
}

/**
 * The list docked above the composer: the newest, while the agent may
 * still write and an item of it is not done, as Claude Code keeps its list
 * over the prompt; nothing otherwise, when the transcript's own row is
 * where it is read.
 */
export function dockedTodos(
  standing: StandingTodos | undefined,
  working: boolean,
): StandingTodos | undefined {
  if (!working || standing === undefined) return undefined;
  const open = standing.todos.some((todo) => todo.status !== CODING_AGENT_TODO_STATUS.DONE);
  return open ? standing : undefined;
}

/** How the fold reads a part: its words, its reasoning as a note, a delegation as a subagent and a to-do list each on a row of its own, and every other call grouped with the calls beside it. */
const AGENT_READING: RowReading<AgentPart> = {
  key: (part, index) => (part.kind === AGENT_PART.TOOL ? part.callId : String(index)),
  part: (part) => {
    if (part.kind === AGENT_PART.TEXT) return ROW_PART.WORDS;
    if (part.kind !== AGENT_PART.TOOL) return ROW_PART.NOTE;
    if (isDelegation(part)) return ROW_PART.SUBAGENT;
    return isTodos(part) ? ROW_PART.LONE_CALL : ROW_PART.CALL;
  },
  running: (part) =>
    part.kind === AGENT_PART.TOOL &&
    (part.state === TOOL_STATE.INPUT_STREAMING || part.state === TOOL_STATE.INPUT_AVAILABLE),
};

/** The parts of a message a row is drawn from: every part but a step boundary and a kind this build does not draw. */
function drawnParts(message: CodingAgentMessage): readonly AgentPart[] {
  return agentParts(message).filter(
    (part) => part.kind !== AGENT_PART.STEP_START && part.kind !== AGENT_PART.OTHER,
  );
}

/**
 * One of the agent's turns as the rows every transcript draws, folded as
 * the Work tab folds Luke's (`turn-rows.ts`). A step boundary and a part
 * this build does not draw are left out, because the parts keep one rhythm
 * across them. The turn moves while the agent may still write to it, which
 * is its last message; any other has ended. A worker's session is read for
 * its detail, so its calls stand each on a line of its own and its lead
 * never folds, as the Work tab's worker's do. The agent's newest to-do
 * list, named by the call that wrote it (`newestTodos`), stays out of
 * a finished turn's fold, so the list standing is never folded away.
 */
export function agentRows(
  message: CodingAgentMessage,
  moving: boolean,
  grouped = true,
  newestTodos: string | undefined = undefined,
): readonly TurnRow<AgentPart>[] {
  const parts = drawnParts(message);
  const reading: RowReading<AgentPart> = {
    ...AGENT_READING,
    kept: (part) => part.kind === AGENT_PART.TOOL && part.callId === newestTodos,
  };
  return turnRows(parts, reading, {
    key: message.id,
    moving,
    done: grouped && !moving,
    grouped,
  });
}

/** What an agent is doing while it may still write, as its transcript's working line says it. */
export const WORKING_PHASE = {
  /** Its session has not opened the turn that will answer the newest line. */
  STARTING: "starting",
  /** The turn is open and its model has drawn nothing yet. */
  THINKING: "thinking",
  /** The turn has drawn something: a call, a thought, or words. */
  WORKING: "working",
} as const;

export type WorkingPhase = (typeof WORKING_PHASE)[keyof typeof WORKING_PHASE];

/** What the working line says in each phase. */
export const WORKING_PHASE_WORDS = {
  [WORKING_PHASE.STARTING]: "Starting…",
  [WORKING_PHASE.THINKING]: "Thinking…",
  [WORKING_PHASE.WORKING]: "Working…",
} as const satisfies Record<WorkingPhase, string>;

/**
 * What a working agent is doing, as far as its transcript shows it, which
 * is what its working line says in place of a bare "Working…" between a
 * send and the turn's first row, as Codex and Cursor word a cloud agent's
 * start. It is starting while its session has not run a turn, or while
 * no turn has written a journal, or the newest journal is closed and a
 * line the developer sent after it awaits a turn of its own; thinking
 * while that journal is open and holds nothing drawn past its step
 * boundaries, which is the model at its first step, since a step's
 * reasoning lands only as the step ends and its words a finished sentence
 * at a time; and working once anything is drawn.
 * Note that a line sent while a turn runs steers that turn, so the open
 * journal before it is what the agent is doing, not the line; and that a
 * closed journal with no line after it stays working, because the page
 * that closes a journal can still say the agent runs until its turn row
 * settles a look later.
 */
export function agentWorkingPhase(
  lines: readonly CodingAgentMessage[],
  sessionStarting: boolean,
): WorkingPhase {
  const at = lines.findLastIndex((line) => line.role === MESSAGE_ROLE.ASSISTANT);
  const journal = lines[at];
  if (sessionStarting || journal === undefined) return WORKING_PHASE.STARTING;
  // A closed journal with nothing after it is a turn ending, its row settling a look behind it.
  if (journal.finishedAt !== undefined) {
    return at === lines.length - 1 ? WORKING_PHASE.WORKING : WORKING_PHASE.STARTING;
  }
  return drawnParts(journal).length === 0 ? WORKING_PHASE.THINKING : WORKING_PHASE.WORKING;
}

/** Where a worker stands, read from its delegation's part: running until the call answers, then completed, or failed where the call ended in an error. */
export function workerStatusOf(state: ToolState): CodingAgentStatus {
  if (state === TOOL_STATE.OUTPUT_AVAILABLE) return CODING_AGENT_STATUS.COMPLETED;
  return state === TOOL_STATE.OUTPUT_ERROR
    ? CODING_AGENT_STATUS.FAILED
    : CODING_AGENT_STATUS.RUNNING;
}

/** The id of the row a worker's tab draws its task on, which no row of the service's spells. */
const TASK_ROW_ID = "task";

/**
 * A worker's transcript as its tab draws it: the task it was handed as the
 * first row, from the words the agent's call carried, and the worker's own
 * turns after it. The service's first row is the same task, so the
 * developer's rows are left out rather than drawn twice; nothing else of
 * the developer's reaches a worker.
 */
export function workerLines(
  task: string,
  messages: readonly CodingAgentMessage[],
): readonly CodingAgentMessage[] {
  return [
    { id: TASK_ROW_ID, role: MESSAGE_ROLE.USER, parts: [{ type: AGENT_PART.TEXT, text: task }] },
    ...messages.filter((message) => message.role !== MESSAGE_ROLE.USER),
  ];
}

/** A message's words: its text parts, one paragraph each, which is what a copy of a turn carries and what the developer's line reads as. */
export function messageWords(message: CodingAgentMessage): string {
  return agentParts(message)
    .flatMap((part) => (part.kind === AGENT_PART.TEXT ? [part.text] : []))
    .join("\n\n");
}

/**
 * A line the developer sent that the transcript has not read back yet:
 * drawn as theirs the moment it goes, and let go once the service's own
 * row for it lands.
 */
export interface SentLine {
  /** The line's own id, which no row of the service's spells. */
  readonly id: string;
  /** The words as they went: trimmed, as the service keeps them. */
  readonly text: string;
  /** The files that went with them, drawn on the line as the service's row will draw them. */
  readonly attachments: readonly CodingAgentAttachment[];
  /** The developer's rows the transcript held as the line went, which the row written for it is none of. */
  readonly known: ReadonlySet<string>;
}

/** The developer's own rows of a transcript, which a sent line is read back as one of. */
function developerRows(messages: readonly CodingAgentMessage[]): readonly CodingAgentMessage[] {
  return messages.filter((message) => message.role === MESSAGE_ROLE.USER);
}

/** The ids of the developer's rows a transcript holds now, for a line about to go. */
export function knownDeveloperRows(messages: readonly CodingAgentMessage[]): ReadonlySet<string> {
  return new Set(developerRows(messages).map((message) => message.id));
}

/** The sent lines read against the transcript: the ones still not read back, and the rows that have answered one. */
export interface SentLinesRead {
  readonly lines: readonly SentLine[];
  /** Every row that has answered a line, this read's and earlier ones', which no later line of the same words is read back by. */
  readonly taken: ReadonlySet<string>;
}

/**
 * The sent lines the transcript has not read back yet. A line is read back
 * once a developer's row it did not know holds its words, each such row
 * answering one line in the order the lines went, so two lines of the same
 * words are read back one row at a time; the rows taken stay taken across
 * reads, so a line let go does not hand its row to the next of its words.
 */
export function unreadSentLines(
  sent: readonly SentLine[],
  messages: readonly CodingAgentMessage[],
  taken: ReadonlySet<string> = new Set(),
): SentLinesRead {
  const claimed = new Set(taken);
  const lines = sent.filter((line) => {
    const row = developerRows(messages).find(
      (message) =>
        !line.known.has(message.id) &&
        !claimed.has(message.id) &&
        messageWords(message) === line.text,
    );
    if (row === undefined) return true;
    claimed.add(row.id);
    return false;
  });
  return { lines, taken: claimed };
}

/** A sent line as the tab draws it before the service's row lands: the developer's row. */
function sentLineMessage(line: SentLine): CodingAgentMessage {
  const files = line.attachments.map((file) => ({
    type: "file",
    mediaType: file.mediaType,
    filename: file.name,
    url: `data:${file.mediaType};base64,${file.data}`,
  }));
  return {
    id: line.id,
    role: MESSAGE_ROLE.USER,
    parts: [{ type: AGENT_PART.TEXT, text: line.text }, ...files],
  };
}

/** The transcript's rows, with the lines sent and not yet read back at its end, in the order they went. */
export function agentLines(
  messages: readonly CodingAgentMessage[],
  sent: readonly SentLine[],
): readonly CodingAgentMessage[] {
  return [...messages, ...sent.map(sentLineMessage)];
}

/** Where a pull request lives: GitHub's own pages, which are the one address the tab opens in the browser. */
const GITHUB_ADDRESS = /^https:\/\/github\.com\//u;

/** Whether a link in the transcript is one the tab opens: a page on GitHub, such as the pull request the agent opened. */
export function opensOnGitHub(href: string): boolean {
  return GITHUB_ADDRESS.test(href);
}

/** What each pull request state is called, on the chip's label and, where it changes what the developer would do, on the row. */
const PULL_REQUEST_STATE_LABEL = {
  [PULL_REQUEST_STATE.OPEN]: "Open",
  [PULL_REQUEST_STATE.DRAFT]: "Draft",
  [PULL_REQUEST_STATE.MERGED]: "Merged",
  [PULL_REQUEST_STATE.CLOSED]: "Closed",
} as const satisfies Record<PullRequestState, string>;

/** The characters a branch name may hold and still stand bare in a shell; anything else is quoted. */
const BARE_SHELL_WORD = /^[\w./-]+$/u;

/** A word as a POSIX shell takes it whole: bare where every character is plain, else in single quotes, with a quote inside closed, escaped, and reopened. */
function shellWord(word: string): string {
  return BARE_SHELL_WORD.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`;
}

/** The command that brings the agent's branch onto a developer's machine, as Copy checkout command puts it on the clipboard; the branch quoted where a shell would read into it. */
export function checkoutCommand(branch: string): string {
  const name = shellWord(branch);
  return `git fetch origin ${name} && git switch ${name}`;
}

/** A branch or a file's path as a GitHub address spells it: every character encoded but the slashes GitHub reads as the name's own. */
export function githubPath(name: string): string {
  return encodeURIComponent(name).replaceAll("%2F", "/");
}

/** Where the chip opens on GitHub: the pull request, or the branch compared against the repository's default where there is no pull request yet. */
export function publishedUrl(published: CodingAgentPullRequestAnswer): string | undefined {
  if (published.pullRequest !== null) return published.pullRequest.url;
  if (published.branch === null) return undefined;
  return `https://github.com/${published.repository}/compare/${githubPath(published.branch)}?expand=1`;
}

/** The number as the chip and the row spell it. */
export function pullRequestNumberLabel(
  pullRequest: Pick<CodingAgentPullRequest, "number">,
): string {
  return `#${pullRequest.number}`;
}

/** The word the row says where the pull request stands, only where that changes what the developer would do: a draft, merged, or closed; nothing for one open. */
export function pullRequestStateWord(state: PullRequestState): string | undefined {
  return state === PULL_REQUEST_STATE.OPEN ? undefined : PULL_REQUEST_STATE_LABEL[state];
}

/** The chip's own words for a reader who cannot see it: the number and where it stands. */
export function pullRequestPillLabel(
  pullRequest: Pick<CodingAgentPullRequest, "number" | "state">,
): string {
  return `Pull request ${pullRequestNumberLabel(pullRequest)}, ${PULL_REQUEST_STATE_LABEL[pullRequest.state].toLowerCase()}`;
}

/** How long a tab lets pass between two reads of what the agent published while its transcript keeps landing pages, the service keeping its own answer about as long. */
export const PUBLISHED_REREAD_MS = 15_000;

/** Whether the row summing the turn up is drawn: the agent has ended and a pull request stands. */
export function showsPublishedRow(
  status: CodingAgentStatus,
  published: CodingAgentPullRequestAnswer | undefined,
): published is CodingAgentPullRequestAnswer & { pullRequest: CodingAgentPullRequest } {
  return !agentStillWriting(status) && published?.pullRequest != null;
}
