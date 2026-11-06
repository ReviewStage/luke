import {
  agentFailureWords,
  hostLostWords,
  launchStoppedWords,
  mendedByNewAgent,
} from "@repo/features/agent-failure-words";
import { recordedVideosOf } from "@repo/features/agent-pictures-model";
import { harnessNameOf } from "@repo/features/agent-runtime-models";
import {
  AGENT_TOOL,
  CLAUDE_CODE_TOOL,
  CONNECTION_TOOL,
  EVE_TOOL,
  RETIRED_TOOL,
} from "@repo/features/agent-tools";
import { AGENT_CALL_FAILURE, type AgentCallFailure } from "@repo/features/agent-view";
import {
  AGENT_ARCHIVER,
  AGENT_DELEGATE_TOOL,
  AGENT_FAILURE,
  AGENT_LAUNCH,
  AGENT_PAYER,
  AGENT_RUNTIME,
  AGENT_SENDER,
  AGENT_STATUS,
  type AgentArchivedBy,
  type AgentAttachment,
  type AgentFailure,
  type AgentLaunch,
  type AgentPayer,
  type AgentPullRequest,
  type AgentPullRequestAnswer,
  type AgentRuntime,
  type AgentSender,
  type AgentStatus,
  type AgentSummary,
  type AgentTranscriptMessage,
  CONTEXT_WINDOW,
  type ContextWindow,
  EXTRA_REPOSITORY_REFUSAL,
  type ExtraRepositoryRefusal,
  LOCAL_AGENT_REFUSAL,
  type LocalAgentRefusal,
  type NativeAgentRuntime,
  PART_CUT_FIELD,
  type PartCut,
  PULL_REQUEST_STATE,
  type PullRequestState,
  type RefusedDevice,
} from "@repo/features/agent-wire";
import {
  DEVICE_PLATFORM,
  type DeviceLaunchStep,
  type DeviceLaunchUnstarted,
  type DevicePlatform,
} from "@repo/features/device-agent-wire";
import {
  FAILURE_REASON,
  type Failure,
  type FailureReason,
  remedyLabel,
} from "@repo/features/failure-remedy";
import { agentName, CATALOG_ID_SEPARATOR, modelLabel } from "@repo/features/model-label";
import {
  type CatalogModel,
  type ContextWindows,
  MODEL_PROVIDER,
  MODEL_SPEED,
  type ModelChoice,
  type ModelProvider,
  type ModelSpeed,
  modelSpeedOf,
  standardModelIdOf,
} from "@repo/features/models-wire";
import { formatCompact, formatUsd } from "@repo/features/number-format";
import { PRODUCT_NAME } from "@repo/features/product-name";
import {
  REPOSITORY_UNREACHED,
  type RepositoryUnreached,
} from "@repo/features/repository-reach-wire";
import { type PlanEditor, TASK_MODE, type TaskMode } from "@repo/features/task-wire";
import { dayAndTimeText } from "@repo/features/time-format";
import {
  ROW_PART,
  type RowReading,
  TURN_ROW,
  type TurnRow,
  turnRows,
} from "@repo/features/turn-rows";
import { andList, readFailedWords } from "@repo/features/words";
import type { FormerMember, WorkspaceMember } from "@repo/features/workspace-wire";
import {
  ACTOR_KIND,
  ACTOR_STATE,
  type Actor,
  type ActorState,
  APP_ACTOR,
  githubLoginActor,
  personActor,
  SOMEONE_REASON,
} from "@repo/ui/actor-model";
import { MESSAGE_BLOCK, messageText } from "@repo/ui/reply-quote";
import {
  ACTION_RESULT_STATUS,
  type AgentMessageMetadata,
  type CommentLineMetadata,
  GITHUB_CHECK_CONCLUSION,
  GITHUB_LINE_EVENT,
  type GitHubCheckConclusion,
  type GitHubLineMetadata,
  isFailingConclusion,
  isRecord,
  isWireNumber,
  isWireString,
  MESSAGE_CHANNEL,
  MESSAGE_ROLE,
  type SlackLineMetadata,
  type ThreadLineMetadata,
  type UnparsedWireValue,
  USER_MESSAGE_METADATA,
  type UserMessageMetadata,
  type WireValue,
} from "@repo/wire";
import { sentLineId } from "@repo/wire/host-ids";
import { Option, Predicate, Schema } from "effect";
import { TOOL_STATE, type ToolState } from "../ai-elements/tool.js";
import { devicePlatformOf } from "../device-platform.js";
import { GLYPH_STATE, type GlyphState, glyphStateWords } from "../state-glyph.js";
import { drawnCall } from "./native-tool-calls.js";
import {
  plainWords,
  remoteCallOf,
  TOOL_TARGET,
  type ToolTarget,
  toolTarget,
} from "./tool-call-model.js";

/**
 * agent-model.ts -- what the agent tabs, a Start, and an agent's transcript draw, decided from what the service answered.
 *
 * Pure decisions over the wire's shapes: how an agent is named on its tab,
 * what its tab's glyph says of where it stands, what line ends a transcript whose turn failed
 * or was stopped, whether its transcript is still followed, how a stored message's parts
 * are read for drawing, which of its rows wait above the composer rather
 * than in the transcript, what its working line says it is doing, when a
 * line the developer sent has been read back, what a Start or a message
 * that did not land says, and what its
 * branch chip and the pull request's row say and open, and how what an agent or a turn cost is told.
 * Nothing here asks anything.
 */

/** The words that separate the parts of a line. */
const LINE_SEPARATOR = " · ";

/** Each payer as the model menu's last line names it; a key's line goes on to what the agent has cost. */
const PAYER_WORDS = {
  [AGENT_PAYER.CLAUDE_SUBSCRIPTION]: "Using Claude plan",
  [AGENT_PAYER.CHATGPT_SUBSCRIPTION]: "Using ChatGPT plan",
  [AGENT_PAYER.APP]: `${PRODUCT_NAME}'s API key`,
  [AGENT_PAYER.MAC_SIGN_IN]: "Using your Mac's sign-in",
} as const satisfies Record<Exclude<AgentPayer, typeof AGENT_PAYER.API_KEY>, string>;

/** The member's own API key, named by the provider it is for. */
const API_KEY_WORDS = {
  [MODEL_PROVIDER.ANTHROPIC]: "Anthropic API key",
  [MODEL_PROVIDER.OPENAI]: "OpenAI API key",
} as const satisfies Record<ModelProvider, string>;

/** A key whose provider the choice does not say. */
const ANY_API_KEY = "API key";

/** The payers billed by the token, whose line says what the agent has cost so far. */
const PRICED_PAYERS: ReadonlySet<AgentPayer> = new Set([AGENT_PAYER.API_KEY, AGENT_PAYER.APP]);

/**
 * Who pays for the agent, for the model menu's last line: "Using ChatGPT
 * plan", "Using Claude plan", or a key by its provider and what the run has
 * cost on it, "OpenAI API key · $0.42 so far", the key alone where the
 * service could not price every step; nothing where no payer is named.
 * Note that a plan's line names no tokens, since the composer's context
 * ring already says how full the window is and a subscription has no bill
 * per token, and that the price is the whole run's, the agent's own turns
 * and its workers', at the catalog's list prices.
 */
