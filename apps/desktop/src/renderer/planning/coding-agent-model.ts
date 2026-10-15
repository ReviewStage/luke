import { AGENT_TOOL, CONNECTION_TOOL, EVE_TOOL, RETIRED_TOOL } from "@luke/features/agent-tools";
import { agentFailureWords } from "@luke/features/coding-agent-failure-words";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentCallFailure,
} from "@luke/features/coding-agent-view";
import {
  CODING_AGENT_DELEGATE_TOOL,
  CODING_AGENT_FAILURE,
  CODING_AGENT_SENDER,
  CODING_AGENT_STATUS,
  CODING_AGENT_TODO_STATUS,
  CONTEXT_WINDOW,
  type CodingAgentAttachment,
  type CodingAgentFailure,
  type CodingAgentMessage,
  type CodingAgentPullRequest,
  type CodingAgentPullRequestAnswer,
  type CodingAgentSender,
  type CodingAgentStatus,
  type CodingAgentSummary,
  type CodingAgentTodos,
  type CodingAgentUsage,
  type ContextWindow,
  PULL_REQUEST_STATE,
  type PullRequestState,
} from "@luke/features/coding-agent-wire";
import { FAILURE_REASON, type Failure, type FailureReason } from "@luke/features/failure-remedy";
import { agentTabLabel, CATALOG_ID_SEPARATOR, modelLabel } from "@luke/features/model-label";
import {
  type CatalogModel,
  type ContextWindows,
  MODEL_PROVIDER,
  type ModelChoice,
  type ModelProvider,
} from "@luke/features/models-wire";
import {
  REPOSITORY_UNREACHED,
  type RepositoryUnreached,
} from "@luke/features/repository-reach-wire";
import type { PlanEditor } from "@luke/features/task-wire";
import {
  ROW_PART,
  type RowReading,
  TURN_ROW,
  type TurnRow,
  turnRows,
} from "@luke/features/turn-rows";
import type { FormerMember, WorkspaceMember } from "@luke/features/workspace-wire";
import {
  ACTOR_KIND,
  ACTOR_STATE,
  type Actor,
  type ActorState,
  githubLoginActor,
  LUKE_ACTOR,
  personActor,
  SOMEONE_REASON,
} from "@luke/ui/actor-model";
import {
  ACTION_RESULT_STATUS,
  isRecord,
  isWireString,
  MESSAGE_ROLE,
  type UnparsedWireValue,
  type WireValue,
} from "@luke/wire";
import { TOOL_STATE, type ToolState } from "../ai-elements/tool";
import { GLYPH_STATE, type GlyphState, glyphStateWords } from "../state-glyph";
import { remoteCallOf, TOOL_TARGET, todosView, toolTarget } from "./tool-call-model";

/**
 * coding-agent-model.ts -- what the agent tabs, the Start button, and an agent's transcript draw, decided from what the service answered.
 *
 * Pure decisions over the wire's shapes: how an agent is named on its tab,
 * what its tab's glyph says of where it stands, what line ends a transcript whose turn failed
 * or was stopped, whether its transcript is still followed, how a stored message's parts
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

/**
 * The teammate who started an agent, by name, whose key pays for it and whose
 * Mac its commands run on; none for the reader's own agent, one whose starter
 * the service names nobody for, or one read with no account id. Note that an
 * agent read with no id names nobody, because whose it is cannot be told,
 * and taking the reader's own for a teammate's would hide the Settings that
 * mend the reader's own key.
 */
export function teammateStarter(
  startedBy: PlanEditor | undefined,
  readerId: string | undefined,
): string | undefined {
  return teammateRef(startedBy, readerId)?.name;
}

/** The teammate who started an agent, as the wire names them, for a card to draw; none where `teammateStarter` names nobody. */
export function teammateRef(
  startedBy: PlanEditor | undefined,
  readerId: string | undefined,
): PlanEditor | undefined {
  if (startedBy === undefined || readerId === undefined || startedBy.userId === readerId) {
    return undefined;
  }
  return startedBy;
}

/**
 * Whose Mac an agent's Mac commands ran on, as their row names it: its
 * starter, the reader's own among them; none where the service names
 * nobody or the reader's id is not known, when the row says the reader's
 * own as it always has, for the reason `teammateStarter` gives.
 */
