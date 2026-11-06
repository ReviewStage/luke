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
import { type DescriptionEditor, TASK_MODE, type TaskMode } from "@repo/features/task-wire";
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

const LINE_SEPARATOR = " · ";

const PAYER_WORDS = {
  [AGENT_PAYER.CLAUDE_SUBSCRIPTION]: "Using Claude plan",
  [AGENT_PAYER.CHATGPT_SUBSCRIPTION]: "Using ChatGPT plan",
  [AGENT_PAYER.APP]: `${PRODUCT_NAME}'s API key`,
  [AGENT_PAYER.MAC_SIGN_IN]: "Using your Mac's sign-in",
} as const satisfies Record<Exclude<AgentPayer, typeof AGENT_PAYER.API_KEY>, string>;

export const API_KEY_WORDS = {
  [MODEL_PROVIDER.ANTHROPIC]: "Anthropic API key",
  [MODEL_PROVIDER.OPENAI]: "OpenAI API key",
} as const satisfies Record<ModelProvider, string>;

const ANY_API_KEY = "API key";

const PRICED_PAYERS: ReadonlySet<AgentPayer> = new Set([AGENT_PAYER.API_KEY, AGENT_PAYER.APP]);

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

export function teammateStarter(
  startedBy: DescriptionEditor | undefined,
  readerId: string | undefined,
): string | undefined {
  return teammateRef(startedBy, readerId)?.name;
}

export function teammateRef(
  startedBy: DescriptionEditor | undefined,
  readerId: string | undefined,
): DescriptionEditor | undefined {
  if (startedBy === undefined || readerId === undefined || startedBy.userId === readerId) {
    return undefined;
  }
  return startedBy;
}

export function macOwnerOf(
  startedBy: DescriptionEditor | undefined,
  members: readonly WorkspaceMember[] | undefined,
  readerId: string | undefined,
  former?: readonly FormerMember[] | undefined,
): Actor | undefined {
  if (startedBy === undefined || readerId === undefined) return undefined;
  return personActor(startedBy, members, readerId, former);
}

const ACTOR_STATE_OF_GLYPH = {
  [GLYPH_STATE.WORKING]: ACTOR_STATE.WORKING,
  [GLYPH_STATE.FAILED]: ACTOR_STATE.FAILED,
  [GLYPH_STATE.REST]: ACTOR_STATE.REST,
} as const satisfies Record<GlyphState, ActorState>;

export interface ArchivedByReading {
  readonly words: string;
  readonly reason: string | undefined;
}

const UNNAMED_ARCHIVER = "another agent";

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

export function subagentActor(model: string | undefined, state: GlyphState, name: string): Actor {
  return {
    kind: ACTOR_KIND.AGENT,
    name,
    provider: model === undefined ? undefined : providerOf(model),
    state: ACTOR_STATE_OF_GLYPH[state],
  };
}

export function agentActorState(status: AgentStatus): ActorState {
  return ACTOR_STATE_OF_GLYPH[agentGlyphState(status)];
}

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
      return {
        kind: ACTOR_KIND.AUTOMATION,
        ...(sentBy.automationId === undefined ? undefined : { automationId: sentBy.automationId }),
        name: sentBy.name,
        state: ACTOR_STATE.REST,
      };
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

export interface EndLineParts {
  readonly words: string;
  readonly failed: boolean;
  readonly failure?: AgentFailure | undefined;
  readonly unstarted?: DeviceLaunchUnstarted | undefined;
}

export interface LaunchStopped {
  readonly step: DeviceLaunchStep;
  readonly runtime?: NativeAgentRuntime | undefined;
  readonly unstarted?: DeviceLaunchUnstarted | undefined;
}

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

export function endLineReason(failure: AgentFailure | undefined, starter?: string): FailureReason {
  return failure === AGENT_FAILURE.PROVIDER_KEY && starter === undefined
    ? FAILURE_REASON.API_KEY
    : FAILURE_REASON.OTHER;
}

const FOLLOWED_STATUSES: ReadonlySet<AgentStatus> = new Set([
  AGENT_STATUS.STARTING,
  AGENT_STATUS.RUNNING,
]);

export function agentStillWriting(status: AgentStatus): boolean {
  return FOLLOWED_STATUSES.has(status);
}

export function offersStop(agent: Pick<AgentSummary, "status" | "stoppable">): boolean {
  return agent.status === AGENT_STATUS.RUNNING && agent.stoppable !== false;
}

export function agentGlyphState(status: AgentStatus): GlyphState {
  if (agentStillWriting(status)) return GLYPH_STATE.WORKING;
  return status === AGENT_STATUS.FAILED ? GLYPH_STATE.FAILED : GLYPH_STATE.REST;
}

export function agentStateWords(status: AgentStatus): string | undefined {
  return glyphStateWords(agentGlyphState(status), status === AGENT_STATUS.CANCELED);
}

const START_NEEDS_REPOSITORY = "Choose a repository";

export const START_NEEDS_TASK = "Open a task to start an agent";

export const REPOSITORY_UNREACHED_NOTE = `${PRODUCT_NAME} cannot reach this task's repository on GitHub.`;

const NOT_HEARD_BACK = "No answer came back.";

export const UNHEARD_OFFLINE = {
  BESIDE_RETRY: "You're offline.",
  ALONE: "You're offline. Try again once you're back online.",
} as const;

const LIMIT_REACHED_WORDS = "Usage limit reached";

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

