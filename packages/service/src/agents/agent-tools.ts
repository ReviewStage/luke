import type { DatabaseServices } from "@repo/database/core/query";
import {
  type Agent,
  type AgentLatestTurn,
  awaitingLinesOfReached,
  continuationsOf,
  latestTurnsOfReached,
  type NativeRoute,
  nativeRouteOfReached,
  RUNNING_TURN_STATUSES,
  readAgent,
  readAgentByKey,
  taskNamesOf,
} from "@repo/database/models/agent-store";
import { currentAutomationRun } from "@repo/database/models/automation-store";
import { type Device, devicesSeenSince } from "@repo/database/models/device-store";
import {
  listJournals,
  messageSeqOf,
  newestJournalsOfReached,
  type StoredMessageRecord,
  turnStoppedUnderReached,
} from "@repo/database/models/message-reads";
import { readPageById } from "@repo/database/models/task-pages";
import { lockTasksForBlocks } from "@repo/database/models/task-block-store";
import { listTaskSections, writeTaskSections } from "@repo/database/models/task-section-store";
import {
  deleteTask,
  listTasks,
  readTask,
  type StoredTask,
  setTaskParent,
  type TaskChanges,
} from "@repo/database/models/task-store";
import { isWorkspaceMember } from "@repo/database/models/workspace-store";
import type { StoreWriter } from "@repo/database/models/writer";
import type { StoredArchive } from "@repo/database/schemas/agent";
import { START_NOTE_HEADING } from "@repo/features/agent-replay";
import {
  harnessNameOf,
  runtimeChoiceRefusal,
  runtimeChoiceRefusalWords,
  runtimeModels,
} from "@repo/features/agent-runtime-models";
import {
  ADDED_REPOSITORY_CHECKOUT,
  AGENT_ARCHIVER,
  AGENT_BOUNDS,
  AGENT_MACHINE,
  AGENT_STATUS,
  type AgentAlsoRepository,
  type AgentFailure,
  type AgentPullRequestAnswer,
  type AgentRunsOnRequest,
  type AgentStartFrom,
  type AgentStatus,
  agentRunsOnRequestSchema,
  contextWindowSchema,
  disabledServersSchema,
  EXTRA_REPOSITORY_REFUSAL,
  type ExtraRepositoryRefusal,
  LOCAL_AGENT_REFUSAL,
  type LocalAgentRefusal,
  MAC_PRESENCE,
  type RefusedDevice,
  startBranchSchema,
} from "@repo/features/agent-wire";
import { deviceAgentRegisterRequestSchema } from "@repo/features/device-agent-wire";
import { githubRepositoryFullNameSchema } from "@repo/features/github-repositories-wire";
import { MENTION_KIND } from "@repo/features/mention-link";
import { agentName, modelLabel } from "@repo/features/model-label";
import { type ModelChoice, modelChoiceSchema } from "@repo/features/models-wire";
import { PAGE_OWNER, type PageOwner } from "@repo/features/page-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { TASK_SECTION_WRITE } from "@repo/features/task-section-wire";
import {
  DESCRIPTION_ACTOR,
  TASK_BOUNDS,
  TASK_PRIORITY,
  TASK_STATUS,
  type TaskSummary,
  taskPrioritySchema,
  taskStatusSchema,
} from "@repo/features/task-wire";
import { taskKey } from "@repo/features/workspace-key";
import { describeWire } from "@repo/wire/effect";
import { isTextUIPart } from "ai";
import { Clock, Data, Effect, Option, Result, Schema } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import { SqlClient } from "effect/sql";
import {
  ACTION_RESULT_STATUS,
  HOSTED_API_ERROR,
  isStoredToolPart,
  MESSAGE_ROLE,
  type StoredUIMessage,
  type UnparsedWireValue,
  type WireRecord,
  wireUuidSchema,
} from "../core.js";
import { SERVER_TASK_SOURCE } from "../events/server-events.js";
import type { GitHubApp } from "../github/github-app.js";
import { ownAgentWorkspace, taskWorkspace } from "../github/workspace-repository.js";
import { type HostedRefusal, hostedStoreOrUnavailable } from "../http/http-effect.js";
import { logStoreFailure, type StoreFailure } from "../http/store-failure.js";
import {
  ModelCatalog,
  ModelChoiceRefused,
  type OfferedModel,
  validateModelChoice,
} from "../providers/model-catalog.js";
import { taskChangeAsked, taskChangeSettled, taskChangeWritten } from "../tasks/task-change.js";
import { createTaskAsked } from "../tasks/task-create-relation.js";
import { archivedAgent, changedAgent } from "./agent-change.js";
import { agentStarterName, controlsAgent } from "./agent-reach.js";
import { AGENT_TOOL } from "./agent-runtime/tools.js";
import { calledId } from "./called-id.js";
import { addAgentRepository, addedRepositoryLine } from "./coder-host/agent-repository-add.js";
import {
  forwardedImageRefusalWords,
  forwardedImages,
  type ImageForwarder,
} from "./coder-host/forwarded-images.js";
import { agentPublished } from "./coder-host/published.js";
import { callEntry } from "./coder-host/replay.js";
import type { SummaryModelOf } from "./coder-host/replay-summary.js";
import {
  accountModelChoices,
  placeOfAgent,
  type StartWhere,
  startAgent,
} from "./coder-host/start.js";
import { agentFailureOf, agentStatusOf, startedBlank } from "./coder-host/status.js";
import { stoppedAgent, standingsOf as turnStandingsOf } from "./coder-host/stop.js";
import { CODER_TOOL_SET } from "./coder-host/tool-set.js";
import type { AgentSessions } from "./eve-host/eve-sessions.js";
import { deploymentSandboxStops } from "./session-sandboxes.js";
import {
  assigneeIdOf,
  assigneeMentionOf,
  TASK_ASSIGNEE_INPUT,
  taskAssigneeWrittenSchema,
} from "./task-assignee.js";
import {
  BLOCKED_BY_INPUT,
  BLOCKS_INPUT,
  blockChangesNamed,
  blockWritesAsked,
  taskBlockReadingsNow,
  tasksOfWrites,
  writeTaskBlocks,
} from "./task-block-changes.js";
import {
  AGENT_LIST_INPUT,
  type AgentTask,
  type AgentTaskReading,
  agentTaskOf,
  listedFilter,
  taskReading,
  WORKSPACE_AGENTS_LIST_LIMIT,
  workspaceAgent,
  workspaceAgentsOf,
} from "./workspace-agents.js";
import {
  workspaceNamingOf,
  workspaceStepOf,
  writtenMention,
  writtenPageMention,
  writtenTaskMention,
} from "./written-mentions.js";

export const TASKS_LIST_LIMIT = 50;

export const AGENT_TOOL_BOUNDS = {
  TAIL_TURNS: 3,
  TAIL_ENTRIES: 20,
  MAX_TAIL_ENTRIES: 50,
  AGENT_ENTRY_CHARS: 800,
  ACTIVITY_CHARS: 160,
} as const;

export const AGENT_TOOL_REFUSAL = {
  UNREADABLE: `Not run: name the agent by the id ${AGENT_TOOL.LIST_AGENTS} answered.`,
  UNREADABLE_TASKS:
    "Not run: narrow the tasks by words of their name, by a status " +
    `(${Object.values(TASK_STATUS).join(", ")}), and by an assignee as a member's mention link ` +
    "or null, and page them by an offset of 0 or more.",
  NO_AGENT: `Not run: no agent of your workspace has that id; ${AGENT_TOOL.LIST_AGENTS} names them.`,
  NO_WORKSPACE:
    "Not run: your workspace could not be read for you, so no agent is reached from here.",
  STORE: "Not run: the agents could not be read just now. The call may be made again.",
} as const;

export const TASK_PRIORITY_WORDS =
  "How much the task matters; none for a task no one has weighed yet.";

export const UPDATE_TASK_REFUSAL = {
  UNREADABLE:
    `Not run: name the task by the id ${AGENT_TOOL.LIST_TASKS} or ${AGENT_TOOL.LIST_AGENTS} answered, ` +
    `and at least one change: a name of at most ${TASK_BOUNDS.MAX_NAME_CHARS} characters, a ` +
    "repository as owner/name or null, pinned, a sectionId or null, a status " +
    `(${Object.values(TASK_STATUS).join(", ")}), a priority ` +
    `(${Object.values(TASK_PRIORITY).join(", ")}), an assignee as a member's mention link or ` +
    "null, a parentTaskId or null, or tasks to add to or take away from its blockedBy or blocks.",
  NO_TASK:
    "Not run: no task of your workspace has that id, so it is none you can change; " +
    `${AGENT_TOOL.LIST_TASKS} names them.`,
  NOT_MEMBER:
    "Not run: that assignee is no member of the task's workspace, or names no person; name a " +
    `member by the mention link ${AGENT_TOOL.LIST_TASKS} hands you, or null for no one.`,
  NOT_REACHABLE:
    "Not run: the GitHub installation connected to the workspace does not reach that " +
    "repository; name one it reaches, or null for none.",
  GITHUB_UNANSWERED:
    "Not run: GitHub did not answer whether the workspace reaches that repository. The call " +
    "may be made again.",
  TREE_REPOSITORY:
    "Not run: a task with a parent or with children works in its tree's repository, so it " +
    "cannot be given another; leave the repository as it is.",
  NO_SECTION:
    "Not run: the developer you work for keeps no section of this workspace under that id; " +
    `${AGENT_TOOL.LIST_TASKS} names the sections.`,
  NO_PARENT:
    "Not run: no task of your workspace has that id to be its parent; " +
    `${AGENT_TOOL.LIST_TASKS} names them, or null takes it out from under its parent.`,
  PARENT_REPOSITORY:
    "Not run: a child task always works in its parent's repository, so a task cannot be put " +
    "under a parent working in another; leave the parent as it is.",
  PARENT_CYCLE:
    "Not run: that parent is the task itself or one of its sub-tasks, under which the task " +
    "would descend from itself; take that task out from under this one first.",
  ARCHIVE_NOT_READY:
    "Not run: an agent of that task is still starting or has a message waiting, so archiving " +
    "the task would stop a turn no one could name yet; call again in a moment.",
} as const;

export const STOP_AGENT_REFUSAL = {
  UNREADABLE: `Not run: name the agent by the id ${AGENT_TOOL.LIST_AGENTS} answered.`,
  SELF: "Not stopped: that id is your own, and an agent does not stop itself; end your turn by finishing it.",
  UNAVAILABLE:
    "Not stopped: the service could not reach that agent's session just now. The call may be made again.",
  NATIVE_NOT_HERE:
    "Not stopped: that agent runs on Claude Code or Codex, which cannot be reached from here yet; a member stops it from the agent's own tab.",
} as const;

export const READ_PAGE_CHARS = 40_000;

export const READ_PAGE_REFUSAL = {
  UNREADABLE:
    "Not read: name the page by its id, and a version as a whole number from 1, or none for the newest.",
  NO_PAGE:
    "Not read: no page of a task of your workspace has that id, or that page has no such version.",
} as const;

const IN_THE_CLOUD_WORDS = JSON.stringify({ machine: AGENT_MACHINE.VERCEL });

export const START_AGENT_REFUSAL = {
  UNREADABLE:
    "Not started: give a prompt as text of at most " +
    `${AGENT_BOUNDS.MAX_START_WORDS_CHARS} characters, or none to start on the description, a note ` +
    `bounded the same or none, a title of at most ${AGENT_BOUNDS.MAX_TITLE_CHARS} ` +
    "characters or none, a branch as one git branch name or none, alsoRepositories as at most " +
    `${AGENT_BOUNDS.MAX_ALSO_REPOSITORIES} repositories as owner/name, each with a branch or ` +
    "none, or none, a model with its effort, " +
    "both or neither, a taskId or none, a repository as owner/name, null, or none, runsOn as " +
    `${IN_THE_CLOUD_WORDS}, a device of the member's by its name or its id, or none, and images as ` +
    `at most ${AGENT_BOUNDS.MAX_ATTACHMENTS} attachment ids or none.`,
  NO_PROMPT:
    "Not started: you work on no task, so there is no description to hand it; give it a prompt, or name " +
    `a task by its taskId, as ${AGENT_TOOL.LIST_TASKS} answered it.`,
  NO_WORKSPACE:
    "Not started: the member you work for is no longer a member of your workspace, so no task " +
    "can be made for the agent there.",
  BRANCH_NO_REPOSITORY:
    "Not started: the agent works in no repository, so there is no branch to clone; name a " +
    "repository with the branch, or leave branch out.",
  REPOSITORY_ON_TASK:
    "Not started: an agent on a task works in the task's own repository; leave repository out " +
    "where you start it on a task, or from another agent.",
  NEW_TASK:
    `Not started: start_agent no longer makes a task; make it with ${AGENT_TOOL.CREATE_TASK}, then ` +
    "start the agent on it by its taskId.",
  NO_SUCH_TASK: `Not started: no task of your workspace has that id; ${AGENT_TOOL.LIST_TASKS} names them.`,
  NO_BRANCH:
    "Not started: the task's repository has no such branch on GitHub. Push it first, or name a " +
    "branch that exists there, such as the head branch of the pull request to build on; leave " +
    "branch out to start on the default branch.",
  GITHUB_UNANSWERED:
    "Not started: GitHub did not answer whether the branch exists. The call may be made again.",
  NOT_REACHABLE:
    "Not started: the GitHub installation connected to the workspace does not reach the repository the agent would work in.",
  UNAVAILABLE:
    "Not started: the service could not start an agent just now. The call may be made again.",
  PLAN_SIGNED_OUT:
    "Not started: the plan that would pay for it is signed out; its starter signs in again in Settings.",
  PLAN_UNREACHABLE:
    "Not started: the plan's provider did not answer; start it again in a minute or two.",
  PLAN_LIMIT_REACHED:
    "Not started: the plan that would pay for it has reached its usage limit; start it after the limit resets, or its starter chooses the API key in Settings.",
  PLAN_INELIGIBLE:
    "Not started: the plan's provider said the account is not eligible to run it; its starter chooses the API key in Settings.",
  CREDENTIAL_MISSING: `Not started: no subscription or API key of its starter's pays for that model, and ${PRODUCT_NAME}'s key pays for no agent; its starter connects one in Settings › Agents, or start it on a model whose provider is connected.`,
  API_KEY_UNREADABLE:
    "Not started: the API key that would pay for it is saved but cannot be read here; its starter saves it again in Settings › Agents.",
  ALSO_NO_REPOSITORY:
    "Not started: the agent works in no repository of its own for alsoRepositories to stand " +
    "beside; name its repository, or leave alsoRepositories out.",
  DEVICE_REMOVED: `Not started: the host it would run on was removed. Start it in the cloud with runsOn ${IN_THE_CLOUD_WORDS}, or ask the member to add the host again.`,
  NO_DEVICES: `Not started: the member has no device registered to run agents on. Start it in the cloud with runsOn ${IN_THE_CLOUD_WORDS}, or ask the member to add a Mac or a host in Settings › Hosts.`,
  NO_SOURCE:
    "Not started: no agent of your workspace has that id to start from; " +
    `${AGENT_TOOL.LIST_AGENTS} names them.`,
  SOURCE_OTHER_TASK:
    "Not started: that agent works on another task than the taskId named, or on none; leave " +
    "taskId out to start where it works.",
  FROM_WITH_PROMPT:
    "Not started: an agent started from another is handed that agent's brief, transcript, and " +
    "work on that agent's own task, so it takes no prompt, no branch, and no new task; put what it " +
    "should hear beyond them in the note.",
  NO_MESSAGE:
    "Not started: that messageId is none of that agent's own messages; " +
    `${AGENT_TOOL.READ_AGENT} names each entry's messageId. Leave messageId out to continue it.`,
  SELF_CONTINUE:
    "Not started: an agent does not continue itself, since you are still here to go on; to try " +
    "another direction from one of your own messages, fork yourself at its messageId.",
  PILOT_OFF:
    "Not started: that task is worked in pilot mode and has no pilot, so this agent would be its " +
    "pilot, and Pilot is off for the member you start for. Ask them to turn it on in Settings › " +
    "Experimental.",
  STARTER_CONTINUE:
    "Not started: you can't continue an agent that started you, directly or through the agents " +
    "between you, since the agents it started would report to a pilot you started; tell its " +
    "starter, or ask a member to continue it.",
  SOURCE_RUNNING:
    "Not started: that agent is still starting or working, and a continue would take over work " +
    "it is still doing. Wait until it ends, message it, or fork it at a messageId to try another " +
    "direction beside it. Where it went quiet and should go on in a new agent, its session dead " +
    `while it still reads running among them, stop it with ${AGENT_TOOL.STOP_AGENT} and call again.`,
} as const;