export function macOwnerOf(
  startedBy: PlanEditor | undefined,
  members: readonly WorkspaceMember[] | undefined,
  readerId: string | undefined,
  former?: readonly FormerMember[] | undefined,
): Actor | undefined {
  if (startedBy === undefined || readerId === undefined) return undefined;
  return personActor(startedBy, members, readerId, former);
}

/** Where an actor's work stands, as a tab's glyph state says it. */
const ACTOR_STATE_OF_GLYPH = {
  [GLYPH_STATE.WORKING]: ACTOR_STATE.WORKING,
  [GLYPH_STATE.FAILED]: ACTOR_STATE.FAILED,
  [GLYPH_STATE.REST]: ACTOR_STATE.REST,
} as const satisfies Record<GlyphState, ActorState>;

/** An agent as its tile draws it: its harness, read off its model, wearing where it stands, under the name it goes by. */
export function agentActor(
  agent: { readonly model: string; readonly status: CodingAgentStatus },
  name: string,
): Actor {
  return {
    kind: ACTOR_KIND.AGENT,
    name,
    provider: providerOf(agent.model),
    state: ACTOR_STATE_OF_GLYPH[agentGlyphState(agent.status)],
  };
}

/**
 * What sent one of the developer's messages to an agent, as the actor named
 * over it: a teammate read against the workspace's `members` for their
 * face, a former member, Luke, an automation, or the GitHub login GitHub
 * told the agent of, a person's circle by their avatar or an App's bot's
 * square by whether the login is a bot's (`githubLoginActor`); none for the reader's own,
 * a message whose sender was not kept, or a member's read with no account
 * id, for the reason `teammateStarter` gives. A service older than the
 * sender's kind names Luke, an automation, and a former member alike by a
 * name with no account, which the window cannot tell apart, so such a
 * sender stands by its name on the outline of someone it cannot place.
 */
export function lineSender(
  sentBy: CodingAgentSender | undefined,
  readerId: string | undefined,
  members: readonly WorkspaceMember[] | undefined,
  former?: readonly FormerMember[] | undefined,
): Actor | undefined {
  if (sentBy === undefined) return undefined;
  if (sentBy.userId !== undefined && (readerId === undefined || sentBy.userId === readerId)) {
    return undefined;
  }
  switch (sentBy.kind) {
    case CODING_AGENT_SENDER.LUKE:
      return LUKE_ACTOR;
    case CODING_AGENT_SENDER.AUTOMATION:
      return { kind: ACTOR_KIND.AUTOMATION, name: sentBy.name, state: ACTOR_STATE.REST };
    case CODING_AGENT_SENDER.GITHUB:
      return githubLoginActor(sentBy.name);
    case CODING_AGENT_SENDER.FORMER:
      return { kind: ACTOR_KIND.SOMEONE, reason: SOMEONE_REASON.FORMER };
    case CODING_AGENT_SENDER.MEMBER:
    case undefined:
      return sentBy.userId === undefined
        ? { kind: ACTOR_KIND.SOMEONE, reason: SOMEONE_REASON.UNNAMED, name: sentBy.name }
        : personActor({ userId: sentBy.userId, name: sentBy.name }, members, readerId, former);
  }
}

/**
 * The quiet line a transcript ends on once its turn failed or was stopped,
 * with what the turn cost where known; nothing for an agent still writing or
 * one that completed. A teammate's agent names its starter's key, since it
 * runs on theirs and not the reader's.
 */
export function endLine(
  status: CodingAgentStatus,
  failure: CodingAgentFailure | undefined,
  turnUsage?: CodingAgentUsage,
  starter?: string,
): string | undefined {
  switch (status) {
    case CODING_AGENT_STATUS.CANCELLED:
      return withCost("Stopped", turnUsage);
    case CODING_AGENT_STATUS.FAILED: {
      const words = failure === undefined ? undefined : agentFailureWords(failure, starter);
      return withCost(words === undefined ? "Failed" : `Failed: ${words}`, turnUsage);
    }
    case CODING_AGENT_STATUS.STARTING:
    case CODING_AGENT_STATUS.RUNNING:
    case CODING_AGENT_STATUS.COMPLETED:
      return undefined;
  }
}