const START_RETIRED = "This agent has ended. Start a new one.";

const MESSAGE_RETIRED = "This agent has ended. Continue in a new one.";

const HOST_REMOVED = "This host was removed. Start a new agent in the cloud or add it again.";

const MESSAGE_NOT_SENT = "The message could not be sent.";

const BOX_RETIRED = "This agent has ended.";

export const CONTINUE_LABEL = "Continue in new agent";

export const CONTINUE_AGAIN_LABEL = "Continue again";

export const CONTINUED_IN = "Continued in";

function continuationsOf(
  agentId: string,
  agents: readonly AgentSummary[] | undefined,
  archived: readonly AgentSummary[] | undefined,
): readonly AgentSummary[] {
  return [...(agents ?? []), ...(archived ?? [])]
    .filter((each) => each.from?.agentId === agentId && each.from.messageId === undefined)
    .sort((a, b) => a.createdAt - b.createdAt);
}

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

export function continuedByTitles(agent: AgentSummary): ReadonlyMap<string, string> {
  const titled = (agent.continuedBy ?? []).flatMap((each) =>
    each.title === null ? [] : [[each.agentId, each.title] as const],
  );
  return new Map(titled);
}

function endLineContinues(status: AgentStatus, endReason: FailureReason): boolean {
  return status === AGENT_STATUS.FAILED && endReason !== FAILURE_REASON.API_KEY;
}

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

export function startsOwnAgents(mode: TaskMode | undefined): boolean {
  return mode !== TASK_MODE.PILOT;
}

export function offersContinue(
  mode: TaskMode | undefined,
  agent: { readonly pilot?: true | undefined },
): boolean {
  return startsOwnAgents(mode) || agent.pilot === true;
}

const MODEL_CHANGE_FAILED = "The model could not be changed. Try again.";

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

export const START_FAILED_AWAY = "The agent could not be started.";

export const STOP_FAILED = "The agent could not be stopped. Try again.";

export const RENAME_FAILED = "The agent could not be renamed. Try again.";

export const SERVERS_FAILED = "The agent's integrations could not be changed. Try again.";

const ARCHIVED_WORDS = {
  done: "Agent archived",
  refused: "The agent could not be archived. Try again.",
} as const;

const UNARCHIVED_WORDS = {
  done: "Agent unarchived",
  refused: "The agent could not be unarchived. Try again.",
} as const;

export const ARCHIVE_NOT_READY = "The agent is still starting its turn. Try again in a moment.";

export const DELETE_WORDS = {
  refused: "The agent could not be deleted. Try again.",
} as const;

export function archiveWords(archived: boolean): {
  readonly done: string;
  readonly refused: string;
} {
  return archived ? ARCHIVED_WORDS : UNARCHIVED_WORDS;
}

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

export interface RefusingDevice {
  readonly name: string;
  readonly platform?: DevicePlatform | undefined;
  readonly owner?: string | undefined;
}

const UNNAMED_DEVICE = "Your device";

const RUN_IN_CLOUD = "or start it in the cloud";

const DEVICE_WAKE = {
  [DEVICE_PLATFORM.DARWIN]: "Wake it and log in on it",
  [DEVICE_PLATFORM.LINUX]: "Check that it's on, connected, and running vespin-host",
} as const satisfies Record<DevicePlatform, string>;

const SETUP_RETRY = {
  [DEVICE_PLATFORM.DARWIN]:
    "Open Settings › Hosts on that Mac and turn Bring your own host off and on",
  [DEVICE_PLATFORM.LINUX]: "Run systemctl --user restart vespin-host on that host",
} as const satisfies Record<DevicePlatform, string>;

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
    case LOCAL_AGENT_REFUSAL.NOT_OWNER:
      return `This task runs on ${device?.name ?? "another member's device"}. Only ${device?.owner ?? "its owner"} can start agents on it.`;
    case LOCAL_AGENT_REFUSAL.GITHUB_SIGN_IN:
      return `${name} runs an older vespin-host, which can't work in a repository reached on your own GitHub token. Update its host, ${RUN_IN_CLOUD}.`;
    case undefined:
      return `${name} couldn't take this agent. Try again, ${RUN_IN_CLOUD}.`;
  }
}

const EXTRA_REPOSITORY_WHY = {
  token: (named: string) =>
    `${named} is reached on your own GitHub token. An agent's repositories must all be reached through the GitHub App.`,
  otherInstallation: (named: string) =>
    `${named} is on another GitHub account than the agent's repository. An agent's repositories must share one.`,
} as const;

const NOT_ADDED = "The repository couldn't be added. Try again.";

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
    case EXTRA_REPOSITORY_REFUSAL.ALREADY:
    case EXTRA_REPOSITORY_REFUSAL.FULL:
    case EXTRA_REPOSITORY_REFUSAL.HEARD_ANOTHER_ACCOUNT:
    case undefined:
      return "These repositories can't be used together. Remove the others to start the agent.";
  }
}

const ACTION = { START: "start an agent", MESSAGE: "message this agent" } as const;

export interface ConnectFailure {
  readonly reason: typeof FAILURE_REASON.CONNECT_AGENTS;
  readonly text: string;
  readonly provider: ModelProvider;
}

const CONNECT_CREDENTIALS = {
  [MODEL_PROVIDER.ANTHROPIC]: "a Claude plan or an Anthropic API key",
  [MODEL_PROVIDER.OPENAI]: "a ChatGPT plan or an OpenAI API key",
} as const satisfies Record<ModelProvider, string>;