export const LIST_MODELS_REFUSAL = {
  UNAVAILABLE: "Not listed: the models could not be read just now. The call may be made again.",
  UNREADABLE: `Not listed: name an agent, if any, by the id ${AGENT_TOOL.LIST_AGENTS} answered.`,
} as const;

const START_REFUSAL_WORDS: ReadonlyMap<string, string> = new Map([
  [HOSTED_API_ERROR.NO_REPOSITORY, START_AGENT_REFUSAL.BRANCH_NO_REPOSITORY],
  [HOSTED_API_ERROR.BRANCH_NOT_FOUND, START_AGENT_REFUSAL.NO_BRANCH],
  [HOSTED_API_ERROR.GITHUB_UNANSWERED, START_AGENT_REFUSAL.GITHUB_UNANSWERED],
  [HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE, START_AGENT_REFUSAL.NOT_REACHABLE],
  [HOSTED_API_ERROR.AGENT_PLAN_SIGNED_OUT, START_AGENT_REFUSAL.PLAN_SIGNED_OUT],
  [HOSTED_API_ERROR.AGENT_PLAN_UNREACHABLE, START_AGENT_REFUSAL.PLAN_UNREACHABLE],
  [HOSTED_API_ERROR.AGENT_PLAN_LIMIT_REACHED, START_AGENT_REFUSAL.PLAN_LIMIT_REACHED],
  [HOSTED_API_ERROR.AGENT_PLAN_INELIGIBLE, START_AGENT_REFUSAL.PLAN_INELIGIBLE],
  [HOSTED_API_ERROR.AGENT_CREDENTIAL_MISSING, START_AGENT_REFUSAL.CREDENTIAL_MISSING],
  [HOSTED_API_ERROR.AGENT_API_KEY_UNREADABLE, START_AGENT_REFUSAL.API_KEY_UNREADABLE],
  [HOSTED_API_ERROR.DEVICE_REMOVED, START_AGENT_REFUSAL.DEVICE_REMOVED],
]);

const LOCAL_AGENT_REFUSAL_WORDS = {
  [LOCAL_AGENT_REFUSAL.MAC_AWAY]: `Not started: the device it would run on is offline, so it cannot take an agent (its vespin-host is not connected). Try again once it is back, or start it in the cloud with runsOn ${IN_THE_CLOUD_WORDS}.`,
  [LOCAL_AGENT_REFUSAL.CODEX]: `Not started: the device it would run on has no Codex set up yet, so it cannot run this model. Start on a Claude model, or in the cloud with runsOn ${IN_THE_CLOUD_WORDS}.`,
  [LOCAL_AGENT_REFUSAL.NO_HARNESS]: `Not started: the device it would run on cannot run this model. Start on another model, or in the cloud with runsOn ${IN_THE_CLOUD_WORDS}.`,
  [LOCAL_AGENT_REFUSAL.PREPARING]: `Not started: the device it would run on is still getting ready for local agents, downloading Claude Code, Codex, and GitHub's CLI. Try again in a few minutes, or start it in the cloud with runsOn ${IN_THE_CLOUD_WORDS}.`,
  [LOCAL_AGENT_REFUSAL.SETUP_FAILED]: `Not started: the device it would run on couldn't set up local agents, since its download of Claude Code, Codex, or GitHub's CLI failed. Ask the member to turn Bring your own host off and on in Settings › Hosts on that Mac, or to restart vespin-host on that Linux server, to try again, or start it in the cloud with runsOn ${IN_THE_CLOUD_WORDS}.`,
  [LOCAL_AGENT_REFUSAL.GITHUB_SIGN_IN]: `Not started: the repository is reached on the member's own GitHub token, and the device it would run on has a vespin-host too old to work in such a repository on its own GitHub sign-in. Ask the member to update that host, or start it in the cloud with runsOn ${IN_THE_CLOUD_WORDS}.`,
} as const satisfies Record<
  Exclude<LocalAgentRefusal, typeof LOCAL_AGENT_REFUSAL.NOT_OWNER>,
  string
>;

const EXTRA_REPOSITORY_WHY = {
  device: "an agent in several repositories runs only in the cloud.",
  token: (named: string) =>
    `${named} is reached only on the member's own GitHub token, and an agent's repositories are all reached through the GitHub App.`,
  otherInstallation: (named: string) =>
    `${named} is on another GitHub account's installation of the App than the agent's own repository, and one agent's repositories share one.`,
} as const;

function extraRepositoryWords(
  refusal: ExtraRepositoryRefusal,
  repository: string | undefined,
): string {
  const named = repository ?? "One of the repositories";
  switch (refusal) {
    case EXTRA_REPOSITORY_REFUSAL.NO_REPOSITORY:
      return START_AGENT_REFUSAL.ALSO_NO_REPOSITORY;
    case EXTRA_REPOSITORY_REFUSAL.DEVICE:
      return `Not started: ${EXTRA_REPOSITORY_WHY.device} Start it with runsOn ${IN_THE_CLOUD_WORDS}, or leave alsoRepositories out.`;
    case EXTRA_REPOSITORY_REFUSAL.TOKEN:
      return `Not started: ${EXTRA_REPOSITORY_WHY.token(named)} Leave it out, or ask the member to give the workspace's GitHub App access to it.`;
    case EXTRA_REPOSITORY_REFUSAL.OTHER_INSTALLATION:
      return `Not started: ${EXTRA_REPOSITORY_WHY.otherInstallation(named)} Leave it out, or start a separate agent for it.`;
    case EXTRA_REPOSITORY_REFUSAL.ALREADY:
    case EXTRA_REPOSITORY_REFUSAL.FULL:
    case EXTRA_REPOSITORY_REFUSAL.HEARD_ANOTHER_ACCOUNT:
      return START_AGENT_REFUSAL.UNREADABLE;
  }
}

function addedRepositoryWords(
  refusal: ExtraRepositoryRefusal,
  repository: string | undefined,
): string {
  const named = repository ?? "That repository";
  switch (refusal) {
    case EXTRA_REPOSITORY_REFUSAL.NO_REPOSITORY:
      return `${ADD_REPOSITORY_LEAD}: that agent works in no repository of its own for another to stand beside. Start a new agent in the repository instead.`;
    case EXTRA_REPOSITORY_REFUSAL.DEVICE:
      return `${ADD_REPOSITORY_LEAD}: ${EXTRA_REPOSITORY_WHY.device} That agent runs on a device; start an agent in the cloud for it instead.`;
    case EXTRA_REPOSITORY_REFUSAL.TOKEN:
      return `${ADD_REPOSITORY_LEAD}: ${EXTRA_REPOSITORY_WHY.token(named)} Ask the member to give the workspace's GitHub App access to it.`;
    case EXTRA_REPOSITORY_REFUSAL.OTHER_INSTALLATION:
      return `${ADD_REPOSITORY_LEAD}: ${EXTRA_REPOSITORY_WHY.otherInstallation(named)} Start a separate agent for it.`;
    case EXTRA_REPOSITORY_REFUSAL.ALREADY:
      return `${ADD_REPOSITORY_LEAD}: ${named} is already among that agent's repositories, so nothing changed.`;
    case EXTRA_REPOSITORY_REFUSAL.FULL:
      return `${ADD_REPOSITORY_LEAD}: that agent already works in ${AGENT_BOUNDS.MAX_ALSO_REPOSITORIES} repositories beside its own, the most it may. Start a separate agent for it.`;
    case EXTRA_REPOSITORY_REFUSAL.HEARD_ANOTHER_ACCOUNT:
      return `${ADD_REPOSITORY_LEAD}: your conversation holds words from another account than the member's, so you may not widen what any agent's token reaches. Ask the developer to add it from the agent's menu.`;
  }
}

function notOwnerWords(device: RefusedDevice | undefined): string {
  const where = device === undefined ? "another member's device" : device.name;
  const who = device?.owner ?? "its owner";
  return `Not started: it would run on ${where}. Only ${who} can start agents on it, so ask them to, or start it in the cloud with runsOn ${IN_THE_CLOUD_WORDS}.`;
}

function listedDevice(device: Device, now: number): string {
  const online = device.lastSeenAt.getTime() >= now - MAC_PRESENCE.FRESH_MS;
  return `${JSON.stringify(device.name)} (deviceId ${device.id}, ${online ? "online" : "away"})`;
}

function deviceNameRefusal(
  name: string,
  matched: number,
  devices: readonly Device[],
  now: number,
): string {
  if (devices.length === 0) return START_AGENT_REFUSAL.NO_DEVICES;
  const named = JSON.stringify(name);
  const why =
    matched === 0
      ? `no device of the member's is named ${named}`
      : `${matched} devices of the member's are named ${named}, so name the one you mean by its deviceId`;
  const listed = devices.map((device) => listedDevice(device, now)).join("; ");
  return `Not started: ${why}. Their devices: ${listed}. Name one by its name or its deviceId, or start it in the cloud with runsOn ${IN_THE_CLOUD_WORDS}.`;
}

export const AGENT_CALLER = {
  AGENT: "agent",
  MEMBER: "member",
} as const;

export type AgentCaller =
  | { readonly kind: typeof AGENT_CALLER.AGENT; readonly agent: Agent }
  | {
      readonly kind: typeof AGENT_CALLER.MEMBER;
      readonly userId: string;
      readonly workspaceId: string;
      readonly clientId: string;
    };

export interface AgentCall {
  readonly caller: AgentCaller;
  readonly eve: AgentSessions;
  readonly eveAs: (account: string) => AgentSessions;
  readonly writer: Effect.Effect<StoreWriter>;
  readonly clientKey: string;
  readonly summaryModel?: SummaryModelOf | undefined;
}

export type AgentReadCall = Pick<AgentCall, "caller">;

export type AgentToolServices = DatabaseServices | HttpClient.HttpClient | GitHubApp | ModelCatalog;

const AGENT_ID = describeWire(
  wireUuidSchema,
  `The agent's id, as ${AGENT_TOOL.LIST_AGENTS} answered it or a message from it named it.`,
);

const READ_AGENT_INPUT = Schema.Struct({ agentId: AGENT_ID });

const LIST_MODELS_INPUT = Schema.Struct({
  agentId: Schema.optionalKey(
    describeWire(
      wireUuidSchema,
      `An agent of your workspace, by the id ${AGENT_TOOL.LIST_AGENTS} answered, to list what it ` +
        `may move to with ${AGENT_TOOL.UPDATE_AGENT}; leave it out for what a start takes.`,
    ),
  ),
});

const readListModelsAsked = Schema.decodeUnknownResult(LIST_MODELS_INPUT);

const CODER_READ_AGENT_INPUT = Schema.Struct({
  agentId: AGENT_ID,
  entries: Schema.optionalKey(
    describeWire(
      Schema.Int.check(
        Schema.isBetween({ minimum: 1, maximum: AGENT_TOOL_BOUNDS.MAX_TAIL_ENTRIES }),
      ),
      "How many entries of its transcript to read, the newest last; " +
        `${AGENT_TOOL_BOUNDS.TAIL_ENTRIES} when left out, at most ` +
        `${AGENT_TOOL_BOUNDS.MAX_TAIL_ENTRIES}.`,
    ),
  ),
});

function megabytesOf(bytes: number): string {
  return `${bytes / 1_000_000} MB`;
}

const START_PROMPT = Schema.Trim.check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(AGENT_BOUNDS.MAX_START_WORDS_CHARS),
);