/** What mends a failed turn from its end line: the API keys' page for a key refused; nothing else there is the developer's to mend. */
export function endLineReason(
  failure: CodingAgentFailure | undefined,
  starter?: string,
): FailureReason {
  // A teammate's key is theirs to mend, so the reader is offered no Settings of their own.
  return failure === CODING_AGENT_FAILURE.PROVIDER_KEY && starter === undefined
    ? FAILURE_REASON.API_KEY
    : FAILURE_REASON.OTHER;
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
  return glyphStateWords(agentGlyphState(status), status === CODING_AGENT_STATUS.CANCELLED);
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
export const START_ARCHIVED = "Unarchive the task to start a coding agent.";

/** What the refusals a Start and a message meet alike say, worded once. */
const SHARED_FAILURE_NOTE = {
  [CODING_AGENT_CALL_FAILURE.REPOSITORY_NOT_REACHABLE]:
    "Luke can't reach this task's repository on GitHub.",
  [CODING_AGENT_CALL_FAILURE.GITHUB_UNANSWERED]: "GitHub didn't answer. Try again.",
  [CODING_AGENT_CALL_FAILURE.MESSAGE_TOO_LONG]: "That message is too long.",
  [CODING_AGENT_CALL_FAILURE.AGENT_NOT_READY]:
    "The agent is still starting. Try again in a moment.",
  [CODING_AGENT_CALL_FAILURE.AGENT_RETIRED]: "This agent has ended. Start a new one.",
  [CODING_AGENT_CALL_FAILURE.TASK_ARCHIVED]: "This task is archived. Unarchive it first.",
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
    case CODING_AGENT_CALL_FAILURE.REPOSITORY_NOT_REACHABLE:
    case CODING_AGENT_CALL_FAILURE.GITHUB_UNANSWERED:
    case CODING_AGENT_CALL_FAILURE.MESSAGE_TOO_LONG:
    case CODING_AGENT_CALL_FAILURE.AGENT_NOT_READY:
    case CODING_AGENT_CALL_FAILURE.AGENT_RETIRED:
    case CODING_AGENT_CALL_FAILURE.TASK_ARCHIVED:
      return MODEL_CHANGE_FAILED;
  }
}

/** What the toast says when a Start the developer left the plan behind did not start; the plan's own note says why. */
export const START_FAILED_AWAY = "The coding agent could not be started.";

/** What the toast says when the service did not stop an agent. */
export const STOP_FAILED = "The agent could not be stopped. Try again.";

/** What the toast says when the service did not rename an agent, whose old name is drawn again. */
export const RENAME_FAILED = "The agent could not be renamed. Try again.";

/** What the toast says when the service did not switch an agent's MCP servers, whose switches fall back. */
export const SERVERS_FAILED = "The agent's MCP servers could not be changed. Try again.";

/** What an agent's archive says once it landed, and what it says refused. */
const ARCHIVED_WORDS = {
  done: "Agent archived",
  refused: "The agent could not be archived. Try again.",
} as const;

/** What an agent's unarchive says once it landed, and what it says refused. */
const UNARCHIVED_WORDS = {
  done: "Agent unarchived",
  refused: "The agent could not be unarchived. Try again.",
} as const;

/** What a refused archive says of an agent still starting, or with a message awaiting its turn, which has no turn to stop yet. */
export const ARCHIVE_NOT_READY = "The agent is still starting its turn. Try again in a moment.";

/** What the toast says once an agent's archive, or its undoing, landed or was refused, by which way it was asked, as a plan's do (`MARK_UNDOS`). */
export function archiveWords(archived: boolean): {
  readonly done: string;
  readonly refused: string;
} {
  return archived ? ARCHIVED_WORDS : UNARCHIVED_WORDS;
}

/** A refused start or message as the view hears it: why, and why the repository is out of reach where it is and the service said. */
export interface RefusedCall {
  readonly failure: CodingAgentCallFailure;
  readonly unreached?: RepositoryUnreached | undefined;
}

/** What a Start that did not start says beside the button, and what mends it. */
export function startFailureNote(refused: RefusedCall, planId: string): Failure {
  return refused.failure === CODING_AGENT_CALL_FAILURE.REPOSITORY_NOT_REACHABLE
    ? unreachedFailure(refused.unreached, planId)
    : callFailure(startFailureWords(refused.failure));
}

/** A refused call's words, which trying again mends. */
function callFailure(text: string): Failure {
  return { reason: FAILURE_REASON.OTHER, text };
}