export function modelConnectFailure(model: CatalogModel): ConnectFailure | undefined {
  if (model.credentialMissing !== true) return undefined;
  return {
    reason: FAILURE_REASON.CONNECT_AGENTS,
    text: `${modelLabel(model.id, [model])} cannot run until you connect ${CONNECT_CREDENTIALS[model.provider]}.`,
    provider: model.provider,
  };
}

export function modelConnectWords(model: CatalogModel): string | undefined {
  const connect = modelConnectFailure(model);
  return connect === undefined ? undefined : remedyLabel(connect);
}

export function unrunnableChoice(
  models: readonly CatalogModel[],
  choice: ModelChoice,
): ConnectFailure | undefined {
  const { base } = readModelChoice(models, choice.model);
  const model = models.find((each) => each.id === base);
  return model === undefined ? undefined : modelConnectFailure(model);
}

function credentialMissingWords(
  provider: ModelProvider | undefined,
  action: (typeof ACTION)[keyof typeof ACTION],
): string {
  const harness = provider === undefined ? "Claude or Codex" : harnessNameOf(provider);
  return `Connect ${harness} in Settings to ${action}.`;
}

const START_PLAN_REFUSAL = {
  [AGENT_CALL_FAILURE.AGENT_PLAN_SIGNED_OUT]: "Your plan is signed out. Connect it again.",
  [AGENT_CALL_FAILURE.AGENT_PLAN_INELIGIBLE]:
    "Your plan isn't eligible to run this agent. Choose your API key.",
} as const;

const START_PLAN_REFUSAL_ALONE = {
  [AGENT_CALL_FAILURE.AGENT_PLAN_SIGNED_OUT]:
    "Your plan is signed out. Connect it again in Settings to start an agent.",
  [AGENT_CALL_FAILURE.AGENT_PLAN_INELIGIBLE]:
    "Your plan isn't eligible to run this agent. Choose your API key in Settings to start one.",
} as const;

const KEY_UNREADABLE_NOTE = "Your saved API key can't be read. Save it again.";

function keyUnreadableWords(action: (typeof ACTION)[keyof typeof ACTION]): string {
  return `Your saved API key can't be read. Save it again in Settings to ${action}.`;
}

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

export function planPayerOf(runtime: AgentRuntime | undefined): AgentPayer | undefined {
  if (runtime === AGENT_RUNTIME.CLAUDE_CODE) return AGENT_PAYER.CLAUDE_SUBSCRIPTION;
  if (runtime === AGENT_RUNTIME.CODEX) return AGENT_PAYER.CHATGPT_SUBSCRIPTION;
  return undefined;
}

const CLAUDE_PLAN_REFUSAL = {
  SIGNED_OUT: "Signed out of Claude. Connect your Claude plan again in Settings.",
} as const;

function limitResetsWords(resetsAt: number): string {
  return `${LIMIT_REACHED_WORDS} · Resets ${dayAndTimeText(resetsAt)}`;
}

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

function callFailure(text: string): Failure {
  return { reason: FAILURE_REASON.OTHER, text };
}

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