export function agentPayerLine(
  payer: AgentPayer | undefined,
  provider: ModelProvider | undefined,
  costUsd: number | undefined,
): string | undefined {
  if (payer === undefined) return undefined;
  const words =
    payer === AGENT_PAYER.API_KEY
      ? provider === undefined
        ? ANY_API_KEY
        : API_KEY_WORDS[provider]
      : PAYER_WORDS[payer];
  return PRICED_PAYERS.has(payer) && costUsd !== undefined
    ? `${words}${LINE_SEPARATOR}${formatUsd(costUsd)} so far`
    : words;
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

/** Who archived an agent, and why, as its card and its archived banner say it. */
export interface ArchivedByReading {
  /** "Archived by Dean", "Archived by ${PRODUCT_NAME} for you", "Archived by Bill by seat for Dean", "Archived with its task by Dean". */
  readonly words: string;
  readonly reason: string | undefined;
}

/** What names an agent that archived another whose title the service kept empty. */
const UNNAMED_ARCHIVER = "another agent";

/**
 * Who archived an agent, as the reader reads it: the member who did, or
 * the app or the archiving agent and the member they acted for, "you" for the
 * reader's own account, the member left out once their account is gone;
 * and the reason they gave. An agent archived along with its task says so.
 */
export function archivedByReading(
  by: AgentArchivedBy,
  readerId: string | undefined,
): ArchivedByReading {
  const member =
    by.member === undefined ? undefined : by.member.userId === readerId ? "you" : by.member.name;
  const forMember = member === undefined ? "" : ` for ${member}`;
  const archiver =
    by.by === AGENT_ARCHIVER.MEMBER
      ? member
      : by.by === AGENT_ARCHIVER.APP
        ? `${PRODUCT_NAME}${forMember}`
        : `${by.agent?.name || UNNAMED_ARCHIVER}${forMember}`;
  const archived = by.withTask === true ? "Archived with its task" : "Archived";
  return {
    words: archiver === undefined ? archived : `${archived} by ${archiver}`,
    reason: by.reason,
  };
}

/**
 * A subagent or a brain's worker as its card's tile draws it: the harness
 * its model runs in, or the muted robot where the model is not known, giving
 * way to the working mark while it works, as an agent's tile does.
 */
export function subagentActor(model: string | undefined, state: GlyphState, name: string): Actor {
  return {
    kind: ACTOR_KIND.AGENT,
    name,
    provider: model === undefined ? undefined : providerOf(model),
    state: ACTOR_STATE_OF_GLYPH[state],
  };
}

/** Where an agent's work stands, as its tile wears it, read off its status. */
export function agentActorState(status: AgentStatus): ActorState {
  return ACTOR_STATE_OF_GLYPH[agentGlyphState(status)];
}

/**
 * An agent as its tile draws it: its harness, read off its model, wearing where it stands
 * (at rest where that is not known), under the name it goes by.
 */
export function agentActor(
  agent: {
    readonly model: string;
    readonly status?: AgentStatus | undefined;
  },
  name: string,
): Extract<Actor, { kind: typeof ACTOR_KIND.AGENT }> {
  return {
    kind: ACTOR_KIND.AGENT,
    name,
    provider: providerOf(agent.model),
    state:
      agent.status === undefined
        ? ACTOR_STATE.REST
        : ACTOR_STATE_OF_GLYPH[agentGlyphState(agent.status)],
  };
}

/**
 * What sent one of the developer's messages to an agent, as the actor named
 * over it: a teammate read against the workspace's `members` for their
 * face, a former member, the app, an automation, another coding agent of the
 * workspace by its name on its harness's mark, read off the model the
 * service answers it runs on, and the mark of no known harness where it
 * answers none, or the GitHub login GitHub
 * told the agent of, a person's circle by their avatar or an App's bot's
 * square by whether the login is a bot's (`githubLoginActor`); none for the reader's own,
 * a message whose sender was not kept, or a member's read with no account
 * id, for the reason `teammateStarter` gives. A service older than the
 * sender's kind names the app, an automation, and a former member alike by a
 * name with no account, which the window cannot tell apart, so such a
 * sender stands by its name on the outline of someone it cannot place.
 */
export function lineSender(
  sentBy: AgentSender | undefined,
  readerId: string | undefined,
  members: readonly WorkspaceMember[] | undefined,
  former?: readonly FormerMember[] | undefined,
): Actor | undefined {
  if (sentBy === undefined) return undefined;
  if (sentBy.userId !== undefined && (readerId === undefined || sentBy.userId === readerId)) {
    return undefined;
  }
  if (sentBy.agent === true) {
    return {
      kind: ACTOR_KIND.AGENT,
      name: sentBy.name,
      ...(sentBy.agentId === undefined ? undefined : { agentId: sentBy.agentId }),
      provider: sentBy.model === undefined ? undefined : providerOf(sentBy.model),
      state: ACTOR_STATE.REST,
    };
  }
  switch (sentBy.kind) {
    case AGENT_SENDER.APP:
      return APP_ACTOR;
    case AGENT_SENDER.AUTOMATION:
      return { kind: ACTOR_KIND.AUTOMATION, name: sentBy.name, state: ACTOR_STATE.REST };
    case AGENT_SENDER.GITHUB:
      return githubLoginActor(sentBy.name);
    case AGENT_SENDER.FORMER:
      return { kind: ACTOR_KIND.SOMEONE, reason: SOMEONE_REASON.FORMER };
    case AGENT_SENDER.MEMBER:
    case undefined:
      return sentBy.userId === undefined
        ? { kind: ACTOR_KIND.SOMEONE, reason: SOMEONE_REASON.UNNAMED, name: sentBy.name }
        : personActor({ userId: sentBy.userId, name: sentBy.name }, members, readerId, former);
  }
}

/**
 * Who sent a transcript line, as `lineSender` names them, a GitHub login
 * wearing the avatar its line carries where GitHub named one (`by_avatar`),
 * since an App's bot's picture lives at an address its login does not name.
 */
export function messageSender(
  message: AgentTranscriptMessage,
  readerId: string | undefined,
  members: readonly WorkspaceMember[] | undefined,
  former?: readonly FormerMember[] | undefined,
): Actor | undefined {
  const sender = lineSender(message.sentBy, readerId, members, former);
  const avatarUrl = githubLineOf(message)?.by_avatar;
  return sender?.kind === ACTOR_KIND.GITHUB && avatarUrl !== undefined
    ? { ...sender, avatarUrl }
    : sender;
}

/** The parts of the line a transcript ends on: its words, and whether it tells of a failure, which is drawn as one. */
export interface EndLineParts {
  readonly words: string;
  readonly failed: boolean;
  /** Why a failed turn failed, as the service's word, which the failure it reports names; none for a stop, or a failure that said no reason. */
  readonly failure?: AgentFailure | undefined;
  /** Why a host's launch never started, where its host said, which may draw a card of its own in the line's place (`github-sign-in-card.tsx`). */
  readonly unstarted?: DeviceLaunchUnstarted | undefined;
}

/** Where a launch its host settled unstarted stopped, and why where its host said, as the page said, and the harness the agent runs, as its summary says. */
export interface LaunchStopped {
  readonly step: DeviceLaunchStep;
  readonly runtime?: NativeAgentRuntime | undefined;
  readonly unstarted?: DeviceLaunchUnstarted | undefined;
}

/**
 * The quiet line a transcript ends on once its turn failed or was stopped,
 * in parts, so its words and its failed mark can be drawn apart; nothing
 * for an agent still writing or one that completed. A teammate's agent
 * names its starter's key, since it runs on theirs and not the reader's.
 * An agent whose tab offers Continue, or that another already continued
 * (`continuable`), is not told to start a new one. One whose host stopped
 * beating while its turn ran (`hostLost`) names the host and that a message
 * carries it on once the host is back, in place of its failure's words. One
 * whose host settled its launch unstarted (`launchStopped`) names the step
 * the launch stopped at and that a message tries again.
 * Note that it names no price, because a price in the window means the
 * whole run's, which the model menu's last line says (`agentPayerLine`).
 */
export function endLineParts(
  status: AgentStatus,
  failure: AgentFailure | undefined,
  starter?: string,
  continuable = false,
  hostLost?: { readonly host: string },
  launchStopped?: LaunchStopped,
): EndLineParts | undefined {
  switch (status) {
    case AGENT_STATUS.CANCELED:
      return { words: "Stopped", failed: false };
    case AGENT_STATUS.FAILED: {
      if (hostLost !== undefined)
        return { words: hostLostWords(hostLost.host), failed: true, failure };
      if (launchStopped !== undefined) {
        const words = launchStoppedWords(
          launchStopped.step,
          launchStopped.runtime,
          launchStopped.unstarted,
        );
        const { unstarted } = launchStopped;
        return { words, failed: true, failure, ...(unstarted === undefined ? {} : { unstarted }) };
      }
      const words =
        failure === undefined ? undefined : agentFailureWords(failure, starter, continuable);
      return {
        words: `Failed: ${words ?? "the run ended without saying why"}`,
        failed: true,
        failure,
      };
    }
    case AGENT_STATUS.STARTING:
    case AGENT_STATUS.RUNNING:
    case AGENT_STATUS.COMPLETED:
      return undefined;
  }
}

/** What mends a failed turn from its end line: the API keys' page for a key refused; nothing else there is the developer's to mend. */
export function endLineReason(failure: AgentFailure | undefined, starter?: string): FailureReason {
  // A teammate's key is theirs to mend, so the reader is offered no Settings of their own.
  return failure === AGENT_FAILURE.PROVIDER_KEY && starter === undefined
    ? FAILURE_REASON.API_KEY
    : FAILURE_REASON.OTHER;
}

/** The statuses an agent may still write under, which is when it can be stopped. */
const FOLLOWED_STATUSES: ReadonlySet<AgentStatus> = new Set([
  AGENT_STATUS.STARTING,
  AGENT_STATUS.RUNNING,
]);

/** Whether an agent in this status may still write more. */
export function agentStillWriting(status: AgentStatus): boolean {
  return FOLLOWED_STATUSES.has(status);
}

/**
 * Whether the agent's tab offers Stop: it runs, and its service has not said
 * a Stop would stop nothing (`stoppable`), as after a Stop already taken, so
 * a press is never dropped unheard. A starting agent has no turn yet to stop.
 */
export function offersStop(agent: Pick<AgentSummary, "status" | "stoppable">): boolean {
  return agent.status === AGENT_STATUS.RUNNING && agent.stoppable !== false;
}

/**
 * Where an agent stands as its tab's glyph wears it: working while it may
 * still write, failed once its turn failed, and at rest once it finished
 * or the developer stopped it, since a stop is the developer's own doing.
 */
export function agentGlyphState(status: AgentStatus): GlyphState {
  if (agentStillWriting(status)) return GLYPH_STATE.WORKING;
  return status === AGENT_STATUS.FAILED ? GLYPH_STATE.FAILED : GLYPH_STATE.REST;
}

/** What an agent's tab says of where it stands beyond its glyph: a stop, which its glyph at rest does not tell from a finish. */
export function agentStateWords(status: AgentStatus): string | undefined {
  return glyphStateWords(agentGlyphState(status), status === AGENT_STATUS.CANCELED);
}

/** What a Start refused for want of a repository says. */
const START_NEEDS_REPOSITORY = "Choose a repository";

/** Why a Start cannot run where neither a task nor an agent is open, which no draft is drawn without. */
export const START_NEEDS_TASK = "Open a task to start an agent";

/** What a call refused for a repository out of the workspace's reach says, wherever it is refused. */
export const REPOSITORY_UNREACHED_NOTE = `${PRODUCT_NAME} cannot reach this task's repository on GitHub.`;

/** What a message no answer came back for says, which may have reached the agent all the same. */
const NOT_HEARD_BACK = "No answer came back.";

/** What a message no answer came back for says while the app does not reach the service, in place of `NOT_HEARD_BACK`: in the composer, whose Retry stands again once the app does (`RetryOffered`), and alone where only the words are drawn, as an Inbox answer's are. */
export const UNHEARD_OFFLINE = {
  BESIDE_RETRY: "You're offline.",
  ALONE: "You're offline. Try again once you're back online.",
} as const;

/** What a plan's reached limit says where no reset is known; with one, `limitResetsWords`. */
const LIMIT_REACHED_WORDS = "Usage limit reached";

/** What the refusals a Start and a message meet alike say, worded once. */
const SHARED_FAILURE_NOTE = {
  [AGENT_CALL_FAILURE.REPOSITORY_NOT_REACHABLE]: REPOSITORY_UNREACHED_NOTE,
  [AGENT_CALL_FAILURE.GITHUB_UNANSWERED]: "GitHub didn't answer.",
  [AGENT_CALL_FAILURE.MESSAGE_TOO_LONG]: "That message is too long.",
  [AGENT_CALL_FAILURE.AGENT_NOT_READY]: "The agent is still starting. Try again in a moment.",
  [AGENT_CALL_FAILURE.NOT_PERMITTED]: "Only the member who started this agent can do this.",
  [AGENT_CALL_FAILURE.NATIVE_AGENT_NOT_HERE]: "This agent cannot be reached from here yet.",
  [AGENT_CALL_FAILURE.AGENT_PLAN_SIGNED_OUT]:
    "The plan paying for this agent is signed out. Its starter signs in again in Settings.",
  [AGENT_CALL_FAILURE.AGENT_PLAN_UNREACHABLE]:
    "The plan's provider didn't answer. Try again in a moment.",
  [AGENT_CALL_FAILURE.AGENT_PLAN_LIMIT_REACHED]: LIMIT_REACHED_WORDS,
  [AGENT_CALL_FAILURE.AGENT_PLAN_INELIGIBLE]:
    "The plan paying for this agent isn't eligible to run it.",
} as const;

/** What a Start from an agent whose session has ended says. */
const START_RETIRED = "This agent has ended. Start a new one.";

/** What a message to an agent whose session has ended says where only the words are drawn, as an Inbox answer's are. */
const MESSAGE_RETIRED = "This agent has ended. Continue in a new one.";

/** What a message to an agent whose host its starter removed says, and a Start that would run there, wherever it is drawn: only a new agent in the cloud or the host added again goes on from here. */
const HOST_REMOVED = "This host was removed. Start a new agent in the cloud or add it again.";

/** What a message that did not reach the agent says of itself, which a surface without Retry follows with Try again. */
const MESSAGE_NOT_SENT = "The message could not be sent.";

/** What the agent's own box says once a message closed it on an ended agent, beside the press that continues it in a new one (`ContinueAgent`), which says the rest. */
const BOX_RETIRED = "This agent has ended.";

/** What the press that starts a new agent on another's whole transcript says. */
export const CONTINUE_LABEL = "Continue in new agent";

/** What that press says once another agent continued the agent, in the same place on the failed end line. */
export const CONTINUE_AGAIN_LABEL = "Continue again";

/** What the line naming the agents that continued another says before their chips. */
export const CONTINUED_IN = "Continued in";

/**
 * The agents of the task that continue `agentId`: each started from it on
 * its whole transcript, naming no message, archived ones among them, in the
 * order started. Note that a fork names the message it was cut at, so it
 * continues nothing.
 */
function continuationsOf(
  agentId: string,
  agents: readonly AgentSummary[] | undefined,
  archived: readonly AgentSummary[] | undefined,
): readonly AgentSummary[] {
  return [...(agents ?? []), ...(archived ?? [])]
    .filter((each) => each.from?.agentId === agentId && each.from.messageId === undefined)
    .sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * The ids of the agents that continue `agent`, oldest first: those the
 * service names on its summary (`continuedBy`), so a page that lists the
 * agent alone still names them, then any the task's agents name that the
 * summary does not yet (`continuationsOf`), as one just started. Note that
 * a service older than `continuedBy` leaves the key out, which reads the
 * list alone, and that a fork is never a continuation.
 */
export function continuedByIds(
  agent: AgentSummary,
  agents: readonly AgentSummary[] | undefined,
  archived: readonly AgentSummary[] | undefined,
): readonly string[] {
  const named = (agent.continuedBy ?? [])
    .filter((each) => !each.forked && each.messageId === undefined)
    .map((each) => each.agentId);
  const listed = continuationsOf(agent.id, agents, archived).map((each) => each.id);
  return [...new Set([...named, ...listed])];
}

/** The titles the summary gives the agents that continue it, by id, for a page whose list does not hold them; none for one with no title yet. */
export function continuedByTitles(agent: AgentSummary): ReadonlyMap<string, string> {
  const titled = (agent.continuedBy ?? []).flatMap((each) =>
    each.title === null ? [] : [[each.agentId, each.title] as const],
  );
  return new Map(titled);
}

/** Whether a turn's end line is where an agent may be continued: it failed, and not on a refused API key, which a new agent would meet the same. */
function endLineContinues(status: AgentStatus, endReason: FailureReason): boolean {
  return status === AGENT_STATUS.FAILED && endReason !== FAILURE_REASON.API_KEY;
}

/**
 * Whether the end line's row ends on Continue, after its words: where the
 * line continues the agent (`endLineContinues`), as Continue in new agent,
 * and once another agent continued it as Continue again, in the same place,
 * since the continued note that takes the box offers none. Before then, it
 * offers the press only where a new agent is the one way on: a failure only
 * one mends (`mendedByNewAgent`). Every other failure leaves the box open
 * and the agent taking messages, so a message carries it on, as a coding
 * CLI's error leaves its session for the next prompt. A box closed on an
 * ended agent offers the press itself, carrying its words, so the line
 * offers none and one Continue stands on screen.
 */
export function endLineOffersContinue(input: {
  readonly status: AgentStatus;
  readonly endReason: FailureReason;
  readonly failure: AgentFailure | undefined;
  readonly continued: boolean;
  readonly boxClosed: boolean;
}): boolean {
  if (!endLineContinues(input.status, input.endReason)) return false;
  if (input.continued) return true;
  return !input.boxClosed && mendedByNewAgent(input.failure);
}

/**
 * Whether the developer starts agents of their own on a task worked in this
 * mode: New agent, the draft a task with no tab opens, and a Fork. A pilot
 * task offers none, because its pilot starts every agent on it; a task read
 * from a service before modes is worked by its agents.
 */
export function startsOwnAgents(mode: TaskMode | undefined): boolean {
  return mode !== TASK_MODE.PILOT;
}

/**
 * Whether an agent offers Continue in new agent on a task worked in this
 * mode: every agent, but on a pilot task its pilot alone, whose Continue
 * takes over the agents it started rather than adding one of the developer's.
 */
export function offersContinue(
  mode: TaskMode | undefined,
  agent: { readonly pilot?: true | undefined },
): boolean {
  return startsOwnAgents(mode) || agent.pilot === true;
}

/** Said under an agent's box when the model or effort its chip chose could not be changed. */
const MODEL_CHANGE_FAILED = "The model could not be changed. Try again.";

/** What a change of an agent's model that did not take says under its box. */
export function chooseFailureNote(failure: AgentCallFailure): string {
  switch (failure) {
    case AGENT_CALL_FAILURE.NOT_FOUND:
      return "This agent no longer exists.";
    case AGENT_CALL_FAILURE.INVALID_CHOICE:
      return "That model isn't offered any more. Choose another.";
    case AGENT_CALL_FAILURE.UNANSWERED:
    case AGENT_CALL_FAILURE.OPENAI_KEY_MISSING:
    case AGENT_CALL_FAILURE.NO_REPOSITORY:
    case AGENT_CALL_FAILURE.REPOSITORY_NOT_REACHABLE:
    case AGENT_CALL_FAILURE.GITHUB_UNANSWERED:
    case AGENT_CALL_FAILURE.MESSAGE_TOO_LONG:
    case AGENT_CALL_FAILURE.AGENT_NOT_READY:
    case AGENT_CALL_FAILURE.AGENT_RETIRED:
    case AGENT_CALL_FAILURE.DEVICE_REMOVED:
    case AGENT_CALL_FAILURE.NOT_PERMITTED:
    case AGENT_CALL_FAILURE.NATIVE_AGENT_NOT_HERE:
    case AGENT_CALL_FAILURE.AGENT_PLAN_SIGNED_OUT:
    case AGENT_CALL_FAILURE.AGENT_PLAN_UNREACHABLE:
    case AGENT_CALL_FAILURE.AGENT_PLAN_LIMIT_REACHED:
    case AGENT_CALL_FAILURE.AGENT_PLAN_INELIGIBLE:
    case AGENT_CALL_FAILURE.AGENT_CREDENTIAL_MISSING:
    case AGENT_CALL_FAILURE.AGENT_API_KEY_UNREADABLE:
    case AGENT_CALL_FAILURE.LOCAL_AGENT_REFUSED:
    case AGENT_CALL_FAILURE.EXTRA_REPOSITORY_REFUSED:
      return MODEL_CHANGE_FAILED;
  }
}

/** What the toast says when a Start the developer left the task behind did not start; the task's own note says why. */
export const START_FAILED_AWAY = "The agent could not be started.";

/** What the toast says when the service did not stop an agent. */
export const STOP_FAILED = "The agent could not be stopped. Try again.";

/** What the toast says when the service did not rename an agent, whose old name is drawn again. */
export const RENAME_FAILED = "The agent could not be renamed. Try again.";

/** What the toast says when the service did not switch an agent's MCP servers, whose switches fall back. */
export const SERVERS_FAILED = "The agent's integrations could not be changed. Try again.";

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

/** What an agent's delete says refused; one that landed says nothing, since the agent leaving its list says it. */
export const DELETE_WORDS = {
  refused: "The agent could not be deleted. Try again.",
} as const;

/** What the toast says once an agent's archive, or its undoing, landed or was refused, by which way it was asked. */
export function archiveWords(archived: boolean): {
  readonly done: string;
  readonly refused: string;
} {
  return archived ? ARCHIVED_WORDS : UNARCHIVED_WORDS;
}

/** A refused start or message as the view hears it: why, why the repository is out of reach where it is and the service said, when a plan's reached limit resets where it is that and the provider said, and the provider whose credential is missing where it is that. */
export interface RefusedCall {
  readonly failure: AgentCallFailure;
  readonly unreached?: RepositoryUnreached | undefined;
  readonly resetsAt?: number | undefined;
  readonly provider?: ModelProvider | undefined;
  readonly localAgentRefusal?: LocalAgentRefusal | undefined;
  readonly refusedDevice?: RefusedDevice | undefined;
  readonly extraRepositoryRefusal?: ExtraRepositoryRefusal | undefined;
  readonly refusedRepository?: string | undefined;
}

/** The device a Start would run its agent on, as a refusal names it: its name, its platform where the service said, and its owner where it is another member's and the service said. */
export interface RefusingDevice {
  readonly name: string;
  readonly platform?: DevicePlatform | undefined;
  readonly owner?: string | undefined;
}

/** What a device refusing a Start is called where its name is not known. */
const UNNAMED_DEVICE = "Your device";

/** The way out every device refusal ends on, since the cloud takes any agent: the same start with Runs on on Cloud. */
const RUN_IN_CLOUD = "or start it in the cloud";

/** How a device that went quiet is brought back, by its platform: a Mac woken and logged in on, since its host runs in its user's login session, or a Linux server's own `vespin-host` checked. */
const DEVICE_WAKE = {
  [DEVICE_PLATFORM.DARWIN]: "Wake it and log in on it",
  [DEVICE_PLATFORM.LINUX]: "Check that it's on, connected, and running vespin-host",
} as const satisfies Record<DevicePlatform, string>;

/** How a device whose setup failed tries it again, by its platform: Bring your own host turned off and on in Settings › Hosts on a Mac, whose desktop app keeps its host running, or a Linux server's own `vespin-host` restarted. */
const SETUP_RETRY = {
  [DEVICE_PLATFORM.DARWIN]:
    "Open Settings › Hosts on that Mac and turn Bring your own host off and on",
  [DEVICE_PLATFORM.LINUX]: "Run systemctl --user restart vespin-host on that host",
} as const satisfies Record<DevicePlatform, string>;

/**
 * Why the device a Start would run its agent on would not take it, as New
 * task and an agent's Start alike say it, naming the device where the
 * panel knows it and ending on the way out, the cloud. A refusal the
 * service named no reason for says the device would not take it.
 */
export function localAgentRefusalWords(
  refusal: LocalAgentRefusal | undefined,
  device: RefusingDevice | undefined,
): string {
  const name = device?.name ?? UNNAMED_DEVICE;
  switch (refusal) {
    case LOCAL_AGENT_REFUSAL.MAC_AWAY:
      return `${name} is offline, so this agent can't start there. ${DEVICE_WAKE[devicePlatformOf(device ?? {})]}, ${RUN_IN_CLOUD}.`;
    case LOCAL_AGENT_REFUSAL.CODEX:
      return `${name} can't run Codex agents yet. Wait for its Codex download to finish, choose a Claude model, ${RUN_IN_CLOUD}.`;
    case LOCAL_AGENT_REFUSAL.NO_HARNESS:
      return `${name} can't run this model's agents. Choose a Claude or Codex model, ${RUN_IN_CLOUD}.`;
    case LOCAL_AGENT_REFUSAL.PREPARING:
      return `${name} is still getting ready for local agents. Try again in a few minutes.`;
    case LOCAL_AGENT_REFUSAL.SETUP_FAILED:
      return `${name} couldn't set up local agents. ${SETUP_RETRY[devicePlatformOf(device ?? {})]} to try again, ${RUN_IN_CLOUD}.`;
    // Note that no way out is offered, because the cloud is the owner's to set and a teammate can change nothing here.
    case LOCAL_AGENT_REFUSAL.NOT_OWNER:
      return `This task runs on ${device?.name ?? "another member's device"}. Only ${device?.owner ?? "its owner"} can start agents on it.`;
    case LOCAL_AGENT_REFUSAL.GITHUB_SIGN_IN:
      return `${name} runs an older vespin-host, which can't work in a repository reached on your own GitHub token. Update its host, ${RUN_IN_CLOUD}.`;
    case undefined:
      return `${name} couldn't take this agent. Try again, ${RUN_IN_CLOUD}.`;
  }
}

/** Why a repository beside an agent's own is refused, as New task and Add repository… both say it. */
const EXTRA_REPOSITORY_WHY = {
  token: (named: string) =>
    `${named} is reached on your own GitHub token. An agent's repositories must all be reached through the GitHub App.`,
  otherInstallation: (named: string) =>
    `${named} is on another GitHub account than the agent's repository. An agent's repositories must share one.`,
} as const;

/** What Add repository… says where the service answered no reason it names. */
const NOT_ADDED = "The repository couldn't be added. Try again.";

/**
 * Why a repository added to a running agent was refused, as Add
 * repository… says it under its chooser, naming the repository where the
 * service named one; a refusal it named no reason for says it was not
 * added. The words a Start's extras are refused with stand for what both
 * are refused for (`EXTRA_REPOSITORY_WHY`).
 */
export function addRepositoryFailureWords(refused: RefusedCall): string {
  const named = refused.refusedRepository ?? "That repository";
  if (refused.failure === AGENT_CALL_FAILURE.NOT_PERMITTED) {
    return "Only the member who started this agent can add a repository to it.";
  }
  if (refused.failure === AGENT_CALL_FAILURE.REPOSITORY_NOT_REACHABLE) {
    return "The workspace's GitHub App doesn't reach that repository.";
  }
  if (refused.failure !== AGENT_CALL_FAILURE.EXTRA_REPOSITORY_REFUSED) return NOT_ADDED;
  switch (refused.extraRepositoryRefusal) {
    case EXTRA_REPOSITORY_REFUSAL.NO_REPOSITORY:
      return "This agent works in no repository of its own. Start an agent in that repository instead.";
    case EXTRA_REPOSITORY_REFUSAL.DEVICE:
      return "Only an agent in the cloud works in several repositories.";
    case EXTRA_REPOSITORY_REFUSAL.TOKEN:
      return EXTRA_REPOSITORY_WHY.token(named);
    case EXTRA_REPOSITORY_REFUSAL.OTHER_INSTALLATION:
      return EXTRA_REPOSITORY_WHY.otherInstallation(named);
    case EXTRA_REPOSITORY_REFUSAL.ALREADY:
      return `${named} is already among this agent's repositories.`;
    case EXTRA_REPOSITORY_REFUSAL.FULL:
      return "This agent already works in as many repositories as it can.";
    case EXTRA_REPOSITORY_REFUSAL.HEARD_ANOTHER_ACCOUNT:
    case undefined:
      return NOT_ADDED;
  }
}

/**
 * Why the repositories a Start named beside its agent's own were refused, as
 * New task says it, naming the repository where the service named one. A
 * refusal the service named no reason for says they could not be used.
 */
function extraRepositoryRefusalWords(
  refusal: ExtraRepositoryRefusal | undefined,
  repository: string | undefined,
): string {
  const named = repository ?? "One of the other repositories";
  switch (refusal) {
    case EXTRA_REPOSITORY_REFUSAL.NO_REPOSITORY:
      return "Choose the agent's repository before adding others.";
    case EXTRA_REPOSITORY_REFUSAL.DEVICE:
      return "An agent in several repositories runs only in the cloud. Start it in the cloud, or remove the other repositories.";
    case EXTRA_REPOSITORY_REFUSAL.TOKEN:
      return EXTRA_REPOSITORY_WHY.token(named);
    case EXTRA_REPOSITORY_REFUSAL.OTHER_INSTALLATION:
      return EXTRA_REPOSITORY_WHY.otherInstallation(named);
    // Note that a Start is refused none of these, which only a repository added to a running agent is.
    case EXTRA_REPOSITORY_REFUSAL.ALREADY:
    case EXTRA_REPOSITORY_REFUSAL.FULL:
    case EXTRA_REPOSITORY_REFUSAL.HEARD_ANOTHER_ACCOUNT:
    case undefined:
      return "These repositories can't be used together. Remove the others to start the agent.";
  }
}

/** What a missing credential keeps the developer from: starting an agent, or messaging one. */
const ACTION = { START: "start an agent", MESSAGE: "message this agent" } as const;

/** A model nothing pays for, as a failure whose press connects its provider at its harness's row. */
export interface ConnectFailure {
  readonly reason: typeof FAILURE_REASON.CONNECT_AGENTS;
  readonly text: string;
  readonly provider: ModelProvider;
}

/** What would run a provider's models, as the connect note names it: the harness's plan or the provider's API key. */
const CONNECT_CREDENTIALS = {
  [MODEL_PROVIDER.ANTHROPIC]: "a Claude plan or an Anthropic API key",
  [MODEL_PROVIDER.OPENAI]: "a ChatGPT plan or an OpenAI API key",
} as const satisfies Record<ModelProvider, string>;

/**
 * The press a model menu's row holds for a model whose provider no
 * plan or API key of the account's pays for: "Connect Claude" at
 * the row's end (`remedyLabel`), landing on its harness's row in Settings ›
 * Agents (`useRepositoryRemedy`); none for a model something pays for.
 */
export function modelConnectFailure(model: CatalogModel): ConnectFailure | undefined {
  if (model.credentialMissing !== true) return undefined;
  return {
    reason: FAILURE_REASON.CONNECT_AGENTS,
    text: `${modelLabel(model.id, [model])} cannot run until you connect ${CONNECT_CREDENTIALS[model.provider]}.`,
    provider: model.provider,
  };
}

/** What a model's row says at its end where nothing pays for it: the press that connects its harness, which its pick is. */
export function modelConnectWords(model: CatalogModel): string | undefined {
  const connect = modelConnectFailure(model);
  return connect === undefined ? undefined : remedyLabel(connect);
}

/**
 * Why a choice cannot run, and the press that connects what would run it:
 * the note a model menu and Settings' Default model stand under the choice
 * where no plan or API key of the account's pays for its model, as
 * an account finds the Claude default it stored once its Claude credential
 * is gone; none for a choice something pays for, or one the catalog no
 * longer lists.
 */
export function unrunnableChoice(
  models: readonly CatalogModel[],
  choice: ModelChoice,
): ConnectFailure | undefined {
  const { base } = readModelChoice(models, choice.model);
  const model = models.find((each) => each.id === base);
  return model === undefined ? undefined : modelConnectFailure(model);
}

/** The one sentence a missing credential says: the harness to connect, by the provider the service named, and what it unblocks. */
function credentialMissingWords(
  provider: ModelProvider | undefined,
  action: (typeof ACTION)[keyof typeof ACTION],
): string {
  const harness = provider === undefined ? "Claude or Codex" : harnessNameOf(provider);
  return `Connect ${harness} in Settings to ${action}.`;
}

/** What a Start refused by the plan that would pay says, to its own member, beside the press that opens Settings. */
const START_PLAN_REFUSAL = {
  [AGENT_CALL_FAILURE.AGENT_PLAN_SIGNED_OUT]: "Your plan is signed out. Connect it again.",
  [AGENT_CALL_FAILURE.AGENT_PLAN_INELIGIBLE]:
    "Your plan isn't eligible to run this agent. Choose your API key.",
} as const;

/** The same refusals where no press beside them opens Settings, so the words name it. */
const START_PLAN_REFUSAL_ALONE = {
  [AGENT_CALL_FAILURE.AGENT_PLAN_SIGNED_OUT]:
    "Your plan is signed out. Connect it again in Settings to start an agent.",
  [AGENT_CALL_FAILURE.AGENT_PLAN_INELIGIBLE]:
    "Your plan isn't eligible to run this agent. Choose your API key in Settings to start one.",
} as const;

/** What an unreadable API key says beside the press that opens Settings. */
const KEY_UNREADABLE_NOTE = "Your saved API key can't be read. Save it again.";

/** What an unreadable API key says where no press beside it opens Settings: that saving it again there unblocks the action. */
function keyUnreadableWords(action: (typeof ACTION)[keyof typeof ACTION]): string {
  return `Your saved API key can't be read. Save it again in Settings to ${action}.`;
}

/**
 * The note of a refusal Settings › Agents mends, whose press opens it: a
 * missing credential, an API key saved but unreadable, and, on a Start,
 * whose caller is the plan's own member, a plan signed out or ineligible.
 * None else; Retry alone answers every other.
 */
function settingsFailure(
  refused: RefusedCall,
  action: (typeof ACTION)[keyof typeof ACTION],
): Failure | undefined {
  switch (refused.failure) {
    case AGENT_CALL_FAILURE.AGENT_CREDENTIAL_MISSING:
      return credentialMissingFailure(refused, action);
    case AGENT_CALL_FAILURE.AGENT_API_KEY_UNREADABLE:
      return { reason: FAILURE_REASON.CONNECT_AGENTS, text: KEY_UNREADABLE_NOTE };
    case AGENT_CALL_FAILURE.AGENT_PLAN_SIGNED_OUT:
    case AGENT_CALL_FAILURE.AGENT_PLAN_INELIGIBLE:
      return action === ACTION.START
        ? { reason: FAILURE_REASON.CONNECT_AGENTS, text: START_PLAN_REFUSAL[refused.failure] }
        : undefined;
    default:
      return undefined;
  }
}

/** A missing credential's note, whose press opens Settings › Agents at the harness's row. */
function credentialMissingFailure(
  refused: RefusedCall,
  action: (typeof ACTION)[keyof typeof ACTION],
): Failure {
  return {
    reason: FAILURE_REASON.CONNECT_AGENTS,
    text: credentialMissingWords(refused.provider, action),
    provider: refused.provider,
  };
}

/**
 * The plan that pays for an agent on a provider's own harness, which only
 * its plan runs (`agent-runtime-choice.ts`); none for an agent on eve,
 * which a key pays for.
 */
export function planPayerOf(runtime: AgentRuntime | undefined): AgentPayer | undefined {
  if (runtime === AGENT_RUNTIME.CLAUDE_CODE) return AGENT_PAYER.CLAUDE_SUBSCRIPTION;
  if (runtime === AGENT_RUNTIME.CODEX) return AGENT_PAYER.CHATGPT_SUBSCRIPTION;
  return undefined;
}

/** What a message refused by the Claude plan that pays for its agent says. */
const CLAUDE_PLAN_REFUSAL = {
  SIGNED_OUT: "Signed out of Claude. Connect your Claude plan again in Settings.",
} as const;

/** The plan's reached limit said with when it resets, in place of waiting for a reset no one named. */
function limitResetsWords(resetsAt: number): string {
  return `${LIMIT_REACHED_WORDS} · Resets ${dayAndTimeText(resetsAt)}`;
}

/**
 * The words of a refusal by the plan that pays for the agent, by its plan
 * where the words say which, and with when a reached limit resets where
 * the provider said; none for any other refusal. The agent waits on its
 * plan, never turning to another payer.
 */
function planRefusalWords(refused: RefusedCall, payer: AgentPayer | undefined): string | undefined {
  if (refused.failure === AGENT_CALL_FAILURE.AGENT_PLAN_LIMIT_REACHED) {
    return refused.resetsAt === undefined ? undefined : limitResetsWords(refused.resetsAt);
  }
  if (
    refused.failure === AGENT_CALL_FAILURE.AGENT_PLAN_SIGNED_OUT &&
    payer === AGENT_PAYER.CLAUDE_SUBSCRIPTION
  ) {
    return CLAUDE_PLAN_REFUSAL.SIGNED_OUT;
  }
  return undefined;
}

/** What a Start that did not start says beside the button, and what mends it, naming the task's device where it refused and the panel knows it. */
export function startFailureNote(
  refused: RefusedCall,
  taskId: string | null,
  device?: RefusingDevice,
): Failure {
  if (refused.failure === AGENT_CALL_FAILURE.REPOSITORY_NOT_REACHABLE) {
    return unreachedFailure(refused.unreached, taskId);
  }
  if (refused.failure === AGENT_CALL_FAILURE.LOCAL_AGENT_REFUSED) {
    return callFailure(
      localAgentRefusalWords(refused.localAgentRefusal, refused.refusedDevice ?? device),
    );
  }
  if (refused.failure === AGENT_CALL_FAILURE.EXTRA_REPOSITORY_REFUSED) {
    return callFailure(
      extraRepositoryRefusalWords(refused.extraRepositoryRefusal, refused.refusedRepository),
    );
  }
  return (
    settingsFailure(refused, ACTION.START) ??
    callFailure(planRefusalWords(refused, undefined) ?? startFailureWords(refused.failure))
  );
}

/**
 * What a Continue in new agent that did not start says beside its own press,
 * which offers no remedy, so a refusal Settings › Agents mends names Settings.
 */
export function continueFailureNote(refused: RefusedCall, taskId: string | null): Failure {
  const note = startFailureNote(refused, taskId);
  switch (refused.failure) {
    case AGENT_CALL_FAILURE.AGENT_API_KEY_UNREADABLE:
      return { ...note, text: keyUnreadableWords(ACTION.START) };
    case AGENT_CALL_FAILURE.AGENT_PLAN_SIGNED_OUT:
    case AGENT_CALL_FAILURE.AGENT_PLAN_INELIGIBLE:
      return { ...note, text: START_PLAN_REFUSAL_ALONE[refused.failure] };
    default:
      return note;
  }
}

/** A refused call's words, which trying again mends. */
function callFailure(text: string): Failure {
  return { reason: FAILURE_REASON.OTHER, text };
}

/**
 * A repository out of reach, said by why with the repository named, and
 * the press that mends it: GitHub connected, or connected again, in
 * Settings; the repository given to our GitHub App; another repository
 * chosen; the task moved to the workspace whose GitHub reaches it; or the
 * member's own token replaced in Settings › Profile, or authorized on
 * GitHub for the organization's SAML SSO. A service that said nothing more
 * says the bare sentence, which Retry answers, and so does an agent with no
 * task wherever the remedy is pressed on the task: only giving the
 * repository to our GitHub App, and a token's remedies, are not.
 */
function unreachedFailure(
  unreached: RepositoryUnreached | undefined,
  taskId: string | null,
): Failure {
  if (unreached?.reason === REPOSITORY_UNREACHED.NOT_SELECTED) {
    return {
      reason: FAILURE_REASON.ADD_REPOSITORY,
      text: `${PRODUCT_NAME}'s GitHub App doesn't have access to ${unreached.repository}.`,
      repository: unreached.repository,
      settingsUrl: unreached.settingsUrl,
    };
  }
  // A token's remedy is the member's own, in Settings or on GitHub, so it needs no task.
  if (unreached?.reason === REPOSITORY_UNREACHED.TOKEN_INVALID) {
    return { reason: FAILURE_REASON.GITHUB_TOKEN, text: "Your GitHub token was refused." };
  }
  if (unreached?.reason === REPOSITORY_UNREACHED.TOKEN_SSO) {
    const [organization = unreached.repository] = unreached.repository.split("/");
    return {
      reason: FAILURE_REASON.AUTHORIZE_TOKEN,
      text: `Your GitHub token isn't authorized for ${organization}'s SAML SSO.`,
      organization,
      authorizeUrl: unreached.authorizeUrl,
    };
  }
  // The member's token is theirs to replace in Settings, so each of its cases carries that remedy and needs no task. NO_TOKEN is a saved token the deployment cannot open; a member with none saved never reaches it.
  if (unreached?.reason === REPOSITORY_UNREACHED.NO_TOKEN) {
    return {
      reason: FAILURE_REASON.GITHUB_TOKEN,
      text: "Your saved GitHub token could not be opened.",
    };
  }
  if (unreached?.reason === REPOSITORY_UNREACHED.TOKEN_NO_ACCESS) {
    return {
      reason: FAILURE_REASON.GITHUB_TOKEN,
      text: `Your GitHub token cannot access ${unreached.repository}. Check the repository still exists under that name, or ask its owner to give your GitHub account access.`,
    };
  }
  if (unreached?.reason === REPOSITORY_UNREACHED.TOKEN_CANNOT_PUSH) {
    return {
      reason: FAILURE_REASON.GITHUB_TOKEN,
      text: `Your GitHub token cannot push to ${unreached.repository}. Ask its owner to give your GitHub account write access.`,
    };
  }
  if (unreached === undefined || taskId === null) {
    return callFailure(SHARED_FAILURE_NOTE[AGENT_CALL_FAILURE.REPOSITORY_NOT_REACHABLE]);
  }
  const { repository } = unreached;
  switch (unreached.reason) {
    case REPOSITORY_UNREACHED.NOT_CONNECTED:
      return {
        reason: FAILURE_REASON.CONNECT_GITHUB,
        text: `This workspace isn't connected to GitHub, so ${PRODUCT_NAME} cannot reach ${repository}.`,
        taskId: taskId,
      };
    case REPOSITORY_UNREACHED.CONNECTION_LAPSED:
      return {
        reason: FAILURE_REASON.RECONNECT_GITHUB,
        text: `This workspace's GitHub connection was removed or suspended, so ${PRODUCT_NAME} cannot reach ${repository}.`,
        taskId: taskId,
      };
    case REPOSITORY_UNREACHED.OTHER_OWNER:
      return {
        reason: FAILURE_REASON.CHOOSE_REPOSITORY,
        text:
          unreached.connectedTo === undefined
            ? `${repository} isn't under the GitHub account this workspace is connected to.`
            : `${repository} isn't under ${unreached.connectedTo}, the GitHub account this workspace is connected to.`,
        taskId: taskId,
      };
    case REPOSITORY_UNREACHED.GONE:
      return {
        reason: FAILURE_REASON.CHOOSE_REPOSITORY,
        text: `${repository} was renamed, transferred, or deleted on GitHub.`,
        taskId: taskId,
      };
    case REPOSITORY_UNREACHED.OTHER_WORKSPACE:
      return {
        reason: FAILURE_REASON.MOVE_TASK,
        text: `${repository} is connected to ${unreached.workspace.name}, not this workspace.`,
        taskId: taskId,
        workspace: unreached.workspace,
      };
  }
}

/** What a Start that did not start says, by why. */
function startFailureWords(failure: AgentCallFailure): string {
  switch (failure) {
    case AGENT_CALL_FAILURE.NO_REPOSITORY:
      return START_NEEDS_REPOSITORY;
    case AGENT_CALL_FAILURE.INVALID_CHOICE:
      return "That model isn't offered any more. Choose another.";
    case AGENT_CALL_FAILURE.NOT_FOUND:
      return "This task no longer exists.";
    // Note that only a dictated clip is refused for want of an OpenAI key, so a Start never hears it.
    case AGENT_CALL_FAILURE.UNANSWERED:
    case AGENT_CALL_FAILURE.OPENAI_KEY_MISSING:
      return "The agent could not be started.";
    case AGENT_CALL_FAILURE.AGENT_RETIRED:
      return START_RETIRED;
    case AGENT_CALL_FAILURE.DEVICE_REMOVED:
      return HOST_REMOVED;
    case AGENT_CALL_FAILURE.REPOSITORY_NOT_REACHABLE:
    case AGENT_CALL_FAILURE.GITHUB_UNANSWERED:
    case AGENT_CALL_FAILURE.MESSAGE_TOO_LONG:
    case AGENT_CALL_FAILURE.AGENT_NOT_READY:
    case AGENT_CALL_FAILURE.NOT_PERMITTED:
    case AGENT_CALL_FAILURE.NATIVE_AGENT_NOT_HERE:
    case AGENT_CALL_FAILURE.AGENT_PLAN_SIGNED_OUT:
    case AGENT_CALL_FAILURE.AGENT_PLAN_UNREACHABLE:
    case AGENT_CALL_FAILURE.AGENT_PLAN_LIMIT_REACHED:
    case AGENT_CALL_FAILURE.AGENT_PLAN_INELIGIBLE:
      return SHARED_FAILURE_NOTE[failure];
    case AGENT_CALL_FAILURE.AGENT_CREDENTIAL_MISSING:
      return credentialMissingWords(undefined, ACTION.START);
    case AGENT_CALL_FAILURE.AGENT_API_KEY_UNREADABLE:
      return keyUnreadableWords(ACTION.START);
    case AGENT_CALL_FAILURE.LOCAL_AGENT_REFUSED:
      return localAgentRefusalWords(undefined, undefined);
    case AGENT_CALL_FAILURE.EXTRA_REPOSITORY_REFUSED:
      return extraRepositoryRefusalWords(undefined, undefined);
  }
}

/** What a teammate's agent says to a message its starter's own key refused: theirs to save in their Settings, which the reader's mend nothing of. */
function starterKeyWords(failure: AgentCallFailure, starter: string): string | undefined {
  if (failure === AGENT_CALL_FAILURE.AGENT_API_KEY_UNREADABLE) {
    return `${starter}'s saved API key can't be read. They save it again in Settings to unblock this agent.`;
  }
  if (failure === AGENT_CALL_FAILURE.AGENT_CREDENTIAL_MISSING) {
    return `${starter} has no plan or API key connected for this agent. They connect one in Settings to unblock it.`;
  }
  return undefined;
}

/**
 * What a message that did not reach the agent says under the composer, and
 * what mends it, on a task or, for an agent with none, where the remedy needs
 * no task. A teammate's agent (`starter`, `teammateStarter`) runs on its
 * starter's credentials, so a refusal of theirs names them and offers the
 * reader no Settings of their own.
 */
export function messageFailureNote(
  refused: RefusedCall,
  taskId: string | null,
  payer?: AgentPayer | undefined,
  starter?: string | undefined,
): Failure {
  if (refused.failure === AGENT_CALL_FAILURE.REPOSITORY_NOT_REACHABLE) {
    return unreachedFailure(refused.unreached, taskId);
  }
  // Note that the box's note stands beside Continue in new agent, so it tells no one to continue.
  if (refused.failure === AGENT_CALL_FAILURE.AGENT_RETIRED) return callFailure(BOX_RETIRED);
  if (refused.failure === AGENT_CALL_FAILURE.DEVICE_REMOVED) return callFailure(HOST_REMOVED);
  // Note that a device away refuses a message in the words it refuses a Start in.
  if (refused.failure === AGENT_CALL_FAILURE.LOCAL_AGENT_REFUSED) {
    return callFailure(
      localAgentRefusalWords(
        refused.localAgentRefusal ?? LOCAL_AGENT_REFUSAL.MAC_AWAY,
        refused.refusedDevice,
      ),
    );
  }
  const theirs = starter === undefined ? undefined : starterKeyWords(refused.failure, starter);
  if (theirs !== undefined) return callFailure(theirs);
  return (
    settingsFailure(refused, ACTION.MESSAGE) ??
    callFailure(planRefusalWords(refused, payer) ?? messageNoteWords(refused.failure))
  );
}

/**
 * A composer's note as it reads while the app does not reach the service:
 * one for a message no answer came back for says the developer is offline,
 * its words still in the box, and its Retry stands again once the app
 * reaches the service; any other note, or any note while connected, as it is.
 */
export function noteWhileOffline<Note extends Failure & { readonly cause?: unknown }>(
  note: Note | undefined,
  connected: boolean,
): Note | undefined {
  if (connected || note === undefined) return note;
  const { cause } = note;
  const unheard =
    Predicate.hasProperty(cause, "failure") && cause.failure === AGENT_CALL_FAILURE.UNANSWERED;
  return unheard ? { ...note, text: UNHEARD_OFFLINE.BESIDE_RETRY } : note;
}

/** What a message that did not reach the agent says beside the composer's Retry, which says to try again for it. */
function messageNoteWords(failure: AgentCallFailure): string {
  switch (failure) {
    case AGENT_CALL_FAILURE.NO_REPOSITORY:
    case AGENT_CALL_FAILURE.INVALID_CHOICE:
    case AGENT_CALL_FAILURE.OPENAI_KEY_MISSING:
      return MESSAGE_NOT_SENT;
    case AGENT_CALL_FAILURE.GITHUB_UNANSWERED:
      return SHARED_FAILURE_NOTE[failure];
    case AGENT_CALL_FAILURE.UNANSWERED:
      return NOT_HEARD_BACK;
    default:
      return messageFailureWords(failure);
  }
}

/** What a message that did not reach the agent says, by why, where only the words are drawn, as an Inbox answer's are, so a refusal trying again mends says so. */
export function messageFailureWords(failure: AgentCallFailure): string {
  switch (failure) {
    case AGENT_CALL_FAILURE.NOT_FOUND:
      return "This agent no longer exists.";
    // A message names no repository, no model, and no clip, so none of these refusals is its own.
    case AGENT_CALL_FAILURE.NO_REPOSITORY:
    case AGENT_CALL_FAILURE.EXTRA_REPOSITORY_REFUSED:
    case AGENT_CALL_FAILURE.INVALID_CHOICE:
    case AGENT_CALL_FAILURE.OPENAI_KEY_MISSING:
      return `${MESSAGE_NOT_SENT} Try again.`;
    // A message is refused by a device only while it is away, in the words a Start on it is.
    case AGENT_CALL_FAILURE.LOCAL_AGENT_REFUSED:
      return localAgentRefusalWords(LOCAL_AGENT_REFUSAL.MAC_AWAY, undefined);
    // No answer is not a refusal: the words may have reached the agent, and Retry carries the same key, so they reach it once.
    case AGENT_CALL_FAILURE.UNANSWERED:
      return `${NOT_HEARD_BACK} Try again.`;
    case AGENT_CALL_FAILURE.AGENT_RETIRED:
      return MESSAGE_RETIRED;
    case AGENT_CALL_FAILURE.DEVICE_REMOVED:
      return HOST_REMOVED;
    case AGENT_CALL_FAILURE.GITHUB_UNANSWERED:
      return `${SHARED_FAILURE_NOTE[failure]} Try again.`;
    case AGENT_CALL_FAILURE.REPOSITORY_NOT_REACHABLE:
    case AGENT_CALL_FAILURE.MESSAGE_TOO_LONG:
    case AGENT_CALL_FAILURE.AGENT_NOT_READY:
    case AGENT_CALL_FAILURE.NOT_PERMITTED:
    case AGENT_CALL_FAILURE.NATIVE_AGENT_NOT_HERE:
    case AGENT_CALL_FAILURE.AGENT_PLAN_SIGNED_OUT:
    case AGENT_CALL_FAILURE.AGENT_PLAN_UNREACHABLE:
    case AGENT_CALL_FAILURE.AGENT_PLAN_LIMIT_REACHED:
    case AGENT_CALL_FAILURE.AGENT_PLAN_INELIGIBLE:
      return SHARED_FAILURE_NOTE[failure];
    case AGENT_CALL_FAILURE.AGENT_CREDENTIAL_MISSING:
      return credentialMissingWords(undefined, ACTION.MESSAGE);
    case AGENT_CALL_FAILURE.AGENT_API_KEY_UNREADABLE:
      return keyUnreadableWords(ACTION.MESSAGE);
  }
}

/** Whether a refusal is for good, so the composer closes on it rather than offering Retry: the agent's session has ended, or the host it ran on was removed. */
export function closesComposer(failure: AgentCallFailure): boolean {
  return (
    failure === AGENT_CALL_FAILURE.AGENT_RETIRED || failure === AGENT_CALL_FAILURE.DEVICE_REMOVED
  );
}

/**
 * Where the note in an agent's composer's place opens the pilot it reports
 * to: the pilot's tab, where it stands on the agent's own task, as a coding
 * agent's pilot does, else its tab on the pilot's task, as a sub-pilot's does. None for
 * an agent no pilot started, which keeps its composer: a member talks to the
 * top pilot of a pilot tree alone, and to any agent outside one.
 */
export function pilotTarget(
  agent: Pick<AgentSummary, "planId" | "startedByPilot">,
): ToolTarget | undefined {
  const pilot = agent.startedByPilot;
  if (pilot === undefined) return undefined;
  return pilot.taskId === agent.planId
    ? { kind: TOOL_TARGET.AGENT, agent: pilot.agentId }
    : { kind: TOOL_TARGET.TASK, task: pilot.taskId, agent: pilot.agentId };
}

/**
 * A model, and an agent, as a tab or a menu names it, shared with the main
 * process's notifications so neither is ever named two ways
 * (`@repo/features/model-label`).
 */
export { agentName, modelLabel };

/**
 * The provider whose harness runs a model, read from its catalog id, whose
 * prefix is the provider's word (`models-wire.ts`), so a tab wears its
 * harness's mark before the catalog itself is read; none for a provider
 * we run no agent on.
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

/**
 * Where a model's family stands in `LEAD_FAMILIES`: the last word of its
 * own name, its version and any speed's suffix aside, so `claude-opus-5.5` is
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

/** What the model menu and Settings say where the catalog could not be read. */
export const MODELS_READ_FAILED = readFailedWords("the models");

/** The word a choice label, the Fast row, and the Speed choice say for each speed. */
export const SPEED_WORD = {
  [MODEL_SPEED.STANDARD]: "Standard",
  [MODEL_SPEED.FAST]: "Fast",
  [MODEL_SPEED.ULTRAFAST]: "Ultrafast",
} as const satisfies Record<ModelSpeed, string>;

/** The word a choice label and the Fast row say for the fast version. */
export const FAST_WORD = SPEED_WORD[MODEL_SPEED.FAST];

/** The word the Speed choice is named by, which stands in the Fast row's place for a model with an Ultrafast version. */
export const SPEED_LABEL = "Speed";

/** What the Fast row says where the service withholds the model's fast version because Anthropic never granted the organization of the key the account's agents run on fast mode. */
const FAST_NOT_ENABLED_NOTE = "Fast isn't enabled for this key's Anthropic organization";

/** Where an organization asks Anthropic for fast mode, which it grants organization by organization. */
export const FAST_ACCESS_URL = "https://claude.com/fast-mode";

/** What separates the words of a choice: "Opus 5.5 High Fast", the model's name and then its detail. */
const CHOICE_WORD_SEPARATOR = " ";

/** A model as the menus offer it: the base model, and its fast and Ultrafast versions where the catalog lists each beside it. */
export interface OfferedModel {
  readonly model: CatalogModel;
  readonly fast: CatalogModel | undefined;
  readonly ultrafast: CatalogModel | undefined;
}

/** The id a fast or Ultrafast version's id is a version of, or nothing for an id without a speed's suffix. */
function baseIdOf(id: string): string | undefined {
  return modelSpeedOf(id) === MODEL_SPEED.STANDARD ? undefined : standardModelIdOf(id);
}

/**
 * The catalog folded to its base models, each with its fast and Ultrafast
 * versions, in the menus' order. The signal is the id: a model whose id is
 * another offered model's with a speed's suffix is that model's version at
 * that speed, and is not listed on its own. Neither the name's "(Fast)" nor
 * the catalog's `fast` tag would do: the tag sits on the base and the fast
 * version alike, the wire carries no tags in any case, and a name is
 * display text. A suffixed id with no base beside it is a model of its own.
 */
export function offeredModels(models: readonly CatalogModel[]): readonly OfferedModel[] {
  const ids = new Set(models.map((model) => model.id));
  const versionsOf = new Map<string, Map<ModelSpeed, CatalogModel>>();
  for (const model of models) {
    const base = baseIdOf(model.id);
    if (base === undefined || !ids.has(base)) continue;
    const versions = versionsOf.get(base) ?? new Map<ModelSpeed, CatalogModel>();
    versions.set(modelSpeedOf(model.id), model);
    versionsOf.set(base, versions);
  }
  return orderedModels(models)
    .filter((model) => !isSpeedVersion(model.id, ids))
    .map((model) => ({
      model,
      fast: versionsOf.get(model.id)?.get(MODEL_SPEED.FAST),
      ultrafast: versionsOf.get(model.id)?.get(MODEL_SPEED.ULTRAFAST),
    }));
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

/** Whether the id is the fast or Ultrafast version of a model the catalog offers. */
function isSpeedVersion(id: string, ids: ReadonlySet<string>): boolean {
  const base = baseIdOf(id);
  return base !== undefined && ids.has(base);
}

/** The model's version at the speed given, where the catalog lists one beside it: the base itself at standard speed. */
function versionAt(offered: OfferedModel, speed: ModelSpeed): CatalogModel | undefined {
  if (speed === MODEL_SPEED.FAST) return offered.fast;
  if (speed === MODEL_SPEED.ULTRAFAST) return offered.ultrafast;
  return offered.model;
}

/** The speeds a model offers, slowest first: standard, and fast and Ultrafast where the catalog lists each. */
export function speedsOf(offered: OfferedModel): readonly ModelSpeed[] {
  return Object.values(MODEL_SPEED).filter((speed) => versionAt(offered, speed) !== undefined);
}

/** A stored id as the menus draw it: the base model's id, and the speed it named. */
export interface ModelChoiceRead {
  readonly base: string;
  readonly speed: ModelSpeed;
}

export function readModelChoice(models: readonly CatalogModel[], modelId: string): ModelChoiceRead {
  const offered = offeredModels(models).find(
    (each) =>
      each.model.id === modelId || each.fast?.id === modelId || each.ultrafast?.id === modelId,
  );
  if (offered === undefined) return { base: modelId, speed: MODEL_SPEED.STANDARD };
  const speed = modelId === offered.model.id ? MODEL_SPEED.STANDARD : modelSpeedOf(modelId);
  return { base: offered.model.id, speed };
}

/** The catalog id a base and a speed name: the version at that speed where the model has one, else the base's, at standard speed. */
export function choiceModelId(offered: OfferedModel, speed: ModelSpeed): string {
  return (versionAt(offered, speed) ?? offered.model).id;
}

/**
 * What a choice says after its model's name: the effort, Fast or Ultrafast
 * where that version is on, and the standard window's size where it runs on that,
 * so the model's whole window, which every choice runs on unless it says,
 * says nothing.
 */
function choiceDetail(effort: string, speed: ModelSpeed, standardTokens?: number): string {
  const words = [effortLabel(effort)];
  if (speed !== MODEL_SPEED.STANDARD) words.push(SPEED_WORD[speed]);
  if (standardTokens !== undefined) words.push(windowLabel(standardTokens));
  return words.join(CHOICE_WORD_SEPARATOR);
}

/** The word the menu's pinned row and the settings row say for the context window. */
export const CONTEXT_WORD = "Context";

/** The steps a window's size is cut down to before it is said: a thousand below a million, a tenth of a million from it. */
const WINDOW_CUT = { THOUSAND: 1_000, TENTH_OF_A_MILLION: 100_000, MILLION: 1_000_000 } as const;

/** A window's size as a choice says it, cut to the thousand or the tenth of a million below, not rounded: 272K, 1M for 1,050,000. */
export function windowLabel(tokens: number): string {
  const step = tokens >= WINDOW_CUT.MILLION ? WINDOW_CUT.TENTH_OF_A_MILLION : WINDOW_CUT.THOUSAND;
  return formatCompact(Math.floor(tokens / step) * step);
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
  return parts.length === 0 ? `${past} more.` : `${past} ${andList(parts)}.`;
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
    detail: choiceDetail(choice.effort, read.speed, standard),
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

/** The catalog's effort names a sentence-case label does not spell by capitalizing. */
const EFFORT_LABEL: ReadonlyMap<string, string> = new Map([["xhigh", "Extra high"]]);

/** The catalog's effort names are lowercase words; a menu and a segment read them in sentence case. */
export function effortLabel(effort: string): string {
  return EFFORT_LABEL.get(effort) ?? `${effort.charAt(0).toUpperCase()}${effort.slice(1)}`;
}

/** Where a worker stands as a page of its transcript read it: its status, and when the run under way began where the service said. */
export type AgentRun = Pick<AgentSummary, "status" | "runStartedAt">;

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

/** A part its page carried cut (`cutParts`): its two ends and its whole size, and the message and index it is fetched whole by. */
export type AgentPartCut = Omit<PartCut, "field"> & { readonly messageId: string };

/** One part of a stored message as the tab draws it. */
export type AgentPart =
  | { readonly kind: typeof AGENT_PART.TEXT; readonly text: string }
  | {
      readonly kind: typeof AGENT_PART.REASONING;
      /** Empty on a thought its page carried cut, whose words `cut` holds the ends of. */
      readonly text: string;
      readonly cut?: AgentPartCut;
    }
  | {
      readonly kind: typeof AGENT_PART.TOOL;
      readonly tool: string;
      readonly callId: string;
      readonly state: ToolState;
      readonly input: WireValue | undefined;
      /** None while the call has not answered, and on a call whose answer its page carried cut, which `cut` holds the ends of. */
      readonly output: WireValue | undefined;
      /** The error's own text, on a call that ended in one. */
      readonly errorText: string | undefined;
      readonly cut?: AgentPartCut;
    }
  | { readonly kind: typeof AGENT_PART.STEP_START }
  | { readonly kind: typeof AGENT_PART.OTHER }
  | { readonly kind: typeof AGENT_PART.ARRIVED; readonly line: AgentTranscriptMessage };

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
export function agentPart(part: WireValue): AgentPart {
  if (!isRecord(part) || !isWireString(part.type)) return { kind: AGENT_PART.OTHER };
  if (part.type === AGENT_PART.TEXT || part.type === AGENT_PART.REASONING) {
    return isWireString(part.text)
      ? { kind: part.type, text: part.text }
      : { kind: AGENT_PART.OTHER };
  }
  if (part.type === AGENT_PART.STEP_START) return { kind: AGENT_PART.STEP_START };
  if (part.type.startsWith(TOOL_PART_TYPE_PREFIX)) {
    // A native harness's call is read as the eve call that draws it (`native-tool-calls.ts`).
    const call = drawnCall({
      tool: part.type.slice(TOOL_PART_TYPE_PREFIX.length),
      input: part.input,
      output: part.output,
    });
    return {
      kind: AGENT_PART.TOOL,
      ...call,
      callId: isWireString(part.toolCallId) ? part.toolCallId : "",
      state: toolState(part.state),
      errorText: isWireString(part.errorText) ? part.errorText : undefined,
    };
  }
  return { kind: AGENT_PART.OTHER };
}

/** A user row's metadata as the service stored it, or nothing where it holds none this build reads. */
const readUserMetadata = Schema.decodeUnknownOption(USER_MESSAGE_METADATA);

/**
 * What another coding agent's message, sent with `message_agent`, says of
 * its sender, where one wrote the line rather than the developer; nothing
 * for the developer's own words, typed or spoken, or a row this build
 * cannot read.
 */
export function agentMessageOf(message: AgentTranscriptMessage): AgentMessageMetadata | undefined {
  const read = userMetadataOf(message);
  return read?.channel === MESSAGE_CHANNEL.AGENT_MESSAGE ? read : undefined;
}

/**
 * Whether a line is one of the agent's own wakeups: the prompt a
 * `ScheduleWakeup` set, which the scheduled sweep hands back to the agent,
 * sent by the agent itself, once it comes due (`native-wakeup-sweep.ts`), so
 * its head says the agent woke up.
 */
export function isWakeupLine(message: AgentTranscriptMessage): boolean {
  return userMetadataOf(message)?.channel === MESSAGE_CHANNEL.APP;
}

/** A second, in the milliseconds a wakeup's wait is told in. */
const SECOND_MS = 1_000;

/** How long the last wakeup a turn set waited, in milliseconds, read off its `ScheduleWakeup` call; none where the turn set none. */
export function wakeupDelayOf(turn: AgentTranscriptMessage | undefined): number | undefined {
  if (turn === undefined) return undefined;
  const call = agentParts(turn).findLast(
    (part) => part.kind === AGENT_PART.TOOL && part.tool === CLAUDE_CODE_TOOL.SCHEDULE_WAKEUP,
  );
  const input = call?.kind === AGENT_PART.TOOL ? call.input : undefined;
  return isRecord(input) && isWireNumber(input.delaySeconds)
    ? input.delaySeconds * SECOND_MS
    : undefined;
}

/** What a member did on a thread that a line steered into the agent carries, and the item it is on; nothing for any other line. */
export function threadLineOf(message: AgentTranscriptMessage): ThreadLineMetadata | undefined {
  const read = userMetadataOf(message);
  return read?.channel === MESSAGE_CHANNEL.THREAD ? read : undefined;
}

/**
 * What a comment thread that reached the agent carries for a window to draw
 * it by, its member's words among them; nothing for any other line, or for
 * a comment line kept before it carried them, which draws as the words the
 * agent read.
 */
export function commentLineOf(message: AgentTranscriptMessage): CommentLineMetadata | undefined {
  const read = userMetadataOf(message);
  return read?.channel === MESSAGE_CHANNEL.COMMENT && read.words !== undefined ? read : undefined;
}

/** A comment line's words as a transcript draws them: what its thread is on, quoted, over the member's own words. */
export function commentLineWords(line: CommentLineMetadata): string {
  const words = line.words ?? "";
  if (line.quote === undefined || line.quote === "") return words;
  return messageText([
    { kind: MESSAGE_BLOCK.QUOTE, words: line.quote },
    { kind: MESSAGE_BLOCK.WORDS, lines: words.split("\n") },
  ]);
}

/** What a member's message to the Slack bot carries for a window to draw it by, their own words and the message's link; nothing for any other line. */
export function slackLineOf(message: AgentTranscriptMessage): SlackLineMetadata | undefined {
  const read = userMetadataOf(message);
  return read?.channel === MESSAGE_CHANNEL.SLACK ? read : undefined;
}

/** What GitHub said on the agent's pull request that a line steered into the agent carries; nothing for any other line. */
export function githubLineOf(message: AgentTranscriptMessage): GitHubLineMetadata | undefined {
  const read = userMetadataOf(message);
  return read?.channel === MESSAGE_CHANNEL.GITHUB ? read : undefined;
}

/** What a review's verdict reads as before its pull request, by GitHub's own state; any other reads as reviewed. */
const VERDICT_WORDS: ReadonlyMap<string, string> = new Map([
  ["approved", "approved"],
  ["changes_requested", "requested changes on"],
]);

/** What a review that is neither an approval nor a change request reads as. */
const REVIEWED = "reviewed";

/** What a comment on the pull request, not a review, reads as. */
const COMMENTED = "commented on";

/** What the merge queue taking the pull request out without merging it reads as, in GitHub's own word. */
const DEQUEUED = "dequeued";

/** How a check a GitHub line names ended, in words, as its row on the line's card says it. */
export const CONCLUSION_WORDS = {
  [GITHUB_CHECK_CONCLUSION.SUCCESS]: "Passed",
  [GITHUB_CHECK_CONCLUSION.FAILURE]: "Failed",
  [GITHUB_CHECK_CONCLUSION.NEUTRAL]: "Neutral",
  [GITHUB_CHECK_CONCLUSION.CANCELED]: "Canceled",
  [GITHUB_CHECK_CONCLUSION.SKIPPED]: "Skipped",
  [GITHUB_CHECK_CONCLUSION.TIMED_OUT]: "Timed out",
  [GITHUB_CHECK_CONCLUSION.ACTION_REQUIRED]: "Needs action",
  [GITHUB_CHECK_CONCLUSION.STALE]: "Stale",
  [GITHUB_CHECK_CONCLUSION.STARTUP_FAILURE]: "Failed to start",
} as const satisfies Record<GitHubCheckConclusion, string>;

/** What the service tells an agent when every check finished and one failed, which is how a line kept before it said `failing` says so. */
const SOME_FAILED_WORDS = /\bAt least one failed\b/u;

/** One check a GitHub line names. */
type GitHubLineCheck = NonNullable<GitHubLineMetadata["checks"]>[number];

/** A GitHub line's head: what GitHub did, then what it did it to, which links the line's page. */
export interface GitHubLineHead {
  /** What happened, whole, as a copy reads it: "@octocat approved", "2 of 3 checks failed on". */
  readonly event: string;
  /** What its sender did, as the card says it after their chip: "approved", "2 of 3 checks failed on". */
  readonly does: string;
  readonly target: string;
}

/** Whether a check line says a check failed: a failed check always does, every check finished by its `failing`, or, on a line kept before it said so, by the words that told the agent. */
export function githubChecksFailed(line: GitHubLineMetadata, words: string): boolean {
  if (line.event === GITHUB_LINE_EVENT.CHECK_FAILED) return true;
  return line.failing ?? SOME_FAILED_WORDS.test(words);
}

/** The checks a check line names, those that failed first, each kind in the order the line lists them; none on a line that names none. */
export function githubLineChecks(line: GitHubLineMetadata): readonly GitHubLineCheck[] {
  const checks = line.checks ?? [];
  return [
    ...checks.filter((check) => isFailingConclusion(check.conclusion)),
    ...checks.filter((check) => !isFailingConclusion(check.conclusion)),
  ];
}

/** Whether every check a check line names passed: none failed, and each it names succeeded rather than was skipped, neutral, or stale. */
export function githubChecksPassed(line: GitHubLineMetadata, words: string): boolean {
  if (githubChecksFailed(line, words)) return false;
  return (line.checks ?? []).every((check) => check.conclusion === GITHUB_CHECK_CONCLUSION.SUCCESS);
}

/** How many checks, as a head counts them: one, or all of them. */
function allChecks(count: number): string {
  return count === 1 ? "1 check" : `all ${count} checks`;
}

/**
 * What a check line's sender did, by how many of its checks failed where it
 * names them, else by whether any did; with none failed, by how many passed
 * and how many were skipped, neutral and stale among them, as the Pull
 * request tab counts them, since a check skipped did not pass.
 */
function checksDid(line: GitHubLineMetadata, words: string): string {
  const checks = line.checks ?? [];
  const failed = checks.filter((check) => isFailingConclusion(check.conclusion)).length;
  const noun = checks.length === 1 ? "check" : "checks";
  if (failed > 0) return `${failed} of ${checks.length} ${noun} failed on`;
  if (line.event === GITHUB_LINE_EVENT.CHECK_FAILED) return "a check failed on";
  if (githubChecksFailed(line, words)) return "some checks failed on";
  if (checks.length === 0) return "every check passed on";
  const passed = checks.filter(
    (check) => check.conclusion === GITHUB_CHECK_CONCLUSION.SUCCESS,
  ).length;
  const skipped = checks.length - passed;
  if (skipped === 0) return `${allChecks(passed)} passed on`;
  return passed === 0
    ? `${allChecks(skipped)} skipped on`
    : `${passed} passed, ${skipped} skipped on`;
}

/**
 * A GitHub line's head, as its card draws it and a copy or a find reads
 * it: who reviewed by their verdict, commented, or took the pull request
 * out of the merge queue; or, for a check event, how many of the checks it
 * names failed, or whether any did; then the
 * pull request by its number, else its checks. The card names a reviewer
 * by their chip, so it reads what they did alone (`does`); a copy reads
 * them by their login (`event`), and a check event as its words alone.
 */
export function githubLineHead(line: GitHubLineMetadata, words: string): GitHubLineHead {
  const target = line.number === undefined ? "its checks" : `#${line.number}`;
  switch (line.event) {
    case GITHUB_LINE_EVENT.REVIEW: {
      const does = VERDICT_WORDS.get(line.verdict ?? "") ?? REVIEWED;
      return { event: `@${line.by} ${does}`, does, target };
    }
    case GITHUB_LINE_EVENT.COMMENT:
      return { event: `@${line.by} ${COMMENTED}`, does: COMMENTED, target };
    case GITHUB_LINE_EVENT.CHECK_FAILED:
    case GITHUB_LINE_EVENT.CHECKS_COMPLETED: {
      const does = checksDid(line, words);
      return { event: `${does.charAt(0).toUpperCase()}${does.slice(1)}`, does, target };
    }
    case GITHUB_LINE_EVENT.DEQUEUED:
      return { event: `@${line.by} ${DEQUEUED}`, does: DEQUEUED, target };
  }
}

/**
 * A GitHub line as words, as its card draws them, which a copy reads and a
 * find counts: its head, the words, each inline comment by its file and
 * line over what it says, then each check it names by how it ended, where
 * the card holds them, every check passing being its head alone.
 */
export function githubLineWords(line: GitHubLineMetadata, words: string): string {
  const head = githubLineHead(line, words);
  const comments = (line.comments ?? []).map((comment) => {
    const where = comment.line === undefined ? comment.path : `${comment.path} L${comment.line}`;
    return comment.body === "" ? where : `${where}\n\n${comment.body}`;
  });
  const checks = githubChecksPassed(line, words)
    ? ""
    : githubLineChecks(line)
        .map((check) => `${check.name}: ${CONCLUSION_WORDS[check.conclusion]}`)
        .join("\n");
  return [`${head.event} ${head.target}`, line.words ?? "", ...comments, checks]
    .filter((part) => part !== "")
    .join("\n\n");
}

/** A user row's metadata where it names the channel that carried it; nothing for an assistant's row, an observation, or a row this build cannot read. */
function userMetadataOf(
  message: AgentTranscriptMessage,
): Extract<UserMessageMetadata, { readonly channel: unknown }> | undefined {
  if (message.role !== MESSAGE_ROLE.USER || message.metadata === undefined) return undefined;
  const read = Option.getOrUndefined(readUserMetadata(message.metadata));
  return read === undefined || !("channel" in read) ? undefined : read;
}

/**
 * A part its page carried cut, as the tab draws it: a thought with no words
 * of its own, or a call with no answer of its own, each with the ends it was
 * cut to; a part that is neither draws as it reads.
 */
function cutAgentPart(part: WireValue, cut: PartCut, messageId: string): AgentPart {
  const { field: _field, ...ends } = cut;
  const marked = { ...ends, messageId };
  if (cut.field === PART_CUT_FIELD.TEXT) {
    return { kind: AGENT_PART.REASONING, text: "", cut: marked };
  }
  const read = agentPart(part);
  return read.kind === AGENT_PART.TOOL ? { ...read, cut: marked } : read;
}

/** The parts of a message as the tab draws them, in the row's order, each its page carried cut marked so. */
export function agentParts(message: AgentTranscriptMessage): readonly AgentPart[] {
  const read = partsRead.get(message);
  if (read !== undefined) return read;
  const cuts = new Map((message.cutParts ?? []).map((cut) => [cut.index, cut]));
  const parts = message.parts.map((part, index) => {
    const cut = cuts.get(index);
    return cut === undefined ? storedPartRead(part) : cutAgentPart(part, cut, message.id);
  });
  partsRead.set(message, parts);
  return parts;
}

/**
 * Each stored part as read, by the part: a page that rewrites a message
 * keeps every part it did not touch (`keepIdentity`), so a running turn's
 * thousand parts are read once and each read stays the same value, which
 * lets the rows drawn from them stand as they were drawn.
 */
const partRead = new WeakMap<object, AgentPart>();

/** A stored part read for drawing, once per part. */
function storedPartRead(part: WireValue): AgentPart {
  if (typeof part !== "object" || part === null) return agentPart(part);
  const read = partRead.get(part);
  if (read !== undefined) return read;
  const fresh = agentPart(part);
  partRead.set(part, fresh);
  return fresh;
}

/**
 * Each message's parts as last read, by the message: a message is never
 * changed in place (a page that rewrites one hands a new one), and a
 * running agent's transcript reads every message's parts on every page.
 */
const partsRead = new WeakMap<AgentTranscriptMessage, readonly AgentPart[]>();

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

/**
 * Whether a call is a delegation to a worker, a coding agent's, the brain's,
 * or a native harness's subagent (`native-tool-calls.ts` draws Codex's spawn
 * as Claude Code's `Agent`), which the tab draws as a subagent's row rather
 * than a call's.
 */
export function delegates(part: Extract<AgentPart, { kind: typeof AGENT_PART.TOOL }>): boolean {
  return part.tool === AGENT_DELEGATE_TOOL || part.tool === EVE_TOOL.WORKER || nativeSubagent(part);
}

/**
 * Whether a delegation is a native harness's subagent, whose own work we
 * keep no transcript of yet, so its row opens no worker's tab.
 */
export function nativeSubagent(
  part: Extract<AgentPart, { kind: typeof AGENT_PART.TOOL }>,
): boolean {
  return part.tool === CLAUDE_CODE_TOOL.AGENT;
}

/** Whether a part is a delegation to a worker (`delegates`). */
export function isDelegation(
  part: AgentPart,
): part is Extract<AgentPart, { kind: typeof AGENT_PART.TOOL }> {
  return part.kind === AGENT_PART.TOOL && delegates(part);
}

/** Claude Code's calls on its task list, each of which the tab draws as the list as it stood after it (`agent-todos.ts`). */
const TASK_CALL_TOOLS: ReadonlySet<string> = new Set([
  CLAUDE_CODE_TOOL.TASK_CREATE,
  CLAUDE_CODE_TOOL.TASK_UPDATE,
  CLAUDE_CODE_TOOL.TASK_LIST,
  CLAUDE_CODE_TOOL.TASK_GET,
]);

/** Whether a tool is one of Claude Code's calls on its task list. */
export function isTaskCall(tool: string): boolean {
  return TASK_CALL_TOOLS.has(tool);
}

/** Whether a tool part carries the agent's to-do list, which the tab draws as the list on a row of its own: a write of the whole list, or a call on Claude Code's task list. */
export function isTodos(
  part: AgentPart,
): part is Extract<AgentPart, { kind: typeof AGENT_PART.TOOL }> {
  return (
    part.kind === AGENT_PART.TOOL && (part.tool === AGENT_TOOL.WRITE_TODOS || isTaskCall(part.tool))
  );
}

/** How the fold reads a part: its words, its reasoning as a note, a delegation as a subagent, a to-do list and a set of pictures, a page, or a recording shown each on a row of its own, a start that began a coding agent counted apart, and every other call grouped with the calls beside it. */
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
    if (startedAgentOf(part) !== undefined) return ROW_PART.AGENT;
    // Note that what the agent showed is never grouped, because a group folds closed once the agent moves on and would fold the pictures with it.
    return isTodos(part) || isShownSet(part) || isShownPage(part) || keptRecording(part)
      ? ROW_PART.LONE_CALL
      : ROW_PART.CALL;
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
  /** The developer's lines that reached the turn while it ran (`arrivedIn`), each drawn among its parts after the steps it arrived after. */
  readonly arrived?: readonly AgentTranscriptMessage[];
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
 * Whether a part is a `show_page` call, whose page is drawn under its row
 * and, as a set of pictures is, never folds away. Note that the call stands
 * on a row of its own from the moment it starts, not only once it showed
 * its page, so a row opened while it runs stays open as the page lands.
 */
function isShownPage(part: AgentPart): boolean {
  return part.kind === AGENT_PART.TOOL && part.tool === AGENT_TOOL.SHOW_PAGE;
}

/** Whether a part is a browser call that kept a recording, which a reader watches as a shown set and never folds away. */
function keptRecording(part: AgentPart): boolean {
  return part.kind === AGENT_PART.TOOL && recordedVideosOf(part.tool, part.output).length > 0;
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
  message: AgentTranscriptMessage,
  arrived: readonly AgentTranscriptMessage[] = [],
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
function afterStepOf(line: AgentTranscriptMessage): number {
  return line.arrivedIn?.afterStep ?? 0;
}

/**
 * One of the agent's turns as the rows every transcript draws, folded as
 * `turn-rows.ts` folds a turn. A step boundary and a part
 * this build does not draw are left out, because the parts keep one rhythm
 * across them. The turn moves while the agent may still write to it, which
 * is its last message; any other has ended. A worker's session folds as
 * its agent's does, since a run of calls reads the same whoever made it.
 * The agent's newest to-do list, named by the call that wrote it
 * (`newestTodos`), stays out of a finished turn's fold, so the list
 * standing is never folded away, and so does every set of pictures and
 * every page the agent showed, which is its answer as much as its words are. A line that
 * reached the turn while it ran (`arrived`) stands among its parts where it
 * arrived, splitting the fold of a finished turn around it.
 */
export function agentRows(
  message: AgentTranscriptMessage,
  moving: boolean,
  { newestTodos, workers = NO_WORKERS, arrived = [] }: AgentTurnPlace = {},
): readonly TurnRow<AgentPart>[] {
  const parts = drawnParts(message, arrived);
  const reading: RowReading<AgentPart> = {
    ...AGENT_READING,
    running: (part) =>
      AGENT_READING.running(part) ||
      (part.kind === AGENT_PART.TOOL && workers.get(part.callId) === TOOL_STATE.INPUT_AVAILABLE),
    kept: (part) =>
      (part.kind === AGENT_PART.TOOL && part.callId === newestTodos) ||
      isShownSet(part) ||
      isShownPage(part) ||
      keptRecording(part),
  };
  return turnRows(parts, reading, { key: message.id, moving, done: !moving });
}

/** One of a transcript's rows as the tab draws it, with the developer's lines that reached it while its turn ran. */
export interface PlacedMessage {
  readonly message: AgentTranscriptMessage;
  /** The lines its turn took in under way (`arrivedIn`), oldest first; none on any row but a turn's journal. */
  readonly arrived: readonly AgentTranscriptMessage[];
}

/**
 * The rows with each line that follows the newest turn while it is still
 * open placed in that turn after the steps it has begun, as a line it takes
 * in is placed once the service says where it arrived. Note that such a
 * line steers the turn, and drawn below it, it would stand the turn as
 * done, offering a finished turn's actions, then move into it as the
 * service takes it. A line that did not go (`unsent`) reached no turn, so
 * it stands where the order puts it.
 */
function steeringPlaced(
  messages: readonly AgentTranscriptMessage[],
  unsent: (id: string) => boolean,
): readonly AgentTranscriptMessage[] {
  const at = messages.findLastIndex((message) => message.role === MESSAGE_ROLE.ASSISTANT);
  const journal = messages[at];
  if (journal === undefined || journal.finishedAt !== undefined) return messages;
  const begun = agentParts(journal).filter((part) => part.kind === AGENT_PART.STEP_START).length;
  const arrivedIn = { journalId: journal.id, afterStep: begun };
  return messages.map((message, index) =>
    index > at &&
    message.role === MESSAGE_ROLE.USER &&
    message.arrivedIn === undefined &&
    !unsent(message.id)
      ? { ...message, arrivedIn }
      : message,
  );
}

/**
 * A transcript's rows with each line that reached a turn under way moved
 * into that turn's journal, which draws it where it arrived, out of the
 * order the service keeps, where the journal closed behind it. A line whose
 * journal is not among the rows, as when its page is still to land, stands
 * where the order puts it, as every line does from a service older than it.
 */
export function placedMessages(
  messages: readonly AgentTranscriptMessage[],
  unsent: (id: string) => boolean = () => false,
): readonly PlacedMessage[] {
  const shown = steeringPlaced(messages, unsent);
  const journals = new Set(
    shown.filter((message) => message.role === MESSAGE_ROLE.ASSISTANT).map((each) => each.id),
  );
  const arrived = new Map<string, AgentTranscriptMessage[]>();
  for (const message of shown) {
    const journal = message.arrivedIn?.journalId;
    if (journal === undefined || !journals.has(journal)) continue;
    arrived.set(journal, [...(arrived.get(journal) ?? []), message]);
  }
  return shown.flatMap((message) => {
    const journal = message.arrivedIn?.journalId;
    if (journal !== undefined && journals.has(journal)) return [];
    return [{ message, arrived: arrived.get(message.id) ?? [] }];
  });
}

/** A stretch of a turn's rows as the tab draws it: the turn's own rows, or a line that reached it while it ran, which stands between them as the developer's own message. */
export type TurnStretch =
  | { readonly line: AgentTranscriptMessage; readonly rows?: undefined }
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
  /** It is being taken back to an earlier line (`rewind-action.tsx`), and stopped first where it ran. */
  REWINDING: "rewinding",
  /** Its session has not opened the turn that will answer the newest line. */
  STARTING: "starting",
  /** The turn is open and its model has drawn nothing yet. */
  THINKING: "thinking",
  /** The turn has drawn something: a call, a thought, or words. */
  WORKING: "working",
} as const;

export type WorkingPhase = (typeof WORKING_PHASE)[keyof typeof WORKING_PHASE];

/** What the working line says in each phase. */
const WORKING_PHASE_WORDS = {
  [WORKING_PHASE.REWINDING]: "Rewinding…",
  [WORKING_PHASE.STARTING]: "Starting…",
  [WORKING_PHASE.THINKING]: "Thinking…",
  [WORKING_PHASE.WORKING]: "Working…",
} as const satisfies Record<WorkingPhase, string>;

/** What the working line says while a local agent's launch stands at a step that names neither its host nor its harness. */
const LAUNCH_STEP_WORDS = {
  [AGENT_LAUNCH.PREPARING]: "Preparing the folder…",
  [AGENT_LAUNCH.FETCHING]: "Fetching the repository…",
} as const;

/** What the working line says as a local agent's harness starts, by the harness. */
const HARNESS_START_WORDS = {
  [AGENT_RUNTIME.CLAUDE_CODE]: "Starting Claude Code…",
  [AGENT_RUNTIME.CODEX]: "Starting Codex…",
} as const satisfies Record<NativeAgentRuntime, string>;

/** Who a launch waits on where its host's name is not to hand. */
const UNNAMED_HOST = "the host";

/** Where a local agent's launch stands as its page said, with what its words name: the host it runs on and the harness it runs. */
export interface StartingLaunch {
  readonly launch: AgentLaunch;
  /** The host's name, as the agent's Runs on chip shows it (`agent-place.tsx`); none where none is to hand. */
  readonly host?: string | undefined;
  /** The harness the agent runs, as its summary says; none where unsaid. */
  readonly runtime?: NativeAgentRuntime | undefined;
}

/**
 * What the working line says in a phase. While the agent starts, a local
 * agent whose page said where its launch stands (`AGENT_LAUNCH`) says what
 * its start waits on: its host, by the name its Runs on chip shows, taking
 * the launch, the folder, the repository, or its harness by name. With no
 * launch said, as for a cloud agent, an older host, or an older service, it
 * says "Starting…" as before. Note that a launch said once the turn has
 * opened says nothing, since the phase has left starting.
 */
export function workingLineWords(phase: WorkingPhase, starting?: StartingLaunch): string {
  if (phase !== WORKING_PHASE.STARTING || starting === undefined) {
    return WORKING_PHASE_WORDS[phase];
  }
  const { launch, host, runtime } = starting;
  switch (launch) {
    case AGENT_LAUNCH.WAITING:
      return `Waiting for ${host ?? UNNAMED_HOST}…`;
    case AGENT_LAUNCH.STARTING:
      return runtime === undefined ? WORKING_PHASE_WORDS[phase] : HARNESS_START_WORDS[runtime];
    default:
      return LAUNCH_STEP_WORDS[launch];
  }
}

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
 * settles a look later. While a rewind is out it is rewinding, whatever
 * the transcript shows.
 */
export function agentWorkingPhase(
  lines: readonly AgentTranscriptMessage[],
  sessionStarting: boolean,
  rewinding = false,
): WorkingPhase {
  if (rewinding) return WORKING_PHASE.REWINDING;
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
 * When the working line counts from, read off the lines themselves: the
 * press of the developer's line that opened the turn under way, or opens
 * the one on its way, and the turn's own start where no such line stands.
 * Note that the task list's run is not read, because a line sent does not
 * wake the list, which until then still holds the turn before it, ended
 * however long ago, and holds no start at all while the line awaits its
 * turn; none where the lines say nothing, as before a first turn.
 */
export function agentWorkingSince(lines: readonly AgentTranscriptMessage[]): number | undefined {
  const at = lines.findLastIndex((line) => line.role === MESSAGE_ROLE.ASSISTANT);
  const journal = lines[at];
  const opens = (line: AgentTranscriptMessage) =>
    line.role === MESSAGE_ROLE.USER && line.arrivedIn === undefined && line.sentAt !== undefined;
  // A closed journal, or none, is followed by the line that opens the next turn, where one was sent.
  if (journal === undefined || journal.finishedAt !== undefined) {
    return lines.slice(at + 1).find(opens)?.sentAt;
  }
  // An open journal was opened by the first line after the journal before it.
  const before = lines.slice(0, at).findLastIndex((line) => line.role === MESSAGE_ROLE.ASSISTANT);
  return lines.slice(before + 1, at).find(opens)?.sentAt ?? journal.startedAt;
}

/**
 * How a worker's row marks where it stands, as its own session reads: still
 * running while it starts or works, at rest once it completed or was
 * stopped, whose own tab says which, and failed where it failed.
 */
export function workerToolState(status: AgentStatus): ToolState {
  switch (status) {
    case AGENT_STATUS.STARTING:
    case AGENT_STATUS.RUNNING:
      return TOOL_STATE.INPUT_AVAILABLE;
    case AGENT_STATUS.FAILED:
      return TOOL_STATE.OUTPUT_ERROR;
    case AGENT_STATUS.COMPLETED:
    case AGENT_STATUS.CANCELED:
      return TOOL_STATE.OUTPUT_AVAILABLE;
  }
}

/** Where a worker stands, read from its delegation's part: running until the call answers, then completed, or failed where the call ended in an error. */
export function workerStatusOf(state: ToolState): AgentStatus {
  if (state === TOOL_STATE.OUTPUT_AVAILABLE) return AGENT_STATUS.COMPLETED;
  return state === TOOL_STATE.OUTPUT_ERROR ? AGENT_STATUS.FAILED : AGENT_STATUS.RUNNING;
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
  messages: readonly AgentTranscriptMessage[],
): readonly AgentTranscriptMessage[] {
  // A worker opened by its link carries no task's words, so the service's own first row's are the task.
  const first = messages.find((message) => message.role === MESSAGE_ROLE.USER);
  const words = task === "" && first !== undefined ? messageWords(first) : task;
  return [
    { id: TASK_ROW_ID, role: MESSAGE_ROLE.USER, parts: [{ type: AGENT_PART.TEXT, text: words }] },
    ...messages.filter((message) => message.role !== MESSAGE_ROLE.USER),
  ];
}

/** A message's words: its text parts, one paragraph each, which is what a copy of a turn carries and what the developer's line reads as. */
export function messageWords(message: AgentTranscriptMessage): string {
  return agentParts(message)
    .flatMap((part) => (part.kind === AGENT_PART.TEXT ? [part.text] : []))
    .join("\n\n");
}

/** How many words a reply's lead holds at most, where its first sentence runs on. */
const REPLY_LEAD_WORDS = 24;

/** A sentence's end: its stop, then a space or the end of the words. */
const SENTENCE_END = /[.!?](?=\s|$)/u;

/**
 * What a turn that finished replied, as a reader hears it: its newest
 * reply's last stretch of words, after the turn's last call, cut to its
 * first sentence, or to its first words where that runs on. Nothing where
 * there is no reply, or no words follow its last call, as a turn that ended
 * on a call.
 */
export function finishedReplyLead(
  messages: readonly AgentTranscriptMessage[],
): { readonly messageId: string; readonly lead: string } | undefined {
  const reply = messages.findLast((message) => message.role === MESSAGE_ROLE.ASSISTANT);
  if (reply === undefined) return undefined;
  // Note that only words after the turn's last call are its reply, because words before it were the turn under way.
  const parts = agentParts(reply);
  const lastCall = parts.findLastIndex((part) => part.kind === AGENT_PART.TOOL);
  const last = parts.slice(lastCall + 1).findLast((part) => part.kind === AGENT_PART.TEXT);
  const words = last?.kind === AGENT_PART.TEXT ? plainWords(last.text) : "";
  if (words === "") return undefined;
  const end = SENTENCE_END.exec(words);
  const sentence = end === null ? words : words.slice(0, end.index + 1);
  const cut = sentence.split(/\s+/u);
  const lead =
    cut.length <= REPLY_LEAD_WORDS ? sentence : `${cut.slice(0, REPLY_LEAD_WORDS).join(" ")}…`;
  return { messageId: reply.id, lead };
}

/** Where a line the developer sent stands, before the service's row for it lands. */
export const SENT_LINE_STATE = {
  /** On its way, or taken and its row not yet read. */
  PENDING: "pending",
  /** Refused for now: the box has words of its own, so the line keeps its words where it went, with Retry. */
  FAILED: "failed",
  /** Refused for good, its session ended: it stands where it went marked as not delivered, and no row will read it back. */
  UNDELIVERED: "undelivered",
} as const;

type SentLineState = (typeof SENT_LINE_STATE)[keyof typeof SENT_LINE_STATE];

/**
 * A line the developer sent that the transcript has not read back yet:
 * drawn as theirs the moment it goes, and let go once the service took it
 * and its own row for it landed.
 */
export interface SentLine {
  /**
   * The id the service writes the line's row under, its send key's
   * (`sentLineId`), which the line is drawn under until that row lands, so
   * the row is drawn in its place (`transcriptRowKey`).
   */
  readonly id: string;
  /** The key the line went under, which Retry sends it under again, so a send whose answer was lost reaches the agent once. */
  readonly clientKey: string;
  /** The words as they went: trimmed, as the service keeps them. */
  readonly text: string;
  /** The files that went with them, drawn on the line as the service's row will draw them. */
  readonly attachments: readonly AgentAttachment[];
  /** Whether a turn ran as the line went, so it steers that turn rather than opening one. */
  readonly steers: boolean;
  /** Epoch milliseconds the line was sent, drawn under it at once, as its row's own time will be. */
  readonly sentAt: number;
  readonly state: SentLineState;
  /** The developer's line it was written in place of, by its message id, which the agent is taken back to just before as it goes; none for a line sent after the rest. */
  readonly rewinds?: string | undefined;
  /** Whether the agent was already taken back to just before that line, which is gone, so the line's Retry only sends. */
  readonly rewound?: boolean | undefined;
  /** Whether the service answered that the agent took it; until it does, a row read back may still be withdrawn. */
  readonly taken?: boolean | undefined;
}

/** The ids the developer's rows of a transcript were written under, which a sent line's row is one of once it lands. */
function landedLines(messages: readonly AgentTranscriptMessage[]): ReadonlySet<string> {
  return new Set(
    messages.flatMap((message) =>
      message.role === MESSAGE_ROLE.USER && message.clientId !== undefined
        ? [message.clientId]
        : [],
    ),
  );
}

/**
 * The sent lines the transcript has not read back yet. A line is read back
 * by the row written under its id, which its send key names, so two lines
 * of the same words are each read back by their own row alone; a line
 * refused for good has no row to be read back by.
 */
export function unreadSentLines(
  sent: readonly SentLine[],
  messages: readonly AgentTranscriptMessage[],
): readonly SentLine[] {
  const landed = landedLines(messages);
  return sent.filter((line) => line.state === SENT_LINE_STATE.UNDELIVERED || !landed.has(line.id));
}

/**
 * The sent lines the box still holds: all but those the service took whose
 * row has landed. Note that a line whose row was read back is held, undrawn,
 * until its answer comes, because the service writes the row before the agent
 * is handed the line and withdraws it where the agent did not take it, so a
 * refusal may follow the row; and a line refused is held until Retry sends
 * it again, since its row, still drawn as the refusal lands, is on its way out.
 */
export function heldSentLines(
  sent: readonly SentLine[],
  messages: readonly AgentTranscriptMessage[],
): readonly SentLine[] {
  const landed = landedLines(messages);
  return sent.filter((line) => line.taken !== true || !landed.has(line.id));
}

/**
 * The key a transcript's row is drawn and measured under: the id a
 * developer's line was written under, which the line drew under before
 * its row landed, so the row lands in its place; every other row's own id.
 */
export function transcriptRowKey(message: AgentTranscriptMessage): string {
  return message.role === MESSAGE_ROLE.USER ? (message.clientId ?? message.id) : message.id;
}

/** A sent line as the tab draws it before the service's row lands: the developer's row. */
function sentLineMessage(line: SentLine): AgentTranscriptMessage {
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
    sentAt: line.sentAt,
  };
}

/**
 * The line an agent New task started is drawn on before its transcript is
 * read: the developer's words as they went, under the id their start's key
 * names, on their way.
 */
export function openingLineOf(words: {
  readonly key: string;
  readonly prompt: string;
  readonly attachments: readonly AgentAttachment[];
  /** When Start was pressed; now where unsaid. */
  readonly sentAt?: number | undefined;
}): SentLine {
  return {
    id: sentLineId(words.key),
    clientKey: words.key,
    text: words.prompt.trim(),
    attachments: words.attachments,
    steers: false,
    sentAt: words.sentAt ?? Date.now(),
    state: SENT_LINE_STATE.PENDING,
  };
}

/**
 * The line an agent was started on, while its transcript reads back no line
 * of the developer's. Note that the service writes that first row under a
 * key of its own, or eve under none, so the line is let go by any row of
 * theirs rather than by its id, and the first is always that one.
 */
export function unreadOpeningLine(
  opening: SentLine | undefined,
  messages: readonly AgentTranscriptMessage[],
): SentLine | undefined {
  if (opening === undefined) return undefined;
  return messages.some((message) => message.role === MESSAGE_ROLE.USER) ? undefined : opening;
}

/** The transcript's rows, with the lines sent and not yet read back at its end, in the order they went. */
export function agentLines(
  messages: readonly AgentTranscriptMessage[],
  sent: readonly SentLine[],
): readonly AgentTranscriptMessage[] {
  return [...messages, ...sent.map(sentLineMessage)];
}

/** What each pull request state is called, on the chip's label and, where it changes what the developer would do, on the row; the one map every place that says a state reads. */
export const PULL_REQUEST_STATE_LABEL = {
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
function githubPath(name: string): string {
  return encodeURIComponent(name).replaceAll("%2F", "/");
}

/** Where the chip opens on GitHub: the pull request, or the branch compared against the repository's default where there is no pull request yet. */
export function publishedUrl(published: AgentPullRequestAnswer): string | undefined {
  if (published.pullRequest !== null) return published.pullRequest.url;
  if (published.branch === null || published.repository === null) return undefined;
  return `https://github.com/${published.repository}/compare/${githubPath(published.branch)}?expand=1`;
}

/** The number as the chip and the row spell it. */
export function pullRequestNumberLabel(pullRequest: Pick<AgentPullRequest, "number">): string {
  return `#${pullRequest.number}`;
}

/** The word the row says where the pull request stands, only where that changes what the developer would do: a draft, merged, closed, or open in GitHub's merge queue, queued; nothing for one open otherwise. */
export function pullRequestStateWord(
  pullRequest: Pick<AgentPullRequest, "state" | "queued">,
): string | undefined {
  const { state } = pullRequest;
  if (state !== PULL_REQUEST_STATE.OPEN) return PULL_REQUEST_STATE_LABEL[state];
  return pullRequest.queued === true ? QUEUED_LABEL : undefined;
}

/** What the row says of an open pull request GitHub's merge queue holds, as its tab's pill says it. */
export const QUEUED_LABEL = "Queued";

/** How a pull request the merge queue holds is said where its place is known: "Queued #3", else "Queued". */
export function queuedLabel(position: number | undefined): string {
  return position === undefined ? QUEUED_LABEL : `${QUEUED_LABEL} #${position}`;
}

/** Where a pull request stands in one word, as its card heads it: Queued for an open one the merge queue holds, else its state's label. */
export function pullRequestStateLabel(
  pullRequest: Pick<AgentPullRequest, "state" | "queued">,
): string {
  return pullRequestStateWord(pullRequest) ?? PULL_REQUEST_STATE_LABEL[pullRequest.state];
}

/** The chip's own words for a reader who cannot see it: the number and where it stands. */
export function pullRequestPillLabel(
  pullRequest: Pick<AgentPullRequest, "number" | "state">,
): string {
  return `Pull request ${pullRequestNumberLabel(pullRequest)}, ${PULL_REQUEST_STATE_LABEL[pullRequest.state].toLowerCase()}`;
}