/**
 * A repository out of reach, said by why with the repository named, and
 * the press that mends it: GitHub connected, or connected again, in
 * Settings; the repository given to Luke on GitHub; another repository
 * chosen; or the plan moved to the workspace whose GitHub reaches it. A
 * service that said nothing more says the bare sentence, which Retry
 * answers, and so does an agent with no plan wherever the remedy is pressed
 * on the plan: only giving the repository to Luke on GitHub is not.
 */
function unreachedFailure(
  unreached: RepositoryUnreached | undefined,
  planId: string | null,
): Failure {
  if (unreached?.reason === REPOSITORY_UNREACHED.NOT_SELECTED) {
    return {
      reason: FAILURE_REASON.ADD_REPOSITORY,
      text: `Luke on GitHub doesn't have access to ${unreached.repository}.`,
      repository: unreached.repository,
      settingsUrl: unreached.settingsUrl,
    };
  }
  if (unreached === undefined || planId === null) {
    return callFailure(SHARED_FAILURE_NOTE[CODING_AGENT_CALL_FAILURE.REPOSITORY_NOT_REACHABLE]);
  }
  const { repository } = unreached;
  switch (unreached.reason) {
    case REPOSITORY_UNREACHED.NOT_CONNECTED:
      return {
        reason: FAILURE_REASON.CONNECT_GITHUB,
        text: `This workspace isn't connected to GitHub, so Luke can't reach ${repository}.`,
        taskId: planId,
      };
    case REPOSITORY_UNREACHED.CONNECTION_LAPSED:
      return {
        reason: FAILURE_REASON.RECONNECT_GITHUB,
        text: `This workspace's GitHub connection was removed or suspended, so Luke can't reach ${repository}.`,
        taskId: planId,
      };
    case REPOSITORY_UNREACHED.OTHER_OWNER:
      return {
        reason: FAILURE_REASON.CHOOSE_REPOSITORY,
        text:
          unreached.connectedTo === undefined
            ? `${repository} isn't under the GitHub account this workspace is connected to.`
            : `${repository} isn't under ${unreached.connectedTo}, the GitHub account this workspace is connected to.`,
        taskId: planId,
      };
    case REPOSITORY_UNREACHED.GONE:
      return {
        reason: FAILURE_REASON.CHOOSE_REPOSITORY,
        text: `${repository} was renamed, transferred, or deleted on GitHub.`,
        taskId: planId,
      };
    case REPOSITORY_UNREACHED.OTHER_WORKSPACE:
      return {
        reason: FAILURE_REASON.MOVE_TASK,
        text: `${repository} is connected to ${unreached.workspace.name}, not this workspace.`,
        taskId: planId,
        workspace: unreached.workspace,
      };
  }
}

/** What a Start that did not start says, by why. */
function startFailureWords(failure: CodingAgentCallFailure): string {
  switch (failure) {
    case CODING_AGENT_CALL_FAILURE.NO_REPOSITORY:
      return START_NEEDS_REPOSITORY;
    case CODING_AGENT_CALL_FAILURE.INVALID_CHOICE:
      return "That model isn't offered any more. Choose another.";
    case CODING_AGENT_CALL_FAILURE.NOT_FOUND:
      return "This task no longer exists.";
    case CODING_AGENT_CALL_FAILURE.UNANSWERED:
      return "The agent could not be started. Try again.";
    case CODING_AGENT_CALL_FAILURE.REPOSITORY_NOT_REACHABLE:
    case CODING_AGENT_CALL_FAILURE.GITHUB_UNANSWERED:
    case CODING_AGENT_CALL_FAILURE.MESSAGE_TOO_LONG:
    case CODING_AGENT_CALL_FAILURE.AGENT_NOT_READY:
    case CODING_AGENT_CALL_FAILURE.AGENT_RETIRED:
    case CODING_AGENT_CALL_FAILURE.TASK_ARCHIVED:
      return SHARED_FAILURE_NOTE[failure];
  }
}

/** What a message that did not reach the agent says under the composer, and what mends it, on a plan or, for an agent with none, where the remedy needs no plan. */
export function messageFailureNote(refused: RefusedCall, planId: string | null): Failure {
  return refused.failure === CODING_AGENT_CALL_FAILURE.REPOSITORY_NOT_REACHABLE
    ? unreachedFailure(refused.unreached, planId)
    : callFailure(messageFailureWords(refused.failure));
}