const START_TITLE = Schema.Trim.check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(AGENT_BOUNDS.MAX_TITLE_CHARS),
);

const START_BRANCH = startBranchSchema;

const START_RUNS_ON = Schema.Union([
  ...agentRunsOnRequestSchema.members,
  Schema.Struct({
    machine: Schema.Literal(AGENT_MACHINE.DEVICE),
    device: deviceAgentRegisterRequestSchema.fields.name,
  }),
]);

const START_AGENT_INPUT = Schema.Struct({
  taskId: Schema.optionalKey(
    describeWire(
      wireUuidSchema,
      `The task to start the agent on, by the id ${AGENT_TOOL.LIST_TASKS} answered; leave it out ` +
        "for the task you work on.",
    ),
  ),
  repository: Schema.optionalKey(
    describeWire(
      Schema.NullOr(githubRepositoryFullNameSchema),
      "Where you work on no task and name none, the GitHub repository of the task made for the " +
        "agent, as owner/name, which the workspace's GitHub installation must reach; null for " +
        "none. Leave it out for the repository you work in, if any. A task's agent works in the " +
        "task's own.",
    ),
  ),
  prompt: Schema.optionalKey(
    describeWire(
      START_PROMPT,
      "What the agent should do, typed to it as its first message; the developer's words where " +
        "they named the job. Leave it out to start the agent on the task's description itself.",
    ),
  ),
  note: Schema.optionalKey(
    describeWire(
      START_PROMPT,
      "Everything else the agent should hear as it starts (what to start with, what to watch out " +
        "for, what to leave alone), handed to it after the description or the prompt in the same first " +
        "message; leave it out where there is nothing beyond the description.",
    ),
  ),
  images: Schema.optionalKey(
    describeWire(
      Schema.Array(wireUuidSchema).check(Schema.isMaxLength(AGENT_BOUNDS.MAX_ATTACHMENTS)),
      "Pictures handed to the agent with its first message, which it sees as images: at most " +
        `${AGENT_BOUNDS.MAX_ATTACHMENTS} attachment ids, each a picture of your own ` +
        `conversation, such as one ${AGENT_TOOL.SHOW_IMAGE} kept; each at most ${megabytesOf(AGENT_BOUNDS.MAX_IMAGE_BYTES)} and all of them ` +
        `${megabytesOf(AGENT_BOUNDS.MAX_ATTACHMENTS_BYTES)} together, since a larger one is ` +
        "refused, never made smaller. Leave it out to hand none.",
    ),
  ),
  title: Schema.optionalKey(
    describeWire(
      START_TITLE,
      "The agent's title from the start, how the developer sees it named, such as the pull " +
        "request it will open; leave it out to have it named from what it is told.",
    ),
  ),
  branch: Schema.optionalKey(
    describeWire(
      START_BRANCH,
      "The branch of the task's repository to clone the agent's checkout at and cut its own " +
        "branch from, such as the head branch of a pull request it builds on; it must already be " +
        "on GitHub. Leave it out for the repository's default branch.",
    ),
  ),
  alsoRepositories: Schema.optionalKey(
    describeWire(
      Schema.Array(
        Schema.Struct({
          repository: describeWire(
            githubRepositoryFullNameSchema,
            "The repository, as owner/name.",
          ),
          branch: Schema.optionalKey(
            describeWire(
              START_BRANCH,
              "The branch to clone its checkout at, which must already be on GitHub; leave it " +
                "out for its default branch.",
            ),
          ),
        }),
      ).check(Schema.isMinLength(1), Schema.isMaxLength(AGENT_BOUNDS.MAX_ALSO_REPOSITORIES)),
      "Other repositories the agent works in beside its own, each checked out in a folder of " +
        "its own beside its checkout, which its instructions name: each reached through the " +
        "GitHub App installation its own repository is on, and the agent in the cloud. Leave it " +
        "out for one repository.",
    ),
  ),
  model: Schema.optionalKey(
    describeWire(
      modelChoiceSchema.fields.model,
      "The model to run on, by its catalog id (such as anthropic/claude-opus-5.5); leave it out " +
        "with the effort for the member's default.",
    ),
  ),
  effort: Schema.optionalKey(
    describeWire(
      modelChoiceSchema.fields.effort,
      "The reasoning effort, as the model lists it (such as high); given with the model or not at all.",
    ),
  ),
  runsOn: Schema.optionalKey(
    describeWire(
      START_RUNS_ON,
      `Where the agent runs: ${IN_THE_CLOUD_WORDS} for the cloud, or ` +
        `${JSON.stringify({ machine: AGENT_MACHINE.DEVICE, device: "<name>" })} for one of the ` +
        "member's own devices (a Mac or a host) by its name, in any case, or " +
        `${JSON.stringify({ machine: AGENT_MACHINE.DEVICE, deviceId: "<id>" })} by its id, which ` +
        "must be registered and online; a name that matches none of the member's devices, or " +
        "more than one, is refused with their devices listed by name, id, and whether each is " +
        "online. " +
        "With from, another place than that agent's moves it there. " +
        "Leave it out for where the agent it starts from runs, with from; else where the " +
        "member's newest agent on the task runs; else where the member last chose to run one; " +
        "else the cloud.",
    ),
  ),
  from: Schema.optionalKey(
    describeWire(
      Schema.Struct({
        agentId: describeWire(
          wireUuidSchema,
          `The agent to start from, by the id ${AGENT_TOOL.LIST_AGENTS} answered.`,
        ),
        messageId: Schema.optionalKey(
          describeWire(
            wireUuidSchema,
            `One of that agent's messages, by the messageId ${AGENT_TOOL.READ_AGENT} names on ` +
              "an entry of its tail, to fork it there; leave it out to continue the agent from " +
              "where it stands.",
          ),
        ),
      }),
      "Another agent of your workspace to take over from, on its own task, or on no " +
        "task where it has none: the new " +
        `agent is handed its brief and its transcript (with ${PRODUCT_NAME}'s summary of the steps that ` +
        "do not fit) and a copy of its work, runs on its model unless you name one, and hears " +
        "the note after them; it takes no prompt and no branch. Without messageId it continues " +
        "the agent, which is stopped; with one it forks the agent at that message, which goes on.",
    ),
  ),
});

const readAgentRef = Schema.decodeUnknownResult(READ_AGENT_INPUT);
const readAgentAsked = Schema.decodeUnknownResult(CODER_READ_AGENT_INPUT);

const UPDATE_TASK_INPUT = Schema.Struct({
  taskId: describeWire(
    wireUuidSchema,
    `The task's id, as ${AGENT_TOOL.LIST_TASKS} or ${AGENT_TOOL.LIST_AGENTS} answered it.`,
  ),
  name: Schema.optionalKey(
    describeWire(
      Schema.Trim.check(Schema.isNonEmpty(), Schema.isMaxLength(TASK_BOUNDS.MAX_NAME_CHARS)),
      "Its new name, as the sidebar shows it, which its description's heading follows.",
    ),
  ),
  repository: Schema.optionalKey(
    describeWire(
      Schema.NullOr(githubRepositoryFullNameSchema),
      "The GitHub repository its agents work in, as owner/name, which the workspace's GitHub " +
        "installation must reach; null for none.",
    ),
  ),
  pinned: Schema.optionalKey(
    describeWire(
      Schema.Boolean,
      "true to pin it in the sidebar of the developer you work for, false to unpin it; their pin " +
        "alone, no other member's.",
    ),
  ),
  status: Schema.optionalKey(describeWire(taskStatusSchema, "Where the task now stands.")),
  priority: Schema.optionalKey(describeWire(taskPrioritySchema, TASK_PRIORITY_WORDS)),
  assignee: Schema.optionalKey(TASK_ASSIGNEE_INPUT),
  sectionId: Schema.optionalKey(
    describeWire(
      Schema.NullOr(wireUuidSchema),
      "The sidebar section the developer you work for keeps it in, by the id " +
        `${AGENT_TOOL.LIST_TASKS} or ${AGENT_TOOL.CREATE_SECTION} answered; it leaves the section ` +
        "it stood in and lands at the top of this one. null takes it out of its section, back " +
        "under Tasks.",
    ),
  ),
  parentTaskId: Schema.optionalKey(
    describeWire(
      Schema.NullOr(wireUuidSchema),
      `The task to make it a child of, by the id ${AGENT_TOOL.LIST_TASKS} answered: a task of ` +
        "your workspace working in the same repository, and neither this task nor one of its " +
        "sub-tasks; where its agents run stays its own. null takes it out from under its parent, " +
        "to stand at the top.",
    ),
  ),
  blockedBy: Schema.optionalKey(BLOCKED_BY_INPUT),
  blocks: Schema.optionalKey(BLOCKS_INPUT),
});

const UPDATE_TASK_CALL = Schema.Struct({
  ...UPDATE_TASK_INPUT.fields,
  archived: Schema.optionalKey(Schema.Boolean),
});

const readTaskUpdate = Schema.decodeUnknownResult(UPDATE_TASK_CALL);
const START_AGENT_CALL = Schema.Struct({
  ...START_AGENT_INPUT.fields,
  task: Schema.optionalKey(START_PROMPT),
  newTask: Schema.optionalKey(Schema.Unknown),
});

const readStart = Schema.decodeUnknownResult(START_AGENT_CALL);

export const LIST_AGENTS_TOOL = {
  name: AGENT_TOOL.LIST_AGENTS,
  description:
    "List the agents of your workspace, on any task or none and started by any member, " +
    "yourself left out: each with its id, its title (how the developer sees it named), the model " +
    "and effort it runs on with the model's name to say it by, its status (starting, running, " +
    "completed, failed, canceled) and why where it failed, its repository and the branch its " +
    "sandbox is on if a turn " +
    "has ended, one line of what it last did, its task (id and name; null for " +
    "an agent on no task) and whether that is the task you work on, and whether the agent is " +
    "archived, and its mention, the `[@title](link)` to name it by in your words. The agents " +
    "that matter to you come first: the agent that started you and the agents you started, " +
    "then those on your task; then the rest of the workspace, the newest started first, at most " +
    `${WORKSPACE_AGENTS_LIST_LIMIT} a page, with nextOffset where more stand, which offset ` +
    "reads the next page by. Pass words to search the whole workspace by words of an agent's " +
    "title or its task's name, thisTask for only your task's agents, or a taskId for another " +
    "task's; narrow it by archived, by mine or startedBy for whose agents, by automation or " +
    "automationId for an automation's runs, and by taskStatus, such as done, for where their " +
    "task stands. Call it to find the agent you " +
    "or the developer mean. Failed covers a session that ended for good, which no message " +
    "reaches again: tell the developer, or start a new agent to go on from its work. An agent " +
    "still running long after its last activity may have lost its session; a message to it " +
    "refused as ended for good settles it as failed.",
  inputSchema: AGENT_LIST_INPUT,
} as const;

export const CODER_READ_AGENT_TOOL = {
  name: AGENT_TOOL.READ_AGENT,
  description:
    "Read one agent of your workspace by its id, on any task and started by any member: " +
    `what ${AGENT_TOOL.LIST_AGENTS} says of it, the branch it pushed and the pull request from it ` +
    "as GitHub holds them, and the tail of its transcript, what it last said and which tools it " +
    "called on what, newest last, each entry cut to " +
    `${AGENT_TOOL_BOUNDS.AGENT_ENTRY_CHARS} characters and with the messageId of the ` +
    `message it stands in, which ${AGENT_TOOL.START_AGENT}'s from names to fork the agent ` +
    "there. Read one to learn why an agent " +
    "went quiet, what it is stuck on, or what it did, before you message it or decide what " +
    "comes next. It only reads: the agent is not told. Answers `accepted` with the reading, or " +
    "`rejected` and why.",
  inputSchema: CODER_READ_AGENT_INPUT,
} as const;

export const START_AGENT_TOOL = {
  name: AGENT_TOOL.START_AGENT,
  description:
    "Start a new agent on the task you work on, or on another task of your workspace by " +
    `its taskId as ${AGENT_TOOL.LIST_TASKS} answered it, exactly as the developer would: ` +
    "on the task's description itself with no prompt, or on the prompt given in the " +
    "description's place, with the note after either and any pictures images names, which it sees as " +
    "images. Start it on the task you work on, taskId left " +
    "out, for any part of that task's work, even one that runs apart from yours, so its " +
    "branch, pull request, and transcript stand under that task; name another task only for " +
    "work unrelated to it, or where the developer asked for that, and for work that should " +
    `stand as a task of its own, make it with ${AGENT_TOOL.CREATE_TASK} first. Where you work ` +
    "on no task, taskId left out starts it on a new task made for it, named as its agent is, " +
    "assigned to the member you work for, in the repository you work in or the one repository " +
    "names, and done by itself once its agents finish well; it needs a prompt, since that task " +
    "has no description to hand it. " +
    "This one call carries everything the agent is told as " +
    "it starts, and the agent sets to work on it at once, so never follow it with a message to " +
    "the agent it started; message it only when there is something new to say. Its checkout is " +
    "the repository's default branch, or the branch named, which must already be on GitHub. " +
    "It runs on the " +
    "model and effort named, or on the member's default with neither. Answers `accepted` with " +
    "the agent's id, model, the model's name to say it by, effort, status, and mention once its session " +
    "is open, or `rejected` and why " +
    "nothing was started; a rejected model or effort lists the choices. " +
    `${AGENT_TOOL.LIST_MODELS} lists them before you name one. With from, it starts from ` +
    "another agent instead: continue an agent (or worker) " +
    "that failed, ended, or ran out of context, which is handed over and stopped, or fork one " +
    "at a messageId to try another direction while it goes on. An agent already continued may " +
    "be continued again, and the answer then names the earlier continuations by their id and " +
    "mention (earlierContinuations). A start from another agent " +
    "copies its work and summarizes its transcript, so it may take a minute to answer.",
  inputSchema: START_AGENT_INPUT,
} as const;