function startFailureWords(failure: AgentCallFailure): string {
  switch (failure) {
    case AGENT_CALL_FAILURE.NO_REPOSITORY:
      return START_NEEDS_REPOSITORY;
    case AGENT_CALL_FAILURE.INVALID_CHOICE:
      return "That model isn't offered any more. Choose another.";
    case AGENT_CALL_FAILURE.NOT_FOUND:
      return "This task no longer exists.";
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

function starterKeyWords(failure: AgentCallFailure, starter: string): string | undefined {
  if (failure === AGENT_CALL_FAILURE.AGENT_API_KEY_UNREADABLE) {
    return `${starter}'s saved API key can't be read. They save it again in Settings to unblock this agent.`;
  }
  if (failure === AGENT_CALL_FAILURE.AGENT_CREDENTIAL_MISSING) {
    return `${starter} has no plan or API key connected for this agent. They connect one in Settings to unblock it.`;
  }
  return undefined;
}

export function messageFailureNote(
  refused: RefusedCall,
  taskId: string | null,
  payer?: AgentPayer | undefined,
  starter?: string | undefined,
): Failure {
  if (refused.failure === AGENT_CALL_FAILURE.REPOSITORY_NOT_REACHABLE) {
    return unreachedFailure(refused.unreached, taskId);
  }
  if (refused.failure === AGENT_CALL_FAILURE.AGENT_RETIRED) return callFailure(BOX_RETIRED);
  if (refused.failure === AGENT_CALL_FAILURE.DEVICE_REMOVED) return callFailure(HOST_REMOVED);
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

export function messageFailureWords(failure: AgentCallFailure): string {
  switch (failure) {
    case AGENT_CALL_FAILURE.NOT_FOUND:
      return "This agent no longer exists.";
    case AGENT_CALL_FAILURE.NO_REPOSITORY:
    case AGENT_CALL_FAILURE.EXTRA_REPOSITORY_REFUSED:
    case AGENT_CALL_FAILURE.INVALID_CHOICE:
    case AGENT_CALL_FAILURE.OPENAI_KEY_MISSING:
      return `${MESSAGE_NOT_SENT} Try again.`;
    case AGENT_CALL_FAILURE.LOCAL_AGENT_REFUSED:
      return localAgentRefusalWords(LOCAL_AGENT_REFUSAL.MAC_AWAY, undefined);
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

export function closesComposer(failure: AgentCallFailure): boolean {
  return (
    failure === AGENT_CALL_FAILURE.AGENT_RETIRED || failure === AGENT_CALL_FAILURE.DEVICE_REMOVED
  );
}

export function pilotTarget(
  agent: Pick<AgentSummary, "planId" | "startedByPilot">,
): ToolTarget | undefined {
  const pilot = agent.startedByPilot;
  if (pilot === undefined) return undefined;
  return pilot.taskId === agent.planId
    ? { kind: TOOL_TARGET.AGENT, agent: pilot.agentId }
    : { kind: TOOL_TARGET.TASK, task: pilot.taskId, agent: pilot.agentId };
}

export { agentName, modelLabel };

export function providerOf(modelId: string): ModelProvider | undefined {
  const prefix = modelId.slice(0, Math.max(0, modelId.indexOf(CATALOG_ID_SEPARATOR)));
  return Object.values(MODEL_PROVIDER).find((provider) => provider === prefix);
}

const MODEL_VERSION = /\d+(?:\.\d+)*/u;

const VERSION_WORD = /^\d+(?:\.\d+)*$/u;

const NAME_WORD_SEPARATOR = "-";

function ownName(modelId: string): string {
  const separator = modelId.indexOf(CATALOG_ID_SEPARATOR);
  return separator === -1 ? modelId : modelId.slice(separator + 1);
}

function modelVersion(modelId: string): number[] {
  const found = MODEL_VERSION.exec(ownName(modelId))?.[0];
  return found === undefined ? [] : found.split(".").map(Number);
}

function compareVersions(a: readonly number[], b: readonly number[]): number {
  for (let part = 0; part < Math.max(a.length, b.length); part += 1) {
    const difference = (a[part] ?? 0) - (b[part] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

const PROVIDER_ORDER: readonly string[] = Object.values(MODEL_PROVIDER);

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

function familyRank(modelId: string): number {
  const name = ownName(baseIdOf(modelId) ?? modelId);
  const words = name.split(NAME_WORD_SEPARATOR).filter((word) => !VERSION_WORD.test(word));
  const rank = LEAD_FAMILIES.indexOf(words.at(-1) ?? "");
  return rank === -1 ? LEAD_FAMILIES.length : rank;
}

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

export const MODELS_READ_FAILED = readFailedWords("the models");

export const SPEED_WORD = {
  [MODEL_SPEED.STANDARD]: "Standard",
  [MODEL_SPEED.FAST]: "Fast",
  [MODEL_SPEED.ULTRAFAST]: "Ultrafast",
} as const satisfies Record<ModelSpeed, string>;

export const FAST_WORD = SPEED_WORD[MODEL_SPEED.FAST];

export const SPEED_LABEL = "Speed";

const FAST_NOT_ENABLED_NOTE = "Fast isn't enabled for this key's Anthropic organization";

export const FAST_ACCESS_URL = "https://claude.com/fast-mode";

const CHOICE_WORD_SEPARATOR = " ";

export interface OfferedModel {
  readonly model: CatalogModel;
  readonly fast: CatalogModel | undefined;
  readonly ultrafast: CatalogModel | undefined;
}

function baseIdOf(id: string): string | undefined {
  return modelSpeedOf(id) === MODEL_SPEED.STANDARD ? undefined : standardModelIdOf(id);
}

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

export function fastRestingNote(
  baseId: string,
  offered: OfferedModel | undefined,
  models: readonly CatalogModel[],
): string | undefined {
  if (offered?.fast !== undefined) return undefined;
  if (offered?.model.fastNotEnabled === true) return FAST_NOT_ENABLED_NOTE;
  return `No fast version of ${modelLabel(baseId, models)}`;
}

function isSpeedVersion(id: string, ids: ReadonlySet<string>): boolean {
  const base = baseIdOf(id);
  return base !== undefined && ids.has(base);
}

function versionAt(offered: OfferedModel, speed: ModelSpeed): CatalogModel | undefined {
  if (speed === MODEL_SPEED.FAST) return offered.fast;
  if (speed === MODEL_SPEED.ULTRAFAST) return offered.ultrafast;
  return offered.model;
}

export function speedsOf(offered: OfferedModel): readonly ModelSpeed[] {
  return Object.values(MODEL_SPEED).filter((speed) => versionAt(offered, speed) !== undefined);
}

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

export function choiceModelId(offered: OfferedModel, speed: ModelSpeed): string {
  return (versionAt(offered, speed) ?? offered.model).id;
}

function choiceDetail(effort: string, speed: ModelSpeed, standardTokens?: number): string {
  const words = [effortLabel(effort)];
  if (speed !== MODEL_SPEED.STANDARD) words.push(SPEED_WORD[speed]);
  if (standardTokens !== undefined) words.push(windowLabel(standardTokens));
  return words.join(CHOICE_WORD_SEPARATOR);
}

export const CONTEXT_WORD = "Context";

const WINDOW_CUT = { THOUSAND: 1_000, TENTH_OF_A_MILLION: 100_000, MILLION: 1_000_000 } as const;

export function windowLabel(tokens: number): string {
  const step = tokens >= WINDOW_CUT.MILLION ? WINDOW_CUT.TENTH_OF_A_MILLION : WINDOW_CUT.THOUSAND;
  return formatCompact(Math.floor(tokens / step) * step);
}

export function contextWindowsOf(
  models: readonly CatalogModel[],
  modelId: string,
): ContextWindows | undefined {
  return models.find((model) => model.id === modelId)?.contextWindows;
}

export function windowOf(models: readonly CatalogModel[], choice: ModelChoice): ContextWindow {
  return choice.contextWindow === CONTEXT_WINDOW.STANDARD &&
    contextWindowsOf(models, choice.model) !== undefined
    ? CONTEXT_WINDOW.STANDARD
    : CONTEXT_WINDOW.LONG;
}

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

export function choiceRequest(choice: ModelChoice): ModelChoice {
  return choice.contextWindow === CONTEXT_WINDOW.STANDARD
    ? { model: choice.model, effort: choice.effort, contextWindow: CONTEXT_WINDOW.STANDARD }
    : { model: choice.model, effort: choice.effort };
}

function factorLabel(factor: number): string {
  return `${Number(factor.toFixed(2))}×`;
}

export function longWindowNote(windows: ContextWindows): string {
  const past = `On ${windowLabel(windows.longTokens)}, prompts over ${windowLabel(windows.standardTokens)} tokens cost`;
  const parts: string[] = [];
  if (windows.longInputPriceFactor !== undefined)
    parts.push(`${factorLabel(windows.longInputPriceFactor)} for input`);
  if (windows.longOutputPriceFactor !== undefined)
    parts.push(`${factorLabel(windows.longOutputPriceFactor)} for output`);
  return parts.length === 0 ? `${past} more.` : `${past} ${andList(parts)}.`;
}

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

export function choiceLabel(choice: ModelChoice, models: readonly CatalogModel[]): string {
  const words = choiceWords(choice, models);
  return `${words.model}${CHOICE_WORD_SEPARATOR}${words.detail}`;
}

export function effortsOf(models: readonly CatalogModel[], modelId: string): readonly string[] {
  return models.find((model) => model.id === modelId)?.efforts ?? [];
}

const EFFORT_SCALE: readonly string[] = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

function effortRank(effort: string): number | undefined {
  const rank = EFFORT_SCALE.indexOf(effort);
  return rank === -1 ? undefined : rank;
}

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

const EFFORT_LABEL: ReadonlyMap<string, string> = new Map([["xhigh", "Extra high"]]);

export function effortLabel(effort: string): string {
  return EFFORT_LABEL.get(effort) ?? `${effort.charAt(0).toUpperCase()}${effort.slice(1)}`;
}

export type AgentRun = Pick<AgentSummary, "status" | "runStartedAt">;

export const AGENT_PART = {
  TEXT: "text",
  REASONING: "reasoning",
  TOOL: "tool",
  STEP_START: "step-start",
  OTHER: "other",
  ARRIVED: "arrived",
} as const;

const TOOL_PART_TYPE_PREFIX = "tool-";

const TOOL_STATES: ReadonlySet<string> = new Set(Object.values(TOOL_STATE));

export type AgentPartCut = Omit<PartCut, "field"> & { readonly messageId: string };

export type AgentPart =
  | { readonly kind: typeof AGENT_PART.TEXT; readonly text: string }
  | {
      readonly kind: typeof AGENT_PART.REASONING;
      readonly text: string;
      readonly cut?: AgentPartCut;
    }
  | {
      readonly kind: typeof AGENT_PART.TOOL;
      readonly tool: string;
      readonly callId: string;
      readonly state: ToolState;
      readonly input: WireValue | undefined;
      readonly output: WireValue | undefined;
      readonly errorText: string | undefined;
      readonly cut?: AgentPartCut;
    }
  | { readonly kind: typeof AGENT_PART.STEP_START }
  | { readonly kind: typeof AGENT_PART.OTHER }
  | { readonly kind: typeof AGENT_PART.ARRIVED; readonly line: AgentTranscriptMessage };

function toolState(value: WireValue | undefined): ToolState {
  return isWireString(value) && TOOL_STATES.has(value)
    ? (value as ToolState)
    : TOOL_STATE.INPUT_AVAILABLE;
}

export function agentPart(part: WireValue): AgentPart {
  if (!isRecord(part) || !isWireString(part.type)) return { kind: AGENT_PART.OTHER };
  if (part.type === AGENT_PART.TEXT || part.type === AGENT_PART.REASONING) {
    return isWireString(part.text)
      ? { kind: part.type, text: part.text }
      : { kind: AGENT_PART.OTHER };
  }
  if (part.type === AGENT_PART.STEP_START) return { kind: AGENT_PART.STEP_START };
  if (part.type.startsWith(TOOL_PART_TYPE_PREFIX)) {
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

const readUserMetadata = Schema.decodeUnknownOption(USER_MESSAGE_METADATA);

export function agentMessageOf(message: AgentTranscriptMessage): AgentMessageMetadata | undefined {
  const read = userMetadataOf(message);
  return read?.channel === MESSAGE_CHANNEL.AGENT_MESSAGE ? read : undefined;
}

export function isWakeupLine(message: AgentTranscriptMessage): boolean {
  return userMetadataOf(message)?.channel === MESSAGE_CHANNEL.APP;
}

const SECOND_MS = 1_000;

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

export function threadLineOf(message: AgentTranscriptMessage): ThreadLineMetadata | undefined {
  const read = userMetadataOf(message);
  return read?.channel === MESSAGE_CHANNEL.THREAD ? read : undefined;
}

export function commentLineOf(message: AgentTranscriptMessage): CommentLineMetadata | undefined {
  const read = userMetadataOf(message);
  return read?.channel === MESSAGE_CHANNEL.COMMENT && read.words !== undefined ? read : undefined;
}

export function commentLineWords(line: CommentLineMetadata): string {
  const words = line.words ?? "";
  if (line.quote === undefined || line.quote === "") return words;
  return messageText([
    { kind: MESSAGE_BLOCK.QUOTE, words: line.quote },
    { kind: MESSAGE_BLOCK.WORDS, lines: words.split("\n") },
  ]);
}

export function slackLineOf(message: AgentTranscriptMessage): SlackLineMetadata | undefined {
  const read = userMetadataOf(message);
  return read?.channel === MESSAGE_CHANNEL.SLACK ? read : undefined;
}

export function githubLineOf(message: AgentTranscriptMessage): GitHubLineMetadata | undefined {
  const read = userMetadataOf(message);
  return read?.channel === MESSAGE_CHANNEL.GITHUB ? read : undefined;
}

const VERDICT_WORDS: ReadonlyMap<string, string> = new Map([
  ["approved", "approved"],
  ["changes_requested", "requested changes on"],
]);

const REVIEWED = "reviewed";

const COMMENTED = "commented on";

const DEQUEUED = "dequeued";

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

const SOME_FAILED_WORDS = /\bAt least one failed\b/u;

type GitHubLineCheck = NonNullable<GitHubLineMetadata["checks"]>[number];

export interface GitHubLineHead {
  readonly event: string;
  readonly does: string;
  readonly target: string;
}

export function githubChecksFailed(line: GitHubLineMetadata, words: string): boolean {
  if (line.event === GITHUB_LINE_EVENT.CHECK_FAILED) return true;
  return line.failing ?? SOME_FAILED_WORDS.test(words);
}

export function githubLineChecks(line: GitHubLineMetadata): readonly GitHubLineCheck[] {
  const checks = line.checks ?? [];
  return [
    ...checks.filter((check) => isFailingConclusion(check.conclusion)),
    ...checks.filter((check) => !isFailingConclusion(check.conclusion)),
  ];
}

export function githubChecksPassed(line: GitHubLineMetadata, words: string): boolean {
  if (githubChecksFailed(line, words)) return false;
  return (line.checks ?? []).every((check) => check.conclusion === GITHUB_CHECK_CONCLUSION.SUCCESS);
}

function allChecks(count: number): string {
  return count === 1 ? "1 check" : `all ${count} checks`;
}

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

function userMetadataOf(
  message: AgentTranscriptMessage,
): Extract<UserMessageMetadata, { readonly channel: unknown }> | undefined {
  if (message.role !== MESSAGE_ROLE.USER || message.metadata === undefined) return undefined;
  const read = Option.getOrUndefined(readUserMetadata(message.metadata));
  return read === undefined || !("channel" in read) ? undefined : read;
}

function cutAgentPart(part: WireValue, cut: PartCut, messageId: string): AgentPart {
  const { field: _field, ...ends } = cut;
  const marked = { ...ends, messageId };
  if (cut.field === PART_CUT_FIELD.TEXT) {
    return { kind: AGENT_PART.REASONING, text: "", cut: marked };
  }
  const read = agentPart(part);
  return read.kind === AGENT_PART.TOOL ? { ...read, cut: marked } : read;
}

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

const partRead = new WeakMap<object, AgentPart>();

function storedPartRead(part: WireValue): AgentPart {
  if (typeof part !== "object" || part === null) return agentPart(part);
  const read = partRead.get(part);
  if (read !== undefined) return read;
  const fresh = agentPart(part);
  partRead.set(part, fresh);
  return fresh;
}

const partsRead = new WeakMap<AgentTranscriptMessage, readonly AgentPart[]>();

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

export function delegates(part: Extract<AgentPart, { kind: typeof AGENT_PART.TOOL }>): boolean {
  return part.tool === AGENT_DELEGATE_TOOL || part.tool === EVE_TOOL.WORKER || nativeSubagent(part);
}

export function nativeSubagent(
  part: Extract<AgentPart, { kind: typeof AGENT_PART.TOOL }>,
): boolean {
  return part.tool === CLAUDE_CODE_TOOL.AGENT;
}

export function isDelegation(
  part: AgentPart,
): part is Extract<AgentPart, { kind: typeof AGENT_PART.TOOL }> {
  return part.kind === AGENT_PART.TOOL && delegates(part);
}

const TASK_CALL_TOOLS: ReadonlySet<string> = new Set([
  CLAUDE_CODE_TOOL.TASK_CREATE,
  CLAUDE_CODE_TOOL.TASK_UPDATE,
  CLAUDE_CODE_TOOL.TASK_LIST,
  CLAUDE_CODE_TOOL.TASK_GET,
]);

export function isTaskCall(tool: string): boolean {
  return TASK_CALL_TOOLS.has(tool);
}

export function isTodos(
  part: AgentPart,
): part is Extract<AgentPart, { kind: typeof AGENT_PART.TOOL }> {
  return (
    part.kind === AGENT_PART.TOOL && (part.tool === AGENT_TOOL.WRITE_TODOS || isTaskCall(part.tool))
  );
}

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
    return isTodos(part) || isShownSet(part) || isShownPage(part) || keptRecording(part)
      ? ROW_PART.LONE_CALL
      : ROW_PART.CALL;
  },
  running: (part) =>
    part.kind === AGENT_PART.TOOL &&
    (part.state === TOOL_STATE.INPUT_STREAMING || part.state === TOOL_STATE.INPUT_AVAILABLE),
};

const NO_WORKERS: ReadonlyMap<string, ToolState> = new Map();

interface AgentTurnPlace {
  readonly newestTodos?: string | undefined;
  readonly workers?: ReadonlyMap<string, ToolState>;
  readonly arrived?: readonly AgentTranscriptMessage[];
}

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

function isShownSet(part: AgentPart): part is ToolPart {
  return (
    part.kind === AGENT_PART.TOOL &&
    part.tool === AGENT_TOOL.SHOW_IMAGE &&
    part.state === TOOL_STATE.OUTPUT_AVAILABLE &&
    isRecord(part.output) &&
    part.output.status === ACTION_RESULT_STATUS.ACCEPTED
  );
}

function isShownPage(part: AgentPart): boolean {
  return part.kind === AGENT_PART.TOOL && part.tool === AGENT_TOOL.SHOW_PAGE;
}

function keptRecording(part: AgentPart): boolean {
  return part.kind === AGENT_PART.TOOL && recordedVideosOf(part.tool, part.output).length > 0;
}

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

function afterStepOf(line: AgentTranscriptMessage): number {
  return line.arrivedIn?.afterStep ?? 0;
}

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

export interface PlacedMessage {
  readonly message: AgentTranscriptMessage;
  readonly arrived: readonly AgentTranscriptMessage[];
}

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

export type TurnStretch =
  | { readonly line: AgentTranscriptMessage; readonly rows?: undefined }
  | { readonly line?: undefined; readonly rows: readonly TurnRow<AgentPart>[] };

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

const WORKING_PHASE = {
  REWINDING: "rewinding",
  STARTING: "starting",
  THINKING: "thinking",
  WORKING: "working",
} as const;

export type WorkingPhase = (typeof WORKING_PHASE)[keyof typeof WORKING_PHASE];

const WORKING_PHASE_WORDS = {
  [WORKING_PHASE.REWINDING]: "Rewinding…",
  [WORKING_PHASE.STARTING]: "Starting…",
  [WORKING_PHASE.THINKING]: "Thinking…",
  [WORKING_PHASE.WORKING]: "Working…",
} as const satisfies Record<WorkingPhase, string>;

const LAUNCH_STEP_WORDS = {
  [AGENT_LAUNCH.PREPARING]: "Preparing the folder…",
  [AGENT_LAUNCH.FETCHING]: "Fetching the repository…",
} as const;

const HARNESS_START_WORDS = {
  [AGENT_RUNTIME.CLAUDE_CODE]: "Starting Claude Code…",
  [AGENT_RUNTIME.CODEX]: "Starting Codex…",
} as const satisfies Record<NativeAgentRuntime, string>;

const UNNAMED_HOST = "the host";

export interface StartingLaunch {
  readonly launch: AgentLaunch;
  readonly host?: string | undefined;
  readonly runtime?: NativeAgentRuntime | undefined;
}

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

export function agentWorkingPhase(
  lines: readonly AgentTranscriptMessage[],
  sessionStarting: boolean,
  rewinding = false,
): WorkingPhase {
  if (rewinding) return WORKING_PHASE.REWINDING;
  const at = lines.findLastIndex((line) => line.role === MESSAGE_ROLE.ASSISTANT);
  const journal = lines[at];
  if (sessionStarting || journal === undefined) return WORKING_PHASE.STARTING;
  if (journal.finishedAt !== undefined) {
    return at === lines.length - 1 ? WORKING_PHASE.WORKING : WORKING_PHASE.STARTING;
  }
  return drawnParts(journal).length === 0 ? WORKING_PHASE.THINKING : WORKING_PHASE.WORKING;
}

export function agentWorkingSince(lines: readonly AgentTranscriptMessage[]): number | undefined {
  const at = lines.findLastIndex((line) => line.role === MESSAGE_ROLE.ASSISTANT);
  const journal = lines[at];
  const opens = (line: AgentTranscriptMessage) =>
    line.role === MESSAGE_ROLE.USER && line.arrivedIn === undefined && line.sentAt !== undefined;
  if (journal === undefined || journal.finishedAt !== undefined) {
    return lines.slice(at + 1).find(opens)?.sentAt;
  }
  const before = lines.slice(0, at).findLastIndex((line) => line.role === MESSAGE_ROLE.ASSISTANT);
  return lines.slice(before + 1, at).find(opens)?.sentAt ?? journal.startedAt;
}

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

export function workerStatusOf(state: ToolState): AgentStatus {
  if (state === TOOL_STATE.OUTPUT_AVAILABLE) return AGENT_STATUS.COMPLETED;
  return state === TOOL_STATE.OUTPUT_ERROR ? AGENT_STATUS.FAILED : AGENT_STATUS.RUNNING;
}

const TASK_ROW_ID = "task";

export function workerLines(
  task: string,
  messages: readonly AgentTranscriptMessage[],
): readonly AgentTranscriptMessage[] {
  const first = messages.find((message) => message.role === MESSAGE_ROLE.USER);
  const words = task === "" && first !== undefined ? messageWords(first) : task;
  return [
    { id: TASK_ROW_ID, role: MESSAGE_ROLE.USER, parts: [{ type: AGENT_PART.TEXT, text: words }] },
    ...messages.filter((message) => message.role !== MESSAGE_ROLE.USER),
  ];
}

export function messageWords(message: AgentTranscriptMessage): string {
  return agentParts(message)
    .flatMap((part) => (part.kind === AGENT_PART.TEXT ? [part.text] : []))
    .join("\n\n");
}

const REPLY_LEAD_WORDS = 24;

const SENTENCE_END = /[.!?](?=\s|$)/u;

export function finishedReplyLead(
  messages: readonly AgentTranscriptMessage[],
): { readonly messageId: string; readonly lead: string } | undefined {
  const reply = messages.findLast((message) => message.role === MESSAGE_ROLE.ASSISTANT);
  if (reply === undefined) return undefined;
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

export const SENT_LINE_STATE = {
  PENDING: "pending",
  FAILED: "failed",
  UNDELIVERED: "undelivered",
} as const;

type SentLineState = (typeof SENT_LINE_STATE)[keyof typeof SENT_LINE_STATE];

export interface SentLine {
  readonly id: string;
  readonly clientKey: string;
  readonly text: string;
  readonly attachments: readonly AgentAttachment[];
  readonly steers: boolean;
  readonly sentAt: number;
  readonly state: SentLineState;
  readonly rewinds?: string | undefined;
  readonly rewound?: boolean | undefined;
  readonly taken?: boolean | undefined;
}

function landedLines(messages: readonly AgentTranscriptMessage[]): ReadonlySet<string> {
  return new Set(
    messages.flatMap((message) =>
      message.role === MESSAGE_ROLE.USER && message.clientId !== undefined
        ? [message.clientId]
        : [],
    ),
  );
}

export function unreadSentLines(
  sent: readonly SentLine[],
  messages: readonly AgentTranscriptMessage[],
): readonly SentLine[] {
  const landed = landedLines(messages);
  return sent.filter((line) => line.state === SENT_LINE_STATE.UNDELIVERED || !landed.has(line.id));
}

export function heldSentLines(
  sent: readonly SentLine[],
  messages: readonly AgentTranscriptMessage[],
): readonly SentLine[] {
  const landed = landedLines(messages);
  return sent.filter((line) => line.taken !== true || !landed.has(line.id));
}

export function transcriptRowKey(message: AgentTranscriptMessage): string {
  return message.role === MESSAGE_ROLE.USER ? (message.clientId ?? message.id) : message.id;
}

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

export function openingLineOf(words: {
  readonly key: string;
  readonly prompt: string;
  readonly attachments: readonly AgentAttachment[];
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

export function unreadOpeningLine(
  opening: SentLine | undefined,
  messages: readonly AgentTranscriptMessage[],
): SentLine | undefined {
  if (opening === undefined) return undefined;
  return messages.some((message) => message.role === MESSAGE_ROLE.USER) ? undefined : opening;
}

export function agentLines(
  messages: readonly AgentTranscriptMessage[],
  sent: readonly SentLine[],
): readonly AgentTranscriptMessage[] {
  return [...messages, ...sent.map(sentLineMessage)];
}

export const PULL_REQUEST_STATE_LABEL = {
  [PULL_REQUEST_STATE.OPEN]: "Open",
  [PULL_REQUEST_STATE.DRAFT]: "Draft",
  [PULL_REQUEST_STATE.MERGED]: "Merged",
  [PULL_REQUEST_STATE.CLOSED]: "Closed",
} as const satisfies Record<PullRequestState, string>;

const BARE_SHELL_WORD = /^[\w./-]+$/u;

function shellWord(word: string): string {
  return BARE_SHELL_WORD.test(word) ? word : `'${word.replaceAll("'", "'\\''")}'`;
}

export function checkoutCommand(branch: string): string {
  const name = shellWord(branch);
  return `git fetch origin ${name} && git switch ${name}`;
}

function githubPath(name: string): string {
  return encodeURIComponent(name).replaceAll("%2F", "/");
}

export function publishedUrl(published: AgentPullRequestAnswer): string | undefined {
  if (published.pullRequest !== null) return published.pullRequest.url;
  if (published.branch === null || published.repository === null) return undefined;
  return `https://github.com/${published.repository}/compare/${githubPath(published.branch)}?expand=1`;
}

export function pullRequestNumberLabel(pullRequest: Pick<AgentPullRequest, "number">): string {
  return `#${pullRequest.number}`;
}

export function pullRequestStateWord(
  pullRequest: Pick<AgentPullRequest, "state" | "queued">,
): string | undefined {
  const { state } = pullRequest;
  if (state !== PULL_REQUEST_STATE.OPEN) return PULL_REQUEST_STATE_LABEL[state];
  return pullRequest.queued === true ? QUEUED_LABEL : undefined;
}

export const QUEUED_LABEL = "Queued";

export function queuedLabel(position: number | undefined): string {
  return position === undefined ? QUEUED_LABEL : `${QUEUED_LABEL} #${position}`;
}

export function pullRequestStateLabel(
  pullRequest: Pick<AgentPullRequest, "state" | "queued">,
): string {
  return pullRequestStateWord(pullRequest) ?? PULL_REQUEST_STATE_LABEL[pullRequest.state];
}

export function pullRequestPillLabel(
  pullRequest: Pick<AgentPullRequest, "number" | "state">,
): string {
  return `Pull request ${pullRequestNumberLabel(pullRequest)}, ${PULL_REQUEST_STATE_LABEL[pullRequest.state].toLowerCase()}`;
}