/** What a message that did not reach the agent says, by why, where only the words are drawn, as an Inbox answer's are. */
export function messageFailureWords(failure: CodingAgentCallFailure): string {
  switch (failure) {
    case CODING_AGENT_CALL_FAILURE.NOT_FOUND:
      return "This agent no longer exists.";
    // A message names no repository and no model, so neither refusal is its own.
    case CODING_AGENT_CALL_FAILURE.NO_REPOSITORY:
    case CODING_AGENT_CALL_FAILURE.INVALID_CHOICE:
      return "The message could not be sent. Try again.";
    // No answer is not a refusal: the words may have reached the agent, and Retry carries the same key, so they reach it once.
    case CODING_AGENT_CALL_FAILURE.UNANSWERED:
      return "Luke didn't hear back. Retry sends it again, once.";
    case CODING_AGENT_CALL_FAILURE.REPOSITORY_NOT_REACHABLE:
    case CODING_AGENT_CALL_FAILURE.GITHUB_UNANSWERED:
    case CODING_AGENT_CALL_FAILURE.MESSAGE_TOO_LONG:
    case CODING_AGENT_CALL_FAILURE.AGENT_NOT_READY:
    case CODING_AGENT_CALL_FAILURE.AGENT_RETIRED:
    case CODING_AGENT_CALL_FAILURE.TASK_ARCHIVED:
      return SHARED_FAILURE_NOTE[failure];
  }
}

/** Whether a refusal is for good, so the composer closes on it rather than offering Retry: the agent's session has ended. */
export function closesComposer(failure: CodingAgentCallFailure): boolean {
  return failure === CODING_AGENT_CALL_FAILURE.AGENT_RETIRED;
}

/**
 * A model, and an agent, as a tab or a menu names it, shared with the main
 * process's notifications so neither is ever named two ways
 * (`@luke/features/model-label`).
 */