export const LIST_MODELS_TOOL = {
  name: AGENT_TOOL.LIST_MODELS,
  description:
    `List the models you may start an agent on with ${AGENT_TOOL.START_AGENT}, as the ` +
    `member you act for is offered them: each with its catalog id, which ${AGENT_TOOL.START_AGENT}'s ` +
    "model takes, the model's name to say it by, and the efforts it lists, one of which its " +
    "effort takes; and the member's default model and effort, which a start naming neither runs " +
    "on, and whether it is still offered. Call it before you name a model or an effort to " +
    `${AGENT_TOOL.START_AGENT}, such as one the developer named in their own words. Name an ` +
    `agentId to list instead what that agent may move to with ${AGENT_TOOL.UPDATE_AGENT}: an ` +
    "agent on Claude Code runs Claude models alone, and one on Codex GPT models alone, with no " +
    "fast version.",
  inputSchema: LIST_MODELS_INPUT,
} as const;

export const UPDATE_TASK_TOOL = {
  name: AGENT_TOOL.UPDATE_TASK,
  description:
    "Change a task of your workspace by its id, as the developer's own task menu would, on behalf " +
    "of the developer you work for: rename it, set or clear its repository, set where it stands " +
    "(its status) or how much it matters (its priority), assign it to a member of the " +
    "workspace or to no one, pin or unpin it in their sidebar, move it into one of their sidebar " +
    "sections or back out of it (sectionId), put it under a parent task or " +
    "take it out from under one, or add and take away the tasks " +
    "it is blocked by and the tasks it blocks; name at least one change, " +
    "and several go in one call. Mark a task whose work is " +
    "done Done, with status done, as the menu's Mark done does, such as one whose pull requests " +
    "merged, or one the developer asked you to clean up; that withdraws every ask still open on its " +
    "threads, so mark it done only once you no longer need them; never a teammate's " +
    "task still in use unless the developer asked for it. A task is never archived: a settled " +
    `one stands Done or Canceled, which ${AGENT_TOOL.LIST_TASKS} lists by status. A block is ` +
    "Linear's: the blocker's work comes first and the task it blocks waits on it, as one child " +
    "task builds on another. It is advice, never a lock, so nothing refuses to start a blocked " +
    "task. Both tasks must be in your workspace, a task never blocks itself, and a block that " +
    "would close a cycle is refused. A child task works in its parent's repository, so a " +
    "parent working in another is refused, as is one under which the task would descend from " +
    "itself. Answers `accepted` with the task as it now stands, its " +
    "parentTaskId, blockedBy, and blocks among it where the call changed them, `already` true where every " +
    "change named already stood, or `rejected` and " +
    "why. Then say which tasks you changed and how.",
  inputSchema: UPDATE_TASK_INPUT,
} as const;

export const STOP_AGENT_TOOL = {
  name: AGENT_TOOL.STOP_AGENT,
  description:
    "Stop an agent of your workspace by its id, as the developer's Stop button would: " +
    "its turn under way is canceled and its status reads canceled, while the agent stays " +
    "available, its transcript and branch kept, and a later message starts a new turn. Stop " +
    "an agent you or the developer started that is going the wrong way, or one the developer " +
    "asked you to stop; never a teammate's agent still in use unless the developer asked for " +
    "it. No " +
    "agent stops itself. Answers `accepted` with the " +
    "agent's status now and whether it was stopped, `stopped` false for an agent already " +
    "idle, which changes nothing, or `rejected` and why. Then say which agent you stopped and why.",
  inputSchema: READ_AGENT_INPUT,
} as const;

const READ_PAGE_INPUT = Schema.Struct({
  pageId: describeWire(
    wireUuidSchema,
    `The page's id, as a mention of it, ${AGENT_TOOL.SHOW_PAGE}'s answer, or a link to it names.`,
  ),
  version: Schema.optionalKey(
    describeWire(
      Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
      "The version to read, by its number; leave it out for the newest.",
    ),
  ),
});

const readPageAsked = Schema.decodeUnknownResult(READ_PAGE_INPUT);

export const READ_PAGE_TOOL = {
  name: AGENT_TOOL.READ_PAGE,
  description:
    "Read a page an agent showed in your workspace, by its id: its title, the version read " +
    "(the newest unless you name one) and the newest there is, its task and whether that is " +
    "the task you work on, or, for a page an agent on no task showed on itself, that agent " +
    "and whether it is you, its mention ready to write, and its HTML as it " +
    "stands, cut on a line at " +
    `${READ_PAGE_CHARS} characters with how many were left out. Read a page the developer ` +
    "pointed you at, or one another agent showed, before you build on it or revise it; to " +
    `revise a page of your own task, show it again with ${AGENT_TOOL.SHOW_PAGE} and its id.`,
  inputSchema: READ_PAGE_INPUT,
} as const;

export const UPDATE_AGENT_REFUSAL = {
  UNREADABLE:
    `Not changed: name the agent by the id ${AGENT_TOOL.LIST_AGENTS} answered and at least one ` +
    `change: a title of at most ${AGENT_BOUNDS.MAX_TITLE_CHARS} characters (empty clears ` +
    "it), a model with its effort, both or neither, a contextWindow only with them, pinned, or " +
    "disabledServers as connection names, or archived, with a reason only where it is true; or " +
    "addRepository alone, as a repository as owner/name with a branch or none.",
  UNAVAILABLE: "Not changed: the models could not be read just now. The call may be made again.",
  UNAVAILABLE_ADD:
    "Not added: the service could not be reached just now. The call may be made again.",
  SELF: "Not archived: that id is your own, and an agent does not archive itself; say you are done, and the developer archives you.",
  NOT_READY:
    "Not archived: that agent's turn is still coming up, so there is no turn to stop yet; call " +
    "again in a moment. Nothing else asked was changed.",
  NATIVE_NOT_HERE:
    "Not archived: that agent runs on Claude Code or Codex, which cannot be reached from here " +
    "to stop its turn yet; a member archives it from the agent's own tab. Nothing else asked was changed.",
  UNAVAILABLE_ARCHIVE:
    "Not archived: the service could not reach that agent's session to stop its turn just now. " +
    "The call may be made again. Nothing else asked was changed.",
} as const;

const UPDATE_CHOICE_LEAD = "Not changed";

const ADD_REPOSITORY_LEAD = "Not added";

const ADD_REPOSITORY_REFUSAL_WORDS: ReadonlyMap<string, string> = new Map([
  [
    HOSTED_API_ERROR.BRANCH_NOT_FOUND,
    `${ADD_REPOSITORY_LEAD}: GitHub has no such branch in that repository. Name a branch it holds, or none for its default branch.`,
  ],
  [
    HOSTED_API_ERROR.GITHUB_UNANSWERED,
    `${ADD_REPOSITORY_LEAD}: GitHub could not be asked just now. The call may be made again.`,
  ],
  [
    HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE,
    `${ADD_REPOSITORY_LEAD}: that repository is not reachable through the GitHub App installation connected to the agent's workspace. Ask the member to give the App access to it.`,
  ],
]);

function updateNamesAChange(update: {
  readonly title?: string;
  readonly model?: string;
  readonly effort?: string;
  readonly contextWindow?: string;
  readonly pinned?: boolean;
  readonly disabledServers?: readonly string[];
  readonly archived?: boolean;
  readonly reason?: string;
  readonly addRepository?: AgentAlsoRepository;
}): boolean {
  const { title, model, effort, contextWindow, pinned, disabledServers, archived, reason } = update;
  const changes = [title, model, pinned, disabledServers, archived];
  if (update.addRepository !== undefined) return changes.every((field) => field === undefined);
  if ((model === undefined) !== (effort === undefined)) return false;
  if (contextWindow !== undefined && model === undefined) return false;
  if (reason !== undefined && archived !== true) return false;
  return changes.some((field) => field !== undefined);
}

export const ADDED_REPOSITORY_INPUT = Schema.Struct({
  repository: describeWire(githubRepositoryFullNameSchema, "The repository, as owner/name."),
  branch: Schema.optionalKey(
    describeWire(
      START_BRANCH,
      "The branch to clone its checkout at, which must already be on GitHub; leave it out for " +
        "its default branch.",
    ),
  ),
});

const UPDATE_AGENT_INPUT = Schema.Struct({
  agentId: AGENT_ID,
  title: Schema.optionalKey(
    describeWire(
      Schema.Trim.check(Schema.isMaxLength(AGENT_BOUNDS.MAX_TITLE_CHARS)),
      "The agent's title as its tab shows it; empty clears it, so the tab shows the model's name.",
    ),
  ),
  model: Schema.optionalKey(
    describeWire(
      modelChoiceSchema.fields.model,
      `The model it runs on from its next step, by its catalog id as ${AGENT_TOOL.LIST_MODELS} ` +
        "answers it; given with the effort or not at all.",
    ),
  ),
  effort: Schema.optionalKey(
    describeWire(
      modelChoiceSchema.fields.effort,
      "The reasoning effort, as the model lists it; given with the model or not at all.",
    ),
  ),
  contextWindow: Schema.optionalKey(
    describeWire(
      contextWindowSchema,
      "The context window it runs on, standard or long; only with a model, and the model's " +
        "whole window where left out.",
    ),
  ),
  pinned: Schema.optionalKey(
    describeWire(
      Schema.Boolean,
      "Whether the developer you work for keeps it pinned in their sidebar, the pin theirs alone; " +
        "an agent on a task or on none alike.",
    ),
  ),
  disabledServers: Schema.optionalKey(
    describeWire(
      disabledServersSchema,
      "The MCP servers switched off for the agent, by connection name, the whole list, which " +
        "replaces the one standing; empty switches every server back on. Its next turn reads it.",
    ),
  ),
  archived: Schema.optionalKey(
    describeWire(
      Schema.Boolean,
      "true to archive it, as the developer's Archive agent would: it leaves the sidebar, its " +
        "task's tabs, and every list but the archived ones, takes no message, and is not woken, " +
        "its transcript, branch, and pull request kept; a turn still running is stopped first, " +
        "and never yourself. false to bring an archived one back.",
    ),
  ),
  reason: Schema.optionalKey(
    describeWire(
      Schema.Trim.check(
        Schema.isNonEmpty(),
        Schema.isMaxLength(AGENT_BOUNDS.MAX_ARCHIVE_REASON_CHARS),
      ),
      "Why it is archived, in a short sentence the developer reads on its archived banner " +
        "beside your name, such as its pull request having merged; only with archived true.",
    ),
  ),
  addRepository: Schema.optionalKey(
    describeWire(
      ADDED_REPOSITORY_INPUT,
      "A repository the agent works in beside its own from now on, added after the others and " +
        "checked out in a folder of its own, which its token then reaches and it is told of; " +
        "named alone, with no other change. Only for an agent the developer you work for started, " +
        "in the cloud, in a repository of its own, its repositories all reached through one " +
        "GitHub App installation. Never once your conversation holds words from another " +
        "account. Nothing removes one.",
    ),
  ),
}).check(Schema.makeFilter(updateNamesAChange));

const readUpdateAsked = Schema.decodeUnknownResult(UPDATE_AGENT_INPUT);

export const UPDATE_AGENT_TOOL = {
  name: AGENT_TOOL.UPDATE_AGENT,
  description:
    "Change an agent of your workspace by its id, as the developer's own menu, model " +
    "chip, and composer would, for the developer you work for: rename it (empty clears the " +
    "title), move it to another model and effort, and context window, from its next step, as " +
    `${AGENT_TOOL.LIST_MODELS} lists them, pin or unpin it in that ` +
    "developer's sidebar, replace the list of MCP servers switched off for it, archive it " +
    "or bring it back, or add a repository it works in beside its own, alone. Name at least " +
    "one change; an archive is checked first, and the rest land together or not at all. Archive an idle helper agent whose work is done, such as one " +
    "whose pull request merged, or one the developer asked you to clean up, with a short reason " +
    "its archived banner shows beside your name; a turn still running is stopped first, and " +
    "no agent archives itself. Change a teammate's agent still in use only where the developer " +
    "asked for it. Answers `accepted` " +
    "with the agent as it then stands, whether archived among " +
    "it, or `rejected` and why; a rejected model or effort lists the choices. Then say which " +
    "agent you changed and how.",
  inputSchema: UPDATE_AGENT_INPUT,
} as const;

const LIST_TASKS_INPUT = Schema.Struct({
  nameContains: Schema.optionalKey(
    describeWire(
      Schema.Trim.check(Schema.isNonEmpty(), Schema.isMaxLength(200)),
      "Only the tasks whose name holds these words, whatever their case; leave it out for all.",
    ),
  ),
  status: Schema.optionalKey(
    describeWire(taskStatusSchema, "Only the tasks that stand here; leave it out for all."),
  ),
  assignee: Schema.optionalKey(
    describeWire(
      taskAssigneeWrittenSchema,
      "Only the tasks assigned to this member, by their mention link, or null for the tasks no " +
        "one is assigned to; leave it out for all.",
    ),
  ),
  offset: Schema.optionalKey(
    describeWire(
      Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
      "How many of the matching tasks to pass over, newest first: the nextOffset an earlier list " +
        "answered, to read the next page; leave it out for the first.",
    ),
  ),
});

const readTasksAsked = Schema.decodeUnknownResult(LIST_TASKS_INPUT);

export const LIST_TASKS_TOOL = {
  name: AGENT_TOOL.LIST_TASKS,
  description:
    "List the tasks of your workspace, started by any member, the Done and Canceled ones " +
    "among them: each with its id, its key (such as ACME-42), its name, where " +
    "it stands (its status) and how much it matters (its priority), who it is assigned to (its " +
    "assignee's mention link, null for no one), " +
    "the repository its agents work in (null for none yet), who started it, whether it is " +
    "the task you work on, the sectionId of the sidebar section the " +
    "developer you work for keeps it in (null for none, under Tasks), and its mention, the " +
    "`[@name](link)` to name it by in your words, the newest first and at most " +
    `${TASKS_LIST_LIMIT} a page, with ` +
    "nextOffset where more stand; and beside them every section that developer keeps in this " +
    "workspace's sidebar, each with its id and title. Narrow it by words of a task's name with " +
    `nameContains, by where it stands with status, and by who it is assigned to with assignee. Call it to find the task to start an agent on with ${AGENT_TOOL.START_AGENT}'s ` +
    `taskId, to narrow ${AGENT_TOOL.LIST_AGENTS} to one, or to find the task and the section ` +
    `${AGENT_TOOL.UPDATE_TASK}'s sectionId names, and ${AGENT_TOOL.DELETE_SECTION} where you ` +
    "are offered it.",
  inputSchema: LIST_TASKS_INPUT,
} as const;

const CONTINUATION_NAME = "its continuation";

const ENTRY_WORDS = {
  SAID: "Said",
} as const;

function cut(text: string, maximumChars: number): string {
  const line = text.replace(/\s+/gu, " ").trim();
  return line.length > maximumChars ? `${line.slice(0, maximumChars - 1)}…` : line;
}

function entriesOf(journal: StoredUIMessage, maximumChars: number): string[] {
  return journal.parts.flatMap((part) => {
    if (isTextUIPart(part) && part.text.trim().length > 0) {
      return [cut(`${ENTRY_WORDS.SAID}: ${part.text}`, maximumChars)];
    }
    if (isStoredToolPart(part)) return [cut(callEntry(part), maximumChars)];
    return [];
  });
}

interface AgentReading {
  readonly id: string;
  readonly task: AgentTask | null;
  readonly onYourTask: boolean;
  readonly archived: boolean;
  readonly title: string;
  readonly model: string;
  readonly modelName: string;
  readonly effort: string;
  readonly status: AgentStatus;
  readonly failureReason?: AgentFailure;
  readonly repository: string | null;
  readonly branch: string | null;
  readonly activity: string | null;
  readonly mention: string;
}

const journalsOf = (agent: Agent, limit: number) =>
  Effect.map(
    listJournals(agent.userId, agent.conversationId, CODER_TOOL_SET, limit),
    (read): readonly StoredMessageRecord[] => (read.ok ? read.value : []),
  );

const standingsOf = (agents: readonly Agent[]) =>
  Effect.gen(function* () {
    const ids = agents.map((agent) => agent.conversationId);
    const turns = yield* latestTurnsOfReached(ids);
    const awaiting = yield* awaitingLinesOfReached(ids);
    const now = yield* Clock.currentTimeMillis;
    return (agent: Agent) => {
      const turn = turns.get(agent.conversationId);
      const status = agentStatusOf(turn, {
        createdAt: agent.createdAt,
        now,
        awaitingLineAt: awaiting.get(agent.conversationId),
        blank: startedBlank(agent),
      });
      return {
        status,
        failureReason: status === AGENT_STATUS.FAILED ? agentFailureOf(turn) : undefined,
      };
    };
  });

const offeredModels = Effect.flatMap(ModelCatalog, (catalog) =>
  Effect.orElseSucceed(catalog.read, (): readonly OfferedModel[] => []),
);

const newestJournalsOf = (agents: readonly Agent[]) =>
  newestJournalsOfReached(
    agents.map((agent) => agent.conversationId),
    CODER_TOOL_SET,
  );

const readAgentReading = (
  agent: Agent,
  task: AgentTaskReading,
  standing: {
    readonly status: AgentStatus;
    readonly failureReason: AgentFailure | undefined;
  },
  newest: StoredMessageRecord | undefined,
  offered: readonly OfferedModel[],
  workspace: string,
): AgentReading => {
  const activity =
    newest === undefined
      ? undefined
      : entriesOf(newest.message, AGENT_TOOL_BOUNDS.ACTIVITY_CHARS).at(-1);
  return {
    id: agent.id,
    ...task,
    archived: agent.archivedAt !== null,
    title: agent.title ?? agent.model,
    model: agent.model,
    modelName: modelLabel(agent.model, offered),
    effort: agent.effort,
    status: standing.status,
    ...(standing.failureReason === undefined
      ? undefined
      : { failureReason: standing.failureReason }),
    repository: agent.repository,
    branch: agent.branch,
    activity: activity ?? null,
    mention: agentMention(agent, workspace),
  };
};

const publishedOf = (
  userId: string,
  agent: Agent,
): Effect.Effect<
  AgentPullRequestAnswer | undefined,
  never,
  DatabaseServices | HttpClient.HttpClient | GitHubApp
> =>
  Effect.map(Effect.result(agentPublished(userId, agent)), (read) =>
    Result.isSuccess(read) ? read.success : undefined,
  );

export function callerAgent(caller: AgentCaller): Agent | undefined {
  return caller.kind === AGENT_CALLER.AGENT ? caller.agent : undefined;
}

export function callerUserId(caller: AgentCaller): string {
  return caller.kind === AGENT_CALLER.AGENT ? caller.agent.userId : caller.userId;
}

export function callerTask(caller: AgentCaller): string | null {
  return caller.kind === AGENT_CALLER.AGENT ? caller.agent.taskId : null;
}

export const callerWorkspace = (
  caller: AgentCaller,
): Effect.Effect<Option.Option<string>, StoreFailure, DatabaseServices> =>
  caller.kind === AGENT_CALLER.AGENT
    ? ownAgentWorkspace(caller.agent.userId, caller.agent)
    : Effect.map(isWorkspaceMember(caller.userId, caller.workspaceId), (member) =>
        member ? Option.some(caller.workspaceId) : Option.none(),
      );

const agentRouteOf = (agent: Agent) =>
  Effect.map(nativeRouteOfReached(agent.conversationId), Option.getOrUndefined);

export const workspaceAgentOf = (caller: AgentCaller, agentId: string) =>
  Effect.gen(function* () {
    const workspace = yield* callerWorkspace(caller);
    if (Option.isNone(workspace)) return Option.none();
    const userId = callerUserId(caller);
    const found = yield* workspaceAgent(userId, workspace.value, agentId, callerAgent(caller)?.id);
    if (Option.isNone(found)) return Option.none();
    const agent = found.value;
    const task = yield* agentTaskOf(userId, agent);
    return Option.some({
      agent,
      task: taskReading(task, callerTask(caller)),
      workspaceId: workspace.value,
    });
  });

const taskOfCallerWorkspace = (caller: AgentCaller, taskId: string) =>
  Effect.gen(function* () {
    const workspace = yield* callerWorkspace(caller);
    if (Option.isNone(workspace)) return false;
    const owning = yield* taskWorkspace(callerUserId(caller), taskId);
    return Option.isSome(owning) && owning.value === workspace.value;
  });

export function agentToolRejected(reason: string): WireRecord {
  return { status: ACTION_RESULT_STATUS.REJECTED, reason };
}

function withReset(words: string, refusal: HostedRefusal): string {
  if (refusal.provider !== undefined) {
    return `${words} The model's provider is connected as ${harnessNameOf(refusal.provider)}.`;
  }
  return refusal.resetsAt === undefined
    ? words
    : `${words} It resets at ${new Date(refusal.resetsAt).toISOString()}.`;
}

function startRefusalWords(refusal: HostedRefusal): string {
  if (refusal.localAgentRefusal === LOCAL_AGENT_REFUSAL.NOT_OWNER) {
    return notOwnerWords(refusal.refusedDevice);
  }
  if (refusal.localAgentRefusal !== undefined) {
    return LOCAL_AGENT_REFUSAL_WORDS[refusal.localAgentRefusal];
  }
  if (refusal.extraRepositoryRefusal !== undefined) {
    return extraRepositoryWords(refusal.extraRepositoryRefusal, refusal.refusedRepository);
  }
  return withReset(
    START_REFUSAL_WORDS.get(refusal.error) ?? START_AGENT_REFUSAL.UNAVAILABLE,
    refusal,
  );
}

export function choiceRefusal(
  choice: ModelChoice | undefined,
  offered: readonly OfferedModel[],
  lead = "Not started",
): string {
  const refused =
    choice === undefined
      ? "the member's default model is no longer offered"
      : `no offered model is ${choice.model} at effort ${choice.effort}`;
  const choices = offered.map((model) => `${model.id} (${model.efforts.join(", ")})`).join("; ");
  return `${lead}: ${refused}. The choices are: ${choices}.`;
}

function agentMention(agent: Agent, workspace: string): string {
  return writtenMention(
    { kind: MENTION_KIND.AGENT, agentId: agent.id },
    agentName(agent),
    workspace,
  );
}

function agentIntroduction(agent: Agent): string {
  const working = agent.repository === null ? "" : `, working in ${agent.repository}`;
  return `"${agentName(agent)}" (agent id ${agent.id})${working}`;
}

function runOfCaller(calling: Agent) {
  return Effect.map(currentAutomationRun(calling.id), (current) =>
    Option.getOrElse(current, () => calling.automationRunId ?? undefined),
  );
}

function startedByNote(starter: Agent, note: string | undefined): string {
  const lead =
    `You were started by another agent of your workspace, ${agentIntroduction(starter)}, ` +
    "not by the developer. Your final message reaches it by itself once your turn ends, so make " +
    "that message your report: what you did, what you published, and what you need of it. To " +
    `reach it before then, call ${AGENT_TOOL.MESSAGE_AGENT} with its agentId, ${starter.id}.`;
  return note === undefined ? lead : `${lead}\n\n${note}`;
}

const startedReading = (agent: Agent, offered: readonly OfferedModel[], ownTask: string | null) =>
  Effect.gen(function* () {
    const standing = yield* standingsOf([agent]);
    const workspace = yield* workspaceStepOf(agent.userId, agent.organizationId);
    return {
      id: agent.id,
      model: agent.model,
      modelName: modelLabel(agent.model, offered),
      effort: agent.effort,
      status: standing(agent).status,
      onYourTask: agent.taskId !== null && agent.taskId === ownTask,
      mention: agentMention(agent, workspace),
    };
  });

export const orStoreRefusal = <R>(
  effect: Effect.Effect<WireRecord, StoreFailure, R>,
): Effect.Effect<WireRecord, never, R> =>
  Effect.catch(effect, (failure) =>
    Effect.as(logStoreFailure(failure), agentToolRejected(AGENT_TOOL_REFUSAL.STORE)),
  );

export const workedRepository = (caller: AgentCaller) =>
  Effect.succeed<string | null>(callerAgent(caller)?.repository ?? null);

const startedBefore = (call: AgentCall) =>
  Effect.gen(function* () {
    const { caller } = call;
    const userId = callerUserId(caller);
    const made = yield* readAgentByKey(userId, call.clientKey);
    if (Option.isNone(made)) return Option.none<WireRecord>();
    const agent = made.value;
    const workspace = yield* callerWorkspace(caller);
    if (Option.isNone(workspace) || agent.organizationId !== workspace.value) {
      return Option.some(agentToolRejected(START_AGENT_REFUSAL.NO_SUCH_TASK));
    }
    const reading = yield* startedReading(agent, yield* offeredModels, callerTask(caller));
    const from = agent.startedFrom;
    const continuedBy =
      from === null || from.messageId !== undefined
        ? []
        : yield* earlierContinuationsOf(
            { userId, workspaceId: workspace.value, taskId: agent.taskId },
            from.agentId,
            agent.id,
          );
    return Option.some<WireRecord>({
      status: ACTION_RESULT_STATUS.ACCEPTED,
      agent: reading,
      ...earlierContinuations(continuedBy, agent.id),
    });
  });

function readingRecord(reading: AgentReading): WireRecord {
  return { ...reading, task: reading.task === null ? null : { ...reading.task } };
}