export { agentTabLabel, modelLabel };

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
function orderedModels(models: readonly CatalogModel[]): readonly CatalogModel[] {
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

/** What the Fast row says where the service withholds the model's fast version because Anthropic never granted the organization of the key the account's agents run on fast mode. */
const FAST_NOT_ENABLED_NOTE = "Fast isn't enabled for this key's Anthropic organization";

/** Where an organization asks Anthropic for fast mode, which it grants organization by organization. */
export const FAST_ACCESS_URL = "https://claude.com/fast-mode";

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

/** Why the Fast row rests for the base model chosen, or nothing where its fast version is offered: withheld because the key's organization was never granted fast mode, or none listed. */
export function fastRestingNote(
  baseId: string,
  offered: OfferedModel | undefined,
  models: readonly CatalogModel[],
): string | undefined {
  if (offered?.fast !== undefined) return undefined;
  if (offered?.model.fastNotEnabled === true) return FAST_NOT_ENABLED_NOTE;
  return `No fast version of ${modelLabel(baseId, models)}`;
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
  /** One of the developer's lines that reached the turn while it ran, drawn among the turn's parts where it arrived; never a part a message stores. */
  ARRIVED: "arrived",
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
  | { readonly kind: typeof AGENT_PART.OTHER }
  | { readonly kind: typeof AGENT_PART.ARRIVED; readonly line: CodingAgentMessage };

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

/**
 * The coding agents an agent's own calls started, by id, in the order its
 * transcript holds them: each `start_agent` that answered an agent. A tab
 * that sees one it had not reads its plan's agents again, as the plan does
 * when Luke starts one, since nothing else tells the list.
 */
export function startedAgentIds(messages: readonly CodingAgentMessage[]): readonly string[] {
  return messages.flatMap(agentParts).flatMap((part) => startedAgentOf(part) ?? []);
}

/** Whether a call is a delegation to a worker, a coding agent's or the planning model's, which the tab draws as a subagent's row rather than a call's. */
export function delegates(part: Extract<AgentPart, { kind: typeof AGENT_PART.TOOL }>): boolean {
  return part.tool === CODING_AGENT_DELEGATE_TOOL || part.tool === EVE_TOOL.WORKER;
}

/** Whether a part is a delegation to a worker (`delegates`). */
export function isDelegation(
  part: AgentPart,
): part is Extract<AgentPart, { kind: typeof AGENT_PART.TOOL }> {
  return part.kind === AGENT_PART.TOOL && delegates(part);
}

/**
 * The coding agent a call started, read off its answer, which is the agent
 * its row opens; nothing for any other call, one still running, or a start
 * refused, which answers no agent.
 */
export function startedAgentOf(part: AgentPart): string | undefined {
  if (
    part.kind !== AGENT_PART.TOOL ||
    (part.tool !== AGENT_TOOL.START_AGENT && part.tool !== RETIRED_TOOL.START_CODING_AGENT)
  ) {
    return undefined;
  }
  const target = toolTarget(part);
  return target?.kind === TOOL_TARGET.AGENT ? target.agent : undefined;
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

/** How the fold reads a part: its words, its reasoning as a note, a delegation as a subagent and a to-do list each on a row of its own, a start that began a coding agent counted apart, and every other call grouped with the calls beside it. */
const AGENT_READING: RowReading<AgentPart> = {
  key: (part, index) => {
    if (part.kind === AGENT_PART.TOOL) return part.callId;
    return part.kind === AGENT_PART.ARRIVED ? part.line.id : String(index);
  },
  part: (part) => {
    if (part.kind === AGENT_PART.TEXT) return ROW_PART.WORDS;
    if (part.kind === AGENT_PART.ARRIVED) return ROW_PART.ARRIVED;
    if (part.kind !== AGENT_PART.TOOL) return ROW_PART.NOTE;
    if (isDelegation(part)) return ROW_PART.SUBAGENT;
    if (startedAgentOf(part) !== undefined) return ROW_PART.CODING_AGENT;
    return isTodos(part) ? ROW_PART.LONE_CALL : ROW_PART.CALL;
  },
  running: (part) =>
    part.kind === AGENT_PART.TOOL &&
    (part.state === TOOL_STATE.INPUT_STREAMING || part.state === TOOL_STATE.INPUT_AVAILABLE),
};

/** No subagent's session saying where it stands. */
const NO_WORKERS: ReadonlyMap<string, ToolState> = new Map();

/** What a tab knows of a turn beyond its message, which its rows read. */
interface AgentTurnPlace {
  /** The call whose to-do list stays out of a finished turn's fold. */
  readonly newestTodos?: string | undefined;
  /** Where each call's subagent stands as its own session says, which its row draws over the call's own state, since a call may settle the moment its worker is under way. */
  readonly workers?: ReadonlyMap<string, ToolState>;
  /** Whether the turn's words were said aloud and stand after it, as a spoken turn's on the Call tab do, which folds all of a finished turn. */
  readonly said?: boolean;
  /** The developer's lines that reached the turn while it ran (`arrivedIn`), each drawn among its parts after the steps it arrived after. */
  readonly arrived?: readonly CodingAgentMessage[];
}

/** The `connection_execute` calls among the parts that an integration's own call ran under, by their ids. */
function runConnectionCalls(parts: readonly AgentPart[]): ReadonlySet<string> {
  return new Set(
    parts.flatMap((part) => {
      const remote =
        part.kind === AGENT_PART.TOOL ? remoteCallOf(part.tool, part.input) : undefined;
      return remote === undefined ? [] : [remote.call.parentCallId];
    }),
  );
}

type ToolPart = Extract<AgentPart, { kind: typeof AGENT_PART.TOOL }>;

/** Whether a part is a `show_image` call that showed its pictures, which a reader reads as their own and never folds away. */
function isShownSet(part: AgentPart): part is ToolPart {
  return (
    part.kind === AGENT_PART.TOOL &&
    part.tool === AGENT_TOOL.SHOW_IMAGE &&
    part.state === TOOL_STATE.OUTPUT_AVAILABLE &&
    isRecord(part.output) &&
    part.output.status === ACTION_RESULT_STATUS.ACCEPTED
  );
}

/**
 * A `show_image` call its tool refused, as the call that failed it is: the
 * service answers a refusal as an output carrying why, so the row reads
 * the reason as its error, its line wears the failed mark, and no picture
 * waits for bytes that were never kept; nothing for any other part.
 */
function refusedSet(part: AgentPart): ToolPart | undefined {
  if (part.kind !== AGENT_PART.TOOL || part.tool !== AGENT_TOOL.SHOW_IMAGE) return undefined;
  if (part.state !== TOOL_STATE.OUTPUT_AVAILABLE || !isRecord(part.output)) return undefined;
  const reason = part.output.reason;
  if (part.output.status !== ACTION_RESULT_STATUS.REJECTED || !isWireString(reason))
    return undefined;
  return { ...part, state: TOOL_STATE.OUTPUT_ERROR, errorText: reason };
}

function listOf(value: UnparsedWireValue, key: string): readonly WireValue[] {
  if (!isRecord(value)) return [];
  const list = value[key];
  return Array.isArray(list) ? list : [];
}

/** Two shown sets as one: the first's call, both sets' pictures in order. */
function joinedSets(first: ToolPart, second: ToolPart): ToolPart {
  return {
    ...first,
    input: { images: [...listOf(first.input, "images"), ...listOf(second.input, "images")] },
    output: {
      status: ACTION_RESULT_STATUS.ACCEPTED,
      pictures: [...listOf(first.output, "pictures"), ...listOf(second.output, "pictures")],
    },
  };
}

/**
 * The parts of a message a row is drawn from: every part but a step
 * boundary, a kind this build does not draw, and a `connection_execute`
 * whose integration's own call stands in the message; and every run of
 * shown sets, one straight after another, joined into one set, as the
 * parallel calls of one step are meant to be. Note that such a wrapper is
 * left out, because the call it ran is the same call told twice, and that
 * one with no such call, or one that failed, keeps its row, because its row
 * is where it, or its error, is read. Each line that reached the turn
 * while it ran stands ahead of the first step after the steps it arrived
 * after, or at the end where that step has not begun.
 */
function drawnParts(
  message: CodingAgentMessage,
  arrived: readonly CodingAgentMessage[] = [],
): readonly AgentPart[] {
  const parts = agentParts(message);
  const ran = runConnectionCalls(parts);
  const drawn: AgentPart[] = [];
  const waiting = arrived.toSorted((a, b) => afterStepOf(a) - afterStepOf(b));
  let begun = 0;
  const arrive = (steps: number) => {
    while (waiting[0] !== undefined && afterStepOf(waiting[0]) <= steps) {
      const line = waiting.shift();
      if (line !== undefined) drawn.push({ kind: AGENT_PART.ARRIVED, line });
    }
  };
  for (const part of parts) {
    if (part.kind === AGENT_PART.STEP_START) {
      arrive(begun);
      begun += 1;
      continue;
    }
    if (part.kind === AGENT_PART.OTHER) continue;
    if (
      part.kind === AGENT_PART.TOOL &&
      part.tool === CONNECTION_TOOL.EXECUTE &&
      part.state !== TOOL_STATE.OUTPUT_ERROR &&
      ran.has(part.callId)
    ) {
      continue;
    }
    const last = drawn.at(-1);
    const refusal = refusedSet(part);
    if (refusal !== undefined) {
      drawn.push(refusal);
      continue;
    }
    if (last !== undefined && isShownSet(last) && isShownSet(part)) {
      drawn[drawn.length - 1] = joinedSets(last, part);
    } else {
      drawn.push(part);
    }
  }
  arrive(Number.POSITIVE_INFINITY);
  return drawn;
}

/** The steps of its turn a line arrived after; none for a line no turn took in under way. */
function afterStepOf(line: CodingAgentMessage): number {
  return line.arrivedIn?.afterStep ?? 0;
}

/**
 * One of the agent's turns as the rows every transcript draws, folded as
 * the Call tab folds Luke's (`turn-rows.ts`). A step boundary and a part
 * this build does not draw are left out, because the parts keep one rhythm
 * across them. The turn moves while the agent may still write to it, which
 * is its last message; any other has ended. A worker's session folds as
 * its agent's does, since a run of calls reads the same whoever made it.
 * The agent's newest to-do list, named by the call that wrote it
 * (`newestTodos`), stays out of a finished turn's fold, so the list
 * standing is never folded away, and so does every set of pictures the
 * agent showed, which is its answer as much as its words are. A line that
 * reached the turn while it ran (`arrived`) stands among its parts where it
 * arrived, splitting the fold of a finished turn around it.
 */
export function agentRows(
  message: CodingAgentMessage,
  moving: boolean,
  { newestTodos, workers = NO_WORKERS, said = false, arrived = [] }: AgentTurnPlace = {},
): readonly TurnRow<AgentPart>[] {
  const parts = drawnParts(message, arrived);
  const reading: RowReading<AgentPart> = {
    ...AGENT_READING,
    running: (part) =>
      AGENT_READING.running(part) ||
      (part.kind === AGENT_PART.TOOL && workers.get(part.callId) === TOOL_STATE.INPUT_AVAILABLE),
    failed: (part) =>
      part.kind === AGENT_PART.TOOL &&
      (workers.get(part.callId) ?? part.state) === TOOL_STATE.OUTPUT_ERROR,
    kept: (part) =>
      (part.kind === AGENT_PART.TOOL && part.callId === newestTodos) || isShownSet(part),
  };
  return turnRows(parts, reading, {
    key: message.id,
    moving,
    done: !moving,
    said,
  });
}

/** One of a transcript's rows as the tab draws it, with the developer's lines that reached it while its turn ran. */
export interface PlacedMessage {
  readonly message: CodingAgentMessage;
  /** The lines its turn took in under way (`arrivedIn`), oldest first; none on any row but a turn's journal. */
  readonly arrived: readonly CodingAgentMessage[];
}

/**
 * A transcript's rows with each line that reached a turn under way moved
 * into that turn's journal, which draws it where it arrived, out of the
 * order the service keeps, where the journal closed behind it. A line whose
 * journal is not among the rows, as when its page is still to land, stands
 * where the order puts it, as every line does from a service older than it.
 */
export function placedMessages(messages: readonly CodingAgentMessage[]): readonly PlacedMessage[] {
  const journals = new Set(
    messages.filter((message) => message.role === MESSAGE_ROLE.ASSISTANT).map((each) => each.id),
  );
  const arrived = new Map<string, CodingAgentMessage[]>();
  for (const message of messages) {
    const journal = message.arrivedIn?.journalId;
    if (journal === undefined || !journals.has(journal)) continue;
    arrived.set(journal, [...(arrived.get(journal) ?? []), message]);
  }
  return messages.flatMap((message) => {
    const journal = message.arrivedIn?.journalId;
    if (journal !== undefined && journals.has(journal)) return [];
    return [{ message, arrived: arrived.get(message.id) ?? [] }];
  });
}

/** A stretch of a turn's rows as the tab draws it: the turn's own rows, or a line that reached it while it ran, which stands between them as the developer's own message. */
export type TurnStretch =
  | { readonly line: CodingAgentMessage; readonly rows?: undefined }
  | { readonly line?: undefined; readonly rows: readonly TurnRow<AgentPart>[] };

/** A turn's rows cut at every line that reached it while it ran, so the tab draws each line as a message of its own between the turn's work before and after it. */
export function turnStretches(rows: readonly TurnRow<AgentPart>[]): readonly TurnStretch[] {
  const stretches: TurnStretch[] = [];
  let run: TurnRow<AgentPart>[] = [];
  for (const row of rows) {
    if (row.kind !== TURN_ROW.BLOCK || row.block.kind !== AGENT_PART.ARRIVED) {
      run.push(row);
      continue;
    }
    if (run.length > 0) stretches.push({ rows: run });
    run = [];
    stretches.push({ line: row.block.line });
  }
  if (run.length > 0 || stretches.length === 0) stretches.push({ rows: run });
  return stretches;
}

/** What an agent is doing while it may still write, as its transcript's working line says it. */
const WORKING_PHASE = {
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

/**
 * How a worker's row marks where it stands, as its own session reads: still
 * running while it starts or works, at rest once it completed or was
 * stopped, whose own tab says which, and failed where it failed.
 */
export function workerToolState(status: CodingAgentStatus): ToolState {
  switch (status) {
    case CODING_AGENT_STATUS.STARTING:
    case CODING_AGENT_STATUS.RUNNING:
      return TOOL_STATE.INPUT_AVAILABLE;
    case CODING_AGENT_STATUS.FAILED:
      return TOOL_STATE.OUTPUT_ERROR;
    case CODING_AGENT_STATUS.COMPLETED:
    case CODING_AGENT_STATUS.CANCELLED:
      return TOOL_STATE.OUTPUT_AVAILABLE;
  }
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
 * the developer's reaches a worker. A worker opened by a link, which
 * carries no words, takes its task from the service's first row, and is
 * drawn as any other.
 */
export function workerLines(
  task: string,
  messages: readonly CodingAgentMessage[],
): readonly CodingAgentMessage[] {
  // A worker opened by its link carries no task's words, so the service's own first row's are the task.
  const first = messages.find((message) => message.role === MESSAGE_ROLE.USER);
  const words = task === "" && first !== undefined ? messageWords(first) : task;
  return [
    { id: TASK_ROW_ID, role: MESSAGE_ROLE.USER, parts: [{ type: AGENT_PART.TEXT, text: words }] },
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