export function runListAgents(
  call: AgentReadCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, AgentToolServices> {
  const { caller } = call;
  const ownTask = callerTask(caller);
  const narrowed = listedFilter(input, ownTask);
  if (Result.isFailure(narrowed)) return Effect.succeed(agentToolRejected(narrowed.failure));
  return orStoreRefusal(
    Effect.gen(function* () {
      const workspace = yield* callerWorkspace(caller);
      if (Option.isNone(workspace)) return agentToolRejected(AGENT_TOOL_REFUSAL.NO_WORKSPACE);
      const { agents, taskOf, nextOffset } = yield* workspaceAgentsOf(
        callerUserId(caller),
        workspace.value,
        callerAgent(caller),
        narrowed.success,
      );
      const standing = yield* standingsOf(agents);
      const newest = yield* newestJournalsOf(agents);
      const offered = yield* offeredModels;
      const step = yield* workspaceStepOf(callerUserId(caller), workspace.value);
      const readings = agents.map((agent) =>
        readAgentReading(
          agent,
          taskReading(taskOf(agent), ownTask),
          standing(agent),
          newest.get(agent.conversationId),
          offered,
          step,
        ),
      );
      return {
        status: ACTION_RESULT_STATUS.ACCEPTED,
        agents: readings.map(readingRecord),
        nextOffset,
      };
    }),
  );
}

const tailOf = (agent: Agent, entries: number, entryChars: number) =>
  Effect.gen(function* () {
    const entriesIn = (journals: readonly StoredMessageRecord[]) =>
      journals.flatMap((journal) =>
        entriesOf(journal.message, entryChars).map((text) => ({ messageId: journal.id, text })),
      );
    const newest = yield* journalsOf(agent, AGENT_TOOL_BOUNDS.TAIL_TURNS);
    const read = entriesIn(newest);
    const more =
      read.length < entries &&
      newest.length === AGENT_TOOL_BOUNDS.TAIL_TURNS &&
      entries > AGENT_TOOL_BOUNDS.TAIL_TURNS;
    const all = more ? entriesIn(yield* journalsOf(agent, entries)) : read;
    return all.slice(-entries);
  });

export function runReadAgent(
  call: AgentReadCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, AgentToolServices> {
  const asked = readAgentAsked(input);
  if (Result.isFailure(asked)) {
    return Effect.succeed(agentToolRejected(AGENT_TOOL_REFUSAL.UNREADABLE));
  }
  const entries = asked.success.entries ?? AGENT_TOOL_BOUNDS.TAIL_ENTRIES;
  const entryChars = AGENT_TOOL_BOUNDS.AGENT_ENTRY_CHARS;
  return orStoreRefusal(
    Effect.gen(function* () {
      const found = yield* workspaceAgentOf(call.caller, asked.success.agentId);
      if (Option.isNone(found)) return agentToolRejected(AGENT_TOOL_REFUSAL.NO_AGENT);
      const { agent, task, workspaceId } = found.value;
      const standing = yield* standingsOf([agent]);
      const step = yield* workspaceStepOf(callerUserId(call.caller), workspaceId);
      const newest = yield* newestJournalsOf([agent]);
      const reading = readAgentReading(
        agent,
        task,
        standing(agent),
        newest.get(agent.conversationId),
        yield* offeredModels,
        step,
      );
      const published = yield* publishedOf(callerUserId(call.caller), agent);
      const tail = yield* tailOf(agent, entries, entryChars);
      return {
        status: ACTION_RESULT_STATUS.ACCEPTED,
        agent: readingRecord(reading),
        ...(published === undefined
          ? undefined
          : { published: { branch: published.branch, pullRequest: published.pullRequest } }),
        tail,
      };
    }),
  );
}

interface EarlierContinuation {
  readonly id: string;
  readonly mention: string;
}

interface SourceLanding {
  readonly place: StartWhere;
  readonly continuedBy: readonly EarlierContinuation[];
}

const earlierContinuationsOf = (
  at: { readonly userId: string; readonly workspaceId: string; readonly taskId: string | null },
  sourceId: string,
  upTo?: string,
) =>
  Effect.gen(function* () {
    const continuations = (yield* continuationsOf(at.userId, [sourceId])).get(sourceId) ?? [];
    const whole = continuations.filter((each) => each.messageId === undefined);
    const cut = whole.findIndex((each) => each.agentId === upTo);
    const earlier = cut < 0 ? whole : whole.slice(0, cut);
    if (earlier.length === 0) return [];
    const step = yield* workspaceStepOf(at.userId, at.workspaceId);
    return earlier.map(
      (each): EarlierContinuation => ({
        id: each.agentId,
        mention: writtenMention(
          { kind: MENTION_KIND.AGENT, agentId: each.agentId },
          each.title ?? CONTINUATION_NAME,
          step,
        ),
      }),
    );
  });

const startedThrough = (userId: string, agentId: string, ancestorId: string) =>
  Effect.gen(function* () {
    const seen = new Set<string>();
    let at: string | null = agentId;
    while (at !== null && !seen.has(at)) {
      seen.add(at);
      const read: Option.Option<Agent> = yield* readAgent(userId, at);
      at = Option.isSome(read) ? read.value.startedByAgentId : null;
      if (at === ancestorId) return true;
    }
    return false;
  });

const sourceLanding = (
  caller: AgentCaller,
  from: AgentStartFrom,
  named: string | undefined,
): Effect.Effect<Result.Result<SourceLanding, string>, StoreFailure, DatabaseServices> =>
  Effect.gen(function* () {
    const found = yield* workspaceAgentOf(caller, from.agentId);
    if (Option.isNone(found)) return Result.fail(START_AGENT_REFUSAL.NO_SOURCE);
    const { agent: source, workspaceId } = found.value;
    if (!controlsAgent(callerUserId(caller), source)) {
      return Result.fail(`Not started: only ${yield* agentStarterName(source)} can do this.`);
    }
    if (named !== undefined && named !== source.taskId) {
      return Result.fail(START_AGENT_REFUSAL.SOURCE_OTHER_TASK);
    }
    const place = placeOfAgent(source);
    if (from.messageId !== undefined) {
      const { userId, conversationId } = source;
      const role = MESSAGE_ROLE.ASSISTANT;
      const at = yield* messageSeqOf(userId, conversationId, from.messageId, role);
      if (Option.isNone(at)) return Result.fail(START_AGENT_REFUSAL.NO_MESSAGE);
      return Result.succeed({ place, continuedBy: [] });
    }
    const calling = callerAgent(caller);
    if (
      calling !== undefined &&
      (yield* startedThrough(callerUserId(caller), calling.id, source.id))
    ) {
      return Result.fail(START_AGENT_REFUSAL.STARTER_CONTINUE);
    }
    const { status } = (yield* standingsOf([source]))(source);
    if (status === AGENT_STATUS.STARTING || status === AGENT_STATUS.RUNNING) {
      return Result.fail(START_AGENT_REFUSAL.SOURCE_RUNNING);
    }
    const at = { userId: callerUserId(caller), workspaceId, taskId: source.taskId };
    const continuedBy = yield* earlierContinuationsOf(at, source.id);
    return Result.succeed({ place, continuedBy });
  });

function earlierContinuations(
  continuedBy: readonly EarlierContinuation[] | undefined,
  startedId: string,
): WireRecord {
  const earlier = (continuedBy ?? []).filter((each) => each.id !== startedId);
  return earlier.length === 0 ? {} : { earlierContinuations: earlier.map((each) => ({ ...each })) };
}

function startFromRefusalWords(refusal: HostedRefusal, from: AgentStartFrom | undefined): string {
  if (from === undefined && refusal.error === HOSTED_API_ERROR.NOT_PERMITTED) {
    return START_AGENT_REFUSAL.PILOT_OFF;
  }
  if (from !== undefined && refusal.error === HOSTED_API_ERROR.NOT_FOUND) {
    return START_AGENT_REFUSAL.NO_SOURCE;
  }
  if (from?.messageId !== undefined && refusal.error === HOSTED_API_ERROR.INVALID_REQUEST) {
    return START_AGENT_REFUSAL.NO_MESSAGE;
  }
  return startRefusalWords(refusal);
}

function forwarderOf(caller: AgentCaller): ImageForwarder {
  return {
    userId: callerUserId(caller),
    conversationId: callerAgent(caller)?.conversationId,
  };
}

const startTaskOf = (
  call: AgentCall,
  repository: string | null,
): Effect.Effect<Result.Result<string, string>, StoreFailure, AgentToolServices> =>
  Effect.gen(function* () {
    const { caller } = call;
    const userId = callerUserId(caller);
    const id = calledId(userId, call.clientKey);
    if (Option.isSome(yield* readTask(userId, id))) return Result.succeed(id);
    const workspace = yield* callerWorkspace(caller);
    if (Option.isNone(workspace)) return Result.fail(START_AGENT_REFUSAL.NO_WORKSPACE);
    const calling = callerAgent(caller);
    const made = yield* createTaskAsked(
      userId,
      {
        id,
        organizationId: workspace.value,
        repository,
        status: TASK_STATUS.IN_PROGRESS,
        assigneeId: userId,
        ...(calling === undefined
          ? undefined
          : { origin: { actor: DESCRIPTION_ACTOR.AGENT, agentId: calling.id } }),
        madeByStart: true,
        relations: [],
      },
      SERVER_TASK_SOURCE.AGENT,
    );
    return Result.succeed(made.task.task.id);
  }).pipe(
    Effect.catch((failure) => {
      if (!("_tag" in failure)) return Effect.succeed(Result.fail(startRefusalWords(failure)));
      switch (failure._tag) {
        case "SqlError":
        case "SchemaError":
        case "EffectDrizzleQueryError":
          return Effect.fail(failure);
        default:
          return Effect.succeed(Result.fail(START_AGENT_REFUSAL.NO_WORKSPACE));
      }
    }),
  );

const discardUnstarted = (userId: string, taskId: string) =>
  deleteTask(userId, taskId, { stoppedAgentIds: new Set() }).pipe(
    Effect.catchTag("TaskAgentUnstopped", () => Effect.succeed(false)),
    Effect.catch((failure) => Effect.as(logStoreFailure(failure), false)),
  );

function startInputRefusal(
  caller: AgentCaller,
  start: typeof START_AGENT_CALL.Type,
): string | undefined {
  const { from } = start;
  const onTask = start.taskId !== undefined || callerTask(caller) !== null;
  if (start.repository !== undefined && (from !== undefined || onTask)) {
    return START_AGENT_REFUSAL.REPOSITORY_ON_TASK;
  }
  if (from === undefined) return undefined;
  const prompt = start.prompt ?? start.task;
  if (prompt !== undefined || start.branch !== undefined) {
    return START_AGENT_REFUSAL.FROM_WITH_PROMPT;
  }
  const self = from.agentId === callerAgent(caller)?.id;
  return self && from.messageId === undefined ? START_AGENT_REFUSAL.SELF_CONTINUE : undefined;
}

const runsOnOfStart = Effect.fnUntraced(function* (
  userId: string,
  runsOn: typeof START_RUNS_ON.Type | undefined,
): Effect.fn.Return<
  Result.Result<AgentRunsOnRequest | undefined, string>,
  StoreFailure,
  DatabaseServices
> {
  if (runsOn === undefined || !("device" in runsOn)) return Result.succeed(runsOn);
  const devices = yield* devicesSeenSince(userId, new Date(0));
  const wanted = runsOn.device.trim().toLowerCase();
  const matched = devices.filter((device) => device.name.trim().toLowerCase() === wanted);
  const [only] = matched;
  if (matched.length === 1 && only !== undefined) {
    return Result.succeed({ machine: AGENT_MACHINE.DEVICE, deviceId: only.id });
  }
  const now = yield* Clock.currentTimeMillis;
  return Result.fail(deviceNameRefusal(runsOn.device, matched.length, devices, now));
});

export function runStartAgent(
  call: AgentCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, AgentToolServices> {
  const asked = readStart(input);
  if (
    Result.isFailure(asked) ||
    (asked.success.model === undefined) !== (asked.success.effort === undefined)
  ) {
    return Effect.succeed(agentToolRejected(START_AGENT_REFUSAL.UNREADABLE));
  }
  if (asked.success.newTask !== undefined) {
    return Effect.succeed(agentToolRejected(START_AGENT_REFUSAL.NEW_TASK));
  }
  const { model, effort, from } = asked.success;
  const { caller, eve } = call;
  const refused = startInputRefusal(caller, asked.success);
  if (refused !== undefined) return Effect.succeed(agentToolRejected(refused));
  const prompt = asked.success.prompt ?? asked.success.task;
  const choice = model !== undefined && effort !== undefined ? { model, effort } : undefined;
  const named = asked.success.taskId;
  const ownTask = callerTask(caller);
  const userId = callerUserId(caller);
  return orStoreRefusal(
    Effect.gen(function* () {
      const elsewhere = from !== undefined || (named !== undefined && named !== ownTask);
      if (elsewhere || asked.success.images !== undefined) {
        const before = yield* startedBefore(call);
        if (Option.isSome(before)) return before.value;
      }
      if (from === undefined && named !== undefined && named !== ownTask) {
        const reached = yield* taskOfCallerWorkspace(caller, named);
        if (!reached) return agentToolRejected(START_AGENT_REFUSAL.NO_SUCH_TASK);
      }
      const landing = from === undefined ? undefined : yield* sourceLanding(caller, from, named);
      if (landing !== undefined && Result.isFailure(landing)) {
        return agentToolRejected(landing.failure);
      }
      const taskId = named ?? ownTask;
      const fresh = landing === undefined && taskId === null;
      if (fresh && prompt === undefined) return agentToolRejected(START_AGENT_REFUSAL.NO_PROMPT);
      const repository =
        asked.success.repository === undefined
          ? (callerAgent(caller)?.repository ?? null)
          : asked.success.repository;
      if (fresh && repository === null && asked.success.branch !== undefined) {
        return agentToolRejected(START_AGENT_REFUSAL.BRANCH_NO_REPOSITORY);
      }
      const images =
        asked.success.images === undefined
          ? Result.succeed([])
          : yield* forwardedImages(forwarderOf(caller), asked.success.images);
      if (Result.isFailure(images)) {
        return agentToolRejected(`Not started: ${forwardedImageRefusalWords(images.failure)}`);
      }
      const runsOn = yield* runsOnOfStart(userId, asked.success.runsOn);
      if (Result.isFailure(runsOn)) return agentToolRejected(runsOn.failure);
      const making = fresh ? yield* startTaskOf(call, repository) : undefined;
      if (making !== undefined && Result.isFailure(making))
        return agentToolRejected(making.failure);
      const made = making?.success;
      const onTask = taskId ?? made;
      const place: StartWhere | undefined =
        landing?.success.place ?? (onTask === undefined ? undefined : { taskId: onTask });
      if (place === undefined) return agentToolRejected(START_AGENT_REFUSAL.NO_WORKSPACE);
      const calling = callerAgent(caller);
      const note =
        calling === undefined ? asked.success.note : startedByNote(calling, asked.success.note);
      const started = yield* startAgent(Effect.succeed(eve), userId, {
        ...place,
        idempotencyKey: call.clientKey,
        choice,
        prompt,
        note,
        attachments: images.success,
        title: asked.success.title,
        branch: asked.success.branch,
        alsoRepositories: asked.success.alsoRepositories,
        from,
        runsOn: runsOn.success,
        summaryModel: call.summaryModel,
        ...(calling === undefined
          ? undefined
          : { noteHeading: START_NOTE_HEADING.AGENT, startedBy: calling }),
        automationRunId:
          (place.taskId === ownTask || place.taskId === made) && calling !== undefined
            ? yield* runOfCaller(calling)
            : undefined,
      }).pipe(Effect.result);
      if (Result.isFailure(started)) {
        const refusal = started.failure;
        if (made !== undefined) yield* discardUnstarted(userId, made);
        if (refusal instanceof ModelChoiceRefused) {
          return agentToolRejected(choiceRefusal(choice, refusal.offered));
        }
        return agentToolRejected(startFromRefusalWords(refusal, from));
      }
      return {
        status: ACTION_RESULT_STATUS.ACCEPTED,
        agent: yield* startedReading(started.success.agent, yield* offeredModels, ownTask),
        ...earlierContinuations(landing?.success.continuedBy, started.success.agent.id),
      };
    }),
  );
}

function archiverOf(caller: AgentCaller, reason: string | undefined): StoredArchive {
  const why = reason === undefined ? undefined : { reason };
  if (caller.kind === AGENT_CALLER.MEMBER) {
    return { by: AGENT_ARCHIVER.MEMBER, userId: caller.userId, ...why };
  }
  return {
    by: AGENT_ARCHIVER.AGENT,
    userId: caller.agent.userId,
    agentId: caller.agent.id,
    agentName: agentName(caller.agent),
    ...why,
  };
}

export function taskStandingOf(
  task: Pick<TaskSummary, "number" | "status" | "priority" | "assignee">,
  naming: { readonly step: string; readonly name: string },
) {
  return {
    key: task.number === undefined ? null : taskKey(naming.name, task.number),
    status: task.status ?? null,
    priority: task.priority ?? null,
    assignee: assigneeMentionOf(task, naming.step),
  };
}

interface TaskUpdateAnswered {
  readonly already: boolean;
  readonly section: TaskSectionReading | null | undefined;
  readonly parentNamed: boolean;
  readonly blocksNamed: boolean;
}

const taskUpdateAnswer = (
  userId: string,
  task: StoredTask["task"],
  { already, section, parentNamed, blocksNamed }: TaskUpdateAnswered,
) =>
  Effect.gen(function* () {
    const { step, name } = yield* workspaceNamingOf(userId, task.workspaceId);
    const blocks = blocksNamed ? yield* taskBlockReadingsNow(userId, task.id, step) : undefined;
    const answer: WireRecord = {
      status: ACTION_RESULT_STATUS.ACCEPTED,
      task: {
        id: task.id,
        ...taskStandingOf(task, { step, name }),
        name: task.name,
        repository: task.repository,
        pinned: task.pinnedAt !== undefined,
        mention: writtenTaskMention(task, task.name, step),
        ...(section === undefined
          ? undefined
          : { section: section === null ? null : { ...section } }),
        ...(parentNamed ? { parentTaskId: task.parentTaskId ?? null } : undefined),
        ...blocks,
      },
      already,
    };
    return answer;
  });

interface TaskSectionReading {
  readonly id: string;
  readonly title: string;
}

const sectionAsked = (
  userId: string,
  workspaceId: string,
  taskId: string,
  sectionId: string | null,
) =>
  Effect.map(listTaskSections(userId), (kept) => {
    const section =
      sectionId === null
        ? null
        : kept.sections.find((each) => each.id === sectionId && each.workspaceId === workspaceId);
    if (section === undefined) return Result.fail(UPDATE_TASK_REFUSAL.NO_SECTION);
    const standing = kept.entries.find((entry) => entry.taskId === taskId)?.sectionId ?? null;
    return Result.succeed({
      section: section === null ? null : { id: section.id, title: section.title },
      stands: standing === sectionId,
    });
  });

function changesStand(stored: StoredTask, changes: TaskChanges): boolean {
  const { task } = stored;
  return (
    (changes.name === undefined || changes.name === task.name) &&
    (changes.repository === undefined || changes.repository === task.repository) &&
    (changes.githubAccess === undefined || changes.githubAccess === stored.githubAccess) &&
    (changes.pinned === undefined || changes.pinned === (task.pinnedAt !== undefined)) &&
    (changes.status === undefined || changes.status === task.status) &&
    (changes.priority === undefined || changes.priority === task.priority) &&
    (changes.assigneeId === undefined || changes.assigneeId === (task.assignee?.userId ?? null))
  );
}

export function repositoryRefusalWords(refusal: HostedRefusal): string {
  if (refusal.error === HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE) {
    return UPDATE_TASK_REFUSAL.NOT_REACHABLE;
  }
  return refusal.error === HOSTED_API_ERROR.GITHUB_UNANSWERED
    ? UPDATE_TASK_REFUSAL.GITHUB_UNANSWERED
    : AGENT_TOOL_REFUSAL.STORE;
}

function changeRefusalWords(refusal: HostedRefusal): string {
  switch (refusal.error) {
    case HOSTED_API_ERROR.NOT_FOUND:
      return UPDATE_TASK_REFUSAL.NO_TASK;
    case HOSTED_API_ERROR.INVALID_REQUEST:
      return UPDATE_TASK_REFUSAL.NOT_MEMBER;
    case HOSTED_API_ERROR.CHILD_REPOSITORY_LOCKED:
      return UPDATE_TASK_REFUSAL.TREE_REPOSITORY;
    case HOSTED_API_ERROR.AGENT_NOT_READY:
      return UPDATE_TASK_REFUSAL.ARCHIVE_NOT_READY;
    default:
      return repositoryRefusalWords(refusal);
  }
}

export function runUpdateTask(
  call: AgentCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, AgentToolServices> {
  const asked = readTaskUpdate(input);
  if (Result.isFailure(asked)) {
    return Effect.succeed(agentToolRejected(UPDATE_TASK_REFUSAL.UNREADABLE));
  }
  const { taskId, sectionId, assignee, archived, parentTaskId, blockedBy, blocks, ...named } =
    asked.success;
  const blockChanges = { ...(blockedBy && { blockedBy }), ...(blocks && { blocks }) };
  const assigneeId =
    assignee === undefined ? undefined : assignee === null ? null : assigneeIdOf(assignee);
  if (assignee !== undefined && assigneeId === undefined) {
    return Effect.succeed(agentToolRejected(UPDATE_TASK_REFUSAL.NOT_MEMBER));
  }
  const changes = assigneeId === undefined ? named : { ...named, assigneeId };
  if (
    Object.keys(changes).length === 0 &&
    archived === undefined &&
    sectionId === undefined &&
    parentTaskId === undefined &&
    !blockChangesNamed(blockChanges)
  ) {
    return Effect.succeed(agentToolRejected(UPDATE_TASK_REFUSAL.UNREADABLE));
  }
  const { caller } = call;
  return orStoreRefusal(
    Effect.gen(function* () {
      const userId = callerUserId(caller);
      const workspace = yield* callerWorkspace(caller);
      const read = yield* readTask(userId, taskId);
      if (
        Option.isNone(workspace) ||
        Option.isNone(read) ||
        read.value.task.workspaceId !== workspace.value
      ) {
        return agentToolRejected(UPDATE_TASK_REFUSAL.NO_TASK);
      }
      const placing =
        sectionId === undefined
          ? undefined
          : yield* sectionAsked(userId, workspace.value, taskId, sectionId);
      if (placing !== undefined && Result.isFailure(placing)) {
        return agentToolRejected(placing.failure);
      }
      const blocking = blockChangesNamed(blockChanges)
        ? yield* blockWritesAsked(userId, workspace.value, taskId, blockChanges)
        : undefined;
      if (blocking !== undefined && Result.isFailure(blocking)) {
        return agentToolRejected(blocking.failure);
      }
      const asked = archived === undefined ? changes : { ...changes, archived };
      const confirmed =
        Object.keys(asked).length === 0
          ? undefined
          : yield* Effect.result(taskChangeAsked(userId, taskId, asked, callerAgent(caller)?.id));
      if (confirmed !== undefined && Result.isFailure(confirmed)) {
        return agentToolRejected(changeRefusalWords(confirmed.failure));
      }
      const stands =
        changesStand(read.value, confirmed?.success.changes ?? {}) &&
        (placing?.success.stands ?? true);
      const locking = [
        ...(blocking === undefined ? [] : tasksOfWrites(blocking.success)),
        ...(typeof parentTaskId === "string" ? [taskId, parentTaskId] : []),
      ];
      const writing = Effect.gen(function* () {
        if (locking.length > 0) yield* lockTasksForBlocks(userId, locking);
        const updated =
          confirmed === undefined
            ? undefined
            : yield* taskChangeWritten(
                userId,
                taskId,
                confirmed.success,
                archiverOf(caller, undefined),
              ).pipe(
                Effect.mapError(
                  (refusal) => new TaskChangeRefused({ words: changeRefusalWords(refusal) }),
                ),
              );
        if (updated !== undefined && Option.isNone(updated)) {
          return yield* new TaskChangeRefused({ words: UPDATE_TASK_REFUSAL.NO_TASK });
        }
        if (placing !== undefined && !placing.success.stands) {
          const placed = yield* writeTaskSections(userId, {
            kind: TASK_SECTION_WRITE.PLACE,
            taskId,
            sectionId: placing.success.section?.id ?? null,
          });
          if (Option.isNone(placed)) {
            return yield* new TaskChangeRefused({ words: UPDATE_TASK_REFUSAL.NO_SECTION });
          }
        }
        const parented =
          parentTaskId === undefined
            ? undefined
            : yield* setTaskParent(userId, taskId, parentTaskId);
        if (parented !== undefined && Option.isNone(parented)) {
          return yield* new TaskChangeRefused({ words: UPDATE_TASK_REFUSAL.NO_TASK });
        }
        const blocksChanged =
          blocking === undefined ? false : yield* writeTaskBlocks(userId, blocking.success);
        return {
          updated: updated?.value,
          task: parented?.value.task ?? updated?.value.task ?? read.value.task,
          parentChanged: parented?.value.txid !== undefined,
          blocksChanged,
        };
      });
      const changed = yield* Effect.flatMap(SqlClient.SqlClient, (client) =>
        client.withTransaction(writing),
      ).pipe(
        Effect.map((written) => Result.succeed(written)),
        Effect.catchTags({
          TaskChangeRefused: ({ words }) => Effect.succeed(Result.fail(words)),
          TaskBlockRefused: ({ words }) => Effect.succeed(Result.fail(words)),
          TaskParentUnreached: () => Effect.succeed(Result.fail(UPDATE_TASK_REFUSAL.NO_PARENT)),
          TaskParentRepositoryDiffers: () =>
            Effect.succeed(Result.fail(UPDATE_TASK_REFUSAL.PARENT_REPOSITORY)),
          TaskParentCycle: () => Effect.succeed(Result.fail(UPDATE_TASK_REFUSAL.PARENT_CYCLE)),
        }),
      );
      if (Result.isFailure(changed)) return agentToolRejected(changed.failure);
      const { updated, task, parentChanged, blocksChanged } = changed.success;
      if (updated !== undefined) yield* taskChangeSettled(deploymentSandboxStops, userId, updated);
      return yield* taskUpdateAnswer(userId, task, {
        already: stands && !parentChanged && !blocksChanged,
        section: placing?.success.section,
        parentNamed: parentTaskId !== undefined,
        blocksNamed: blocking !== undefined,
      });
    }),
  );
}

const stopRefusalWords = (refusal: HostedRefusal, agent: Agent) =>
  Effect.gen(function* () {
    if (refusal.error === HOSTED_API_ERROR.NOT_FOUND) return AGENT_TOOL_REFUSAL.NO_AGENT;
    if (refusal.error === HOSTED_API_ERROR.NOT_PERMITTED) {
      return `Not stopped: ${yield* agentStarterName(agent)}'s own subscription pays for that agent, so only they and their agents can stop it.`;
    }
    if (refusal.error === HOSTED_API_ERROR.NATIVE_AGENT_NOT_HERE) {
      return STOP_AGENT_REFUSAL.NATIVE_NOT_HERE;
    }
    return STOP_AGENT_REFUSAL.UNAVAILABLE;
  });

function stopStands(turn: AgentLatestTurn | undefined): boolean {
  return (
    turn !== undefined && RUNNING_TURN_STATUSES.has(turn.status) && turn.cancelRequestedAt !== null
  );
}

const stopOf = (call: AgentCall, agent: Agent) =>
  Effect.gen(function* () {
    const { caller, clientKey: key } = call;
    const earlier = yield* hostedStoreOrUnavailable(
      turnStoppedUnderReached(agent.conversationId, key),
    );
    const before = (yield* turnStandingsOf([agent.conversationId]))(agent.conversationId);
    const by = callerAgent(caller)?.id;
    const canceled = earlier
      ? false
      : yield* stoppedAgent(call.writer, callerUserId(caller), agent, {
          key,
          ...(by === undefined ? undefined : { by }),
        });
    const after = (yield* turnStandingsOf([agent.conversationId]))(agent.conversationId);
    const status = agentStatusOf(after.turn, {
      createdAt: agent.createdAt,
      now: yield* Clock.currentTimeMillis,
      awaitingLineAt: after.awaitingLineAt,
      blank: startedBlank(agent),
    });
    const standing = stopStands(before.turn) && after.turn?.id === before.turn?.id;
    return { stopped: earlier || canceled || standing, status };
  });

export function runStopAgent(
  call: AgentCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, AgentToolServices> {
  const asked = readAgentRef(input);
  if (Result.isFailure(asked)) {
    return Effect.succeed(agentToolRejected(STOP_AGENT_REFUSAL.UNREADABLE));
  }
  const { agentId } = asked.success;
  const { caller } = call;
  if (agentId === callerAgent(caller)?.id) {
    return Effect.succeed(agentToolRejected(STOP_AGENT_REFUSAL.SELF));
  }
  return orStoreRefusal(
    Effect.gen(function* () {
      const found = yield* workspaceAgentOf(caller, agentId);
      if (Option.isNone(found)) return agentToolRejected(AGENT_TOOL_REFUSAL.NO_AGENT);
      const { agent, task } = found.value;
      const stop = yield* Effect.result(stopOf(call, agent));
      if (Result.isFailure(stop)) {
        return agentToolRejected(yield* stopRefusalWords(stop.failure, agent));
      }
      const { stopped, status } = stop.success;
      return {
        status: ACTION_RESULT_STATUS.ACCEPTED,
        agent: {
          id: agent.id,
          title: agent.title ?? agent.model,
          task: task.task === null ? null : { ...task.task },
          onYourTask: task.onYourTask,
          status,
        },
        stopped,
      };
    }),
  );
}

class TaskChangeRefused extends Data.TaggedError("TaskChangeRefused")<{ readonly words: string }> {}

const archiveRefusalWords = (refusal: HostedRefusal, agent: Agent) =>
  Effect.gen(function* () {
    if (refusal.error === HOSTED_API_ERROR.NOT_FOUND) return AGENT_TOOL_REFUSAL.NO_AGENT;
    if (refusal.error === HOSTED_API_ERROR.AGENT_NOT_READY) return UPDATE_AGENT_REFUSAL.NOT_READY;
    if (refusal.error === HOSTED_API_ERROR.NOT_PERMITTED) {
      return `Not archived: ${yield* agentStarterName(agent)}'s own subscription pays for that agent, so only they and their agents can stop and archive it. Nothing else asked was changed.`;
    }
    if (refusal.error === HOSTED_API_ERROR.NATIVE_AGENT_NOT_HERE) {
      return UPDATE_AGENT_REFUSAL.NATIVE_NOT_HERE;
    }
    return UPDATE_AGENT_REFUSAL.UNAVAILABLE_ARCHIVE;
  });

export function runUpdateAgent(
  call: AgentCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, AgentToolServices> {
  const asked = readUpdateAsked(input);
  if (Result.isFailure(asked)) {
    return Effect.succeed(agentToolRejected(UPDATE_AGENT_REFUSAL.UNREADABLE));
  }
  const { agentId, title, model, effort, contextWindow, pinned, disabledServers } = asked.success;
  const { archived, reason, addRepository } = asked.success;
  const { caller } = call;
  if (addRepository !== undefined) return addedRepository(call, agentId, addRepository);
  if (archived === true && agentId === callerAgent(caller)?.id) {
    return Effect.succeed(agentToolRejected(UPDATE_AGENT_REFUSAL.SELF));
  }
  const userId = callerUserId(caller);
  return orStoreRefusal(
    Effect.gen(function* () {
      const found = yield* workspaceAgentOf(caller, agentId);
      if (Option.isNone(found)) return agentToolRejected(AGENT_TOOL_REFUSAL.NO_AGENT);
      const { task, workspaceId } = found.value;
      const choices = yield* Effect.result(accountModelChoices(userId));
      if (Result.isFailure(choices)) return agentToolRejected(UPDATE_AGENT_REFUSAL.UNAVAILABLE);
      const { offered } = choices.success;
      const asked =
        model === undefined || effort === undefined
          ? undefined
          : { model, effort, ...(contextWindow === undefined ? undefined : { contextWindow }) };
      const route = asked === undefined ? undefined : yield* agentRouteOf(found.value.agent);
      const runtime = route?.runtime;
      const refused =
        asked === undefined ? undefined : runtimeChoiceRefusal(runtime, asked, route?.payer);
      if (refused !== undefined) {
        return agentToolRejected(
          `${UPDATE_CHOICE_LEAD}: ${runtimeChoiceRefusalWords(runtime, refused)}`,
        );
      }
      const accepted = asked === undefined ? undefined : validateModelChoice(offered, asked);
      if (asked !== undefined && accepted !== undefined && Result.isFailure(accepted)) {
        return agentToolRejected(choiceRefusal(asked, offered, UPDATE_CHOICE_LEAD));
      }
      const choice = accepted === undefined ? undefined : Result.getOrUndefined(accepted);
      let agent = found.value.agent;
      if (archived !== undefined) {
        const archive = yield* Effect.result(
          archivedAgent(
            deploymentSandboxStops,
            call.writer,
            userId,
            agent,
            archived,
            archiverOf(caller, reason),
          ),
        );
        if (Result.isFailure(archive)) {
          return agentToolRejected(yield* archiveRefusalWords(archive.failure, agent));
        }
        if (Option.isNone(archive.success)) return agentToolRejected(AGENT_TOOL_REFUSAL.NO_AGENT);
        agent = archive.success.value.agent;
      }
      const written = yield* changedAgent(userId, agent, {
        title,
        choice,
        pinned,
        disabledServers,
      });
      if (Option.isNone(written)) return agentToolRejected(AGENT_TOOL_REFUSAL.NO_AGENT);
      agent = written.value.agent;
      const step = yield* workspaceStepOf(userId, workspaceId);
      return {
        status: ACTION_RESULT_STATUS.ACCEPTED,
        agent: {
          id: agent.id,
          title: agent.title ?? agent.model,
          model: agent.model,
          modelName: modelLabel(agent.model, offered),
          effort: agent.effort,
          contextWindow: agent.contextWindow,
          disabledServers: [...agent.disabledServers],
          task: task.task === null ? null : { ...task.task },
          onYourTask: task.onYourTask,
          mention: agentMention(agent, step),
          archived: agent.archivedAt !== null,
          ...(pinned === undefined ? undefined : { pinned }),
        },
      };
    }),
  );
}

const ADDED_AT_NEXT_TURN =
  "It is checked out at that agent's next turn, whose instructions name it; the agent was told nothing now, so an idle one was not woken.";

const addRefusalWords = (refusal: HostedRefusal, agent: Agent) =>
  Effect.gen(function* () {
    if (refusal.extraRepositoryRefusal !== undefined) {
      return addedRepositoryWords(refusal.extraRepositoryRefusal, refusal.refusedRepository);
    }
    if (refusal.error === HOSTED_API_ERROR.NOT_PERMITTED) {
      return `${ADD_REPOSITORY_LEAD}: only ${yield* agentStarterName(agent)} and their agents add a repository to that agent, since its token is minted for them.`;
    }
    return ADD_REPOSITORY_REFUSAL_WORDS.get(refusal.error) ?? UPDATE_AGENT_REFUSAL.UNAVAILABLE_ADD;
  });

function addedRepository(
  call: AgentCall,
  agentId: string,
  asked: AgentAlsoRepository,
): Effect.Effect<WireRecord, never, AgentToolServices> {
  const { caller } = call;
  const userId = callerUserId(caller);
  return orStoreRefusal(
    Effect.gen(function* () {
      const found = yield* workspaceAgentOf(caller, agentId);
      if (Option.isNone(found)) return agentToolRejected(AGENT_TOOL_REFUSAL.NO_AGENT);
      const { agent, task, workspaceId } = found.value;
      const calling = callerAgent(caller);
      const added = yield* Effect.result(
        addAgentRepository({ userId, agent: calling }, agent, asked, {
          eve: call.eve,
          writer: call.writer,
          clientKey: call.clientKey,
        }),
      );
      if (Result.isFailure(added)) {
        return agentToolRejected(yield* addRefusalWords(added.failure, agent));
      }
      const { repository, path, checkout } = added.success;
      const now = checkout === ADDED_REPOSITORY_CHECKOUT.NOW;
      const step = yield* workspaceStepOf(userId, workspaceId);
      return {
        status: ACTION_RESULT_STATUS.ACCEPTED,
        agent: {
          id: agent.id,
          title: agent.title ?? agent.model,
          task: task.task === null ? null : { ...task.task },
          onYourTask: task.onYourTask,
          mention: agentMention(agent, step),
        },
        added: { repository, path, checkout },
        ...(now && calling?.id === agent.id
          ? { told: addedRepositoryLine({ repository, path }) }
          : undefined),
        ...(now ? undefined : { note: ADDED_AT_NEXT_TURN }),
      };
    }),
  );
}

export function runListTasks(
  call: AgentReadCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, AgentToolServices> {
  const { caller } = call;
  const asked = readTasksAsked(input);
  if (Result.isFailure(asked)) {
    return Effect.succeed(agentToolRejected(AGENT_TOOL_REFUSAL.UNREADABLE_TASKS));
  }
  const words = asked.success.nameContains?.toLowerCase();
  const offset = asked.success.offset ?? 0;
  const assigned = asked.success.assignee;
  const assigneeId =
    assigned === undefined || assigned === null ? assigned : assigneeIdOf(assigned);
  if (assigned !== undefined && assigned !== null && assigneeId === undefined) {
    return Effect.succeed(agentToolRejected(AGENT_TOOL_REFUSAL.UNREADABLE_TASKS));
  }
  return orStoreRefusal(
    Effect.gen(function* () {
      const workspace = yield* callerWorkspace(caller);
      if (Option.isNone(workspace)) {
        return agentToolRejected(AGENT_TOOL_REFUSAL.NO_WORKSPACE);
      }
      const ownTask = callerTask(caller);
      const userId = callerUserId(caller);
      const listed = yield* listTasks(userId);
      const matching = listed.filter(
        (task) =>
          task.workspaceId === workspace.value &&
          (words === undefined || task.name.toLowerCase().includes(words)) &&
          (asked.success.status === undefined || task.status === asked.success.status) &&
          (assigned === undefined || (task.assignee?.userId ?? null) === assigneeId),
      );
      const kept = yield* listTaskSections(userId);
      const sections = kept.sections.filter((section) => section.workspaceId === workspace.value);
      const shelved = new Set(sections.map((section) => section.id));
      const sectionOf = new Map(
        kept.entries
          .filter((entry) => shelved.has(entry.sectionId))
          .map((entry) => [entry.taskId, entry.sectionId]),
      );
      const { step, name } = yield* workspaceNamingOf(userId, workspace.value);
      const tasks = matching.slice(offset, offset + TASKS_LIST_LIMIT).map((task) => ({
        id: task.id,
        ...taskStandingOf(task, { step, name }),
        name: task.name,
        repository: task.repository ?? null,
        startedBy: task.createdBy?.name ?? null,
        isYourTask: task.id === ownTask,
        sectionId: sectionOf.get(task.id) ?? null,
        mention: writtenTaskMention(task, task.name, step),
      }));
      const next = offset + TASKS_LIST_LIMIT;
      return {
        status: ACTION_RESULT_STATUS.ACCEPTED,
        tasks,
        nextOffset: next < matching.length ? next : null,
        sections: sections.map((section) => ({ id: section.id, title: section.title })),
      };
    }),
  );
}

const modelsListed = (userId: string, route: NativeRoute | undefined) =>
  Effect.gen(function* () {
    const choices = yield* Effect.result(accountModelChoices(userId));
    if (Result.isFailure(choices)) return agentToolRejected(LIST_MODELS_REFUSAL.UNAVAILABLE);
    const { offered, defaultChoice } = choices.success;
    const listed = runtimeModels(offered, route?.runtime, route?.payer);
    return {
      status: ACTION_RESULT_STATUS.ACCEPTED,
      models: listed.map((model) => ({
        id: model.id,
        name: modelLabel(model.id, offered),
        efforts: [...model.efforts],
      })),
      default: {
        model: defaultChoice.model,
        modelName: modelLabel(defaultChoice.model, offered),
        effort: defaultChoice.effort,
        offered: Result.isSuccess(validateModelChoice(listed, defaultChoice)),
      },
    };
  });

export function runListModels(
  call: AgentReadCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, AgentToolServices> {
  const asked = readListModelsAsked(input);
  if (Result.isFailure(asked)) {
    return Effect.succeed(agentToolRejected(LIST_MODELS_REFUSAL.UNREADABLE));
  }
  const { agentId } = asked.success;
  const { caller } = call;
  return orStoreRefusal(
    Effect.gen(function* () {
      let route: NativeRoute | undefined;
      if (agentId !== undefined) {
        const found = yield* workspaceAgentOf(caller, agentId);
        if (Option.isNone(found)) return agentToolRejected(AGENT_TOOL_REFUSAL.NO_AGENT);
        route = yield* agentRouteOf(found.value.agent);
      }
      return yield* modelsListed(callerUserId(caller), route);
    }),
  );
}

export function runListMemberModels(
  userId: string,
): Effect.Effect<WireRecord, never, AgentToolServices> {
  return orStoreRefusal(modelsListed(userId, undefined));
}

interface PageCut {
  readonly html: string;
  readonly leftOutChars: number;
}

export interface TextCut {
  readonly text: string;
  readonly leftOutChars: number;
}

export function cutOnLine(text: string, maximumChars: number): TextCut {
  if (text.length <= maximumChars) return { text, leftOutChars: 0 };
  const lineEnd = text.lastIndexOf("\n", maximumChars);
  const kept = text.slice(0, lineEnd > 0 ? lineEnd : maximumChars);
  return { text: kept, leftOutChars: text.length - kept.length };
}

function pageCut(html: string): PageCut {
  const cut = cutOnLine(html, READ_PAGE_CHARS);
  return { html: cut.text, leftOutChars: cut.leftOutChars };
}

type PageStanding =
  | {
      readonly task: { readonly id: string; readonly name: string | null };
      readonly isYourTask: boolean;
    }
  | { readonly agent: { readonly id: string; readonly name: string }; readonly isYours: boolean };

const pageStandingOf = (caller: AgentCaller, owner: PageOwner) =>
  Effect.gen(function* () {
    const userId = callerUserId(caller);
    if (owner.kind === PAGE_OWNER.TASK) {
      if (!(yield* taskOfCallerWorkspace(caller, owner.taskId))) return Option.none<PageStanding>();
      const names = yield* taskNamesOf(userId, [owner.taskId]);
      return Option.some<PageStanding>({
        task: { id: owner.taskId, name: names.get(owner.taskId)?.name ?? null },
        isYourTask: owner.taskId === callerTask(caller),
      });
    }
    const found = yield* workspaceAgentOf(caller, owner.agentId);
    if (Option.isNone(found)) return Option.none<PageStanding>();
    return Option.some<PageStanding>({
      agent: { id: owner.agentId, name: agentName(found.value.agent) },
      isYours: callerAgent(caller)?.id === owner.agentId,
    });
  });

export function runReadPage(
  call: AgentReadCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, AgentToolServices> {
  const asked = readPageAsked(input);
  if (Result.isFailure(asked)) {
    return Effect.succeed(agentToolRejected(READ_PAGE_REFUSAL.UNREADABLE));
  }
  const { caller } = call;
  return orStoreRefusal(
    Effect.gen(function* () {
      const workspace = yield* callerWorkspace(caller);
      if (Option.isNone(workspace)) {
        return agentToolRejected(AGENT_TOOL_REFUSAL.NO_WORKSPACE);
      }
      const userId = callerUserId(caller);
      const found = yield* readPageById(userId, asked.success.pageId, asked.success.version);
      if (Option.isNone(found)) return agentToolRejected(READ_PAGE_REFUSAL.NO_PAGE);
      const { owner, page, newestVersion } = found.value;
      const standing = yield* pageStandingOf(caller, owner);
      if (Option.isNone(standing)) return agentToolRejected(READ_PAGE_REFUSAL.NO_PAGE);
      const mention = yield* writtenPageMention(userId, owner, page.id, page.title);
      const cut = pageCut(page.html);
      return {
        status: ACTION_RESULT_STATUS.ACCEPTED,
        page: {
          id: page.id,
          title: page.title,
          version: page.version,
          newestVersion,
          ...standing.value,
          ...(Option.isNone(mention) ? undefined : { mention: mention.value }),
          html: cut.html,
          leftOutChars: cut.leftOutChars,
        },
      };
    }),
  );
}
