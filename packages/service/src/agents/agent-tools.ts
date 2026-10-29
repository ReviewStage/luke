import type { DatabaseServices } from "@luke/database/core/query";
import {
  type Agent,
  type AgentLatestTurn,
  archiveIdleAgent,
  awaitingLinesOfReached,
  continuationsOf,
  IDLE_ARCHIVE,
  latestTurnsOfReached,
  nativeRuntimesOfReached,
  operatorReplaced,
  pinAgent,
  RUNNING_TURN_STATUSES,
  readAgent,
  readAgentByKey,
  readAgentRouting,
  renameAgent,
  taskNamesOf,
  unarchiveAgentFrom,
  updateAgentChoice,
  updateAgentServers,
} from "@luke/database/models/agent-store";
import {
  listJournals,
  messageSeqOf,
  type StoredMessageRecord,
  turnStoppedUnderReached,
} from "@luke/database/models/message-reads";
import { readPageById } from "@luke/database/models/plan-pages";
import { lockTasksForBlocks } from "@luke/database/models/task-block-store";
import { listTaskSections, writeTaskSections } from "@luke/database/models/task-section-store";
import {
  listTasks,
  readTask,
  type StoredTask,
  type TaskChanges,
  updateTask,
} from "@luke/database/models/task-store";
import type { StoreWriter } from "@luke/database/models/writer";
import type { StoredArchive } from "@luke/database/schemas/agent";
import { START_NOTE_HEADING } from "@luke/features/agent-replay";
import {
  harnessNameOf,
  runtimeChoiceRefusal,
  runtimeChoiceRefusalWords,
  runtimeModels,
} from "@luke/features/agent-runtime-models";
import {
  AGENT_ARCHIVER,
  AGENT_BOUNDS,
  AGENT_STATUS,
  type AgentFailure,
  type AgentPullRequestAnswer,
  type AgentStartFrom,
  type AgentStatus,
  contextWindowSchema,
  disabledServersSchema,
  LOCAL_AGENT_REFUSAL,
  type LocalAgentRefusal,
  type NativeAgentRuntime,
  type RefusedDevice,
} from "@luke/features/agent-wire";
import {
  GITHUB_ACCESS,
  type GitHubAccess,
  githubRepositoryFullNameSchema,
} from "@luke/features/github-repositories-wire";
import { MENTION_KIND } from "@luke/features/mention-link";
import { agentGivenName, agentName, modelLabel } from "@luke/features/model-label";
import { type ModelChoice, modelChoiceSchema } from "@luke/features/models-wire";
import { PAGE_OWNER, type PageOwner } from "@luke/features/page-wire";
import { TASK_SECTION_WRITE } from "@luke/features/task-section-wire";
import {
  TASK_BOUNDS,
  TASK_PRIORITY,
  TASK_STATUS,
  type TaskSummary,
  taskPrioritySchema,
  taskStatusSchema,
} from "@luke/features/task-wire";
import { taskKey } from "@luke/features/workspace-key";
import { describeWire } from "@luke/wire/effect";
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
import type { GitHubApp } from "../github/github-app.js";
import {
  ownAgentWorkspace,
  taskWorkspace,
  workspaceRepository,
} from "../github/workspace-repository.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
} from "../http/http-effect.js";
import { logStoreFailure, type StoreFailure } from "../http/store-failure.js";
import {
  ModelCatalog,
  ModelChoiceRefused,
  type OfferedModel,
  validateModelChoice,
} from "../providers/model-catalog.js";
import { archiveAskedStatus } from "../tasks/archive-settle.js";
import { agentStarterName, controlsAgent, writesToAgent } from "./agent-reach.js";
import { AGENT_TOOL } from "./agent-runtime/tools.js";
import {
  forwardedImageRefusalWords,
  forwardedImages,
  type ImageForwarder,
} from "./coder-host/forwarded-images.js";
import { agentPublished } from "./coder-host/published.js";
import { callEntry } from "./coder-host/replay.js";
import type { SummaryModelOf } from "./coder-host/replay-summary.js";
import { runnerChoiceApplied } from "./coder-host/runtime-sessions.js";
import {
  accountModelChoices,
  placeOfAgent,
  type StartWhere,
  startAgent,
} from "./coder-host/start.js";
import {
  agentFailureOf,
  agentStatusOf,
  lineAwaitsTurn,
  startedBlank,
} from "./coder-host/status.js";
import { cancelledTurn, standingsOf as turnStandingsOf } from "./coder-host/stop.js";
import { CODER_TOOL_SET } from "./coder-host/tool-set.js";
import { discardedOrLogged } from "./device-discard.js";
import type { AgentSessions } from "./eve-host/eve-sessions.js";
import {
  STEWARD_ACT,
  type StewardAct,
  stewardContinuedRefusal,
  stewardRefusal,
  stewardTaskRefusal,
} from "./steward.js";
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
  listedTask,
  taskReading,
  WORKSPACE_AGENTS_LIST_LIMIT,
  workspaceAgent,
  workspaceAgentsOf,
} from "./workspace-agents.js";
import {
  pageMention,
  pageStepOf,
  workspaceNamingOf,
  workspaceStepOf,
  writtenMention,
} from "./written-mentions.js";

/**
 * agent-tools.ts -- the tools every agent reaches the workspace's coding agents by: list them, read one's progress, start one.
 *
 * Every coding agent is offered the same `list_agents`,
 * `read_agent`, and `start_agent`, one implementation each;
 * the caller is what differs (`AgentCaller`):
 * a coding agent acting for its starter, on its own task, which the host
 * read from the session it admitted and never from the call. A list and a read
 * reach any agent of the caller's workspace, on any task or none
 * and by any member, read on the caller's standing on every call
 * (`workspace-agents.ts`); an agent of another workspace is none of them,
 * even one the member is also in. A list names each agent's task, narrows
 * to one task or the caller's own where asked, and marks the archived
 * agents; a coding agent's own list leaves itself out. Each tool reads the
 * same rows the agent tabs read: the agents and the newest turn each stands
 * on (`coder-host/status.ts`), the branch each row holds, and the
 * transcript's turn journals, rendered as a short tail of what the agent
 * said and did; a read of one agent also asks GitHub what that branch
 * published, as the agent's tab does (`coder-host/published.ts`), and says
 * nothing of it where GitHub could not be asked. Luke summarises a read
 * aloud, so his tail's entries are cut close and his words for the tool say
 * so; a coding agent reads its tail as text, to learn why an agent went
 * quiet, so each of its entries keeps more, and it may ask for a longer
 * tail, to a bound. One agent messages another with `message_agent`
 * (`coder-host/agent-message.ts`). A start takes the one path the Start button's does
 * (`coder-host/start.ts`), on the caller's own task or another of its workspace, under the
 * same key, so a call run again starts no second agent: the plan as the
 * agent's brief, or the prompt in its place, and the note the call carries
 * after either, on the model and effort named or else the member's default,
 * checked against the catalog as the member is offered it, whose choices the
 * refusal lists and `list_models` answers from the same read, so a choice it
 * lists is one a start takes, with its checkout cloned at the branch named
 * where one is, which GitHub must hold. An agent a
 * coding agent starts is told in that note which agent started it and how
 * to report back, with `message_agent`, and its choice leaves the member's default as it stood.
 * A start may name a new task instead, which is made as the member the
 * caller acts for would make it from the sidebar: in the caller's workspace,
 * owned by that member, with an empty plan, on the repository the caller
 * works in (the calling agent's own), confirmed through the
 * workspace's installation first; a start that then fails takes the task it
 * made away again, and a call run again answers the agent and task it made.
 * A start may instead go on from another agent of the workspace, on that
 * agent's own task, as the Start route's continue and fork do: without a
 * message it continues an agent that has ended, which its start then stops,
 * one another agent already continued among them, whose earlier
 * continuations its answer names, and with one of its messages
 * it forks it there, which leaves it going on; either is handed the
 * source's brief, its replay with Luke's summary of what does not fit, a
 * copy of its work, and the note, and takes no prompt and no branch. A read
 * names the message each entry of the tail stands in, which a fork names.
 * An archive takes the rule the Archive agent menu's does for the member
 * the caller acts for: any agent of the workspace that member could
 * archive, a teammate's among them, with the stamp the menu writes, and
 * beside it who archived it, the caller on that member's behalf, and the
 * reason given, which the archived agent's banner shows. Where the menu asks
 * the developer before it stops a working agent, a tool has no one to ask,
 * so only an idle agent is archived, read idle under its conversation's
 * lock, which every turn queued and every message handed over takes; an
 * agent never archives itself, and an unarchive brings back only the
 * archive it read, never one made again since. An archive or an unarchive already standing answers as done, so
 * a call eve runs again does nothing twice.
 * A task's change takes the one path the member's own task menu does
 * (`tasks-app.ts`'s PATCH, `task-store.ts`'s `updateTask`), for the member
 * the caller acts for: a new name, a repository confirmed through the
 * workspace's installation or none, where it stands, or that member's own
 * pin, on any task of the caller's workspace, a teammate's among them. A
 * task is archived no longer, so an archive a call from before still asks
 * for settles the task instead, Done or Canceled by whether an agent's
 * pull request merged, without asking and without stopping the task's
 * agents, and an unarchive puts it back to work (`tasks/archive-settle.ts`);
 * a change already standing answers as done.
 * A stop takes the one path the Stop button's does (`coder-host/stop.ts`):
 * eve's cancel of the turn under way, named by eve's own id for it, then the
 * row's stamp, which `list_agents` then reads as cancelled. The agent stays
 * as it was, its transcript and branch kept, and a later message starts a
 * new turn. A Stop already standing on a turn still ending answers as done,
 * so a call eve runs again cancels nothing twice; an agent already idle is
 * answered as idle and nothing changes; one whose turn is still coming, a
 * session coming up or a line awaiting the turn it opens, has nothing a Stop
 * can name yet and is refused as such; an archived agent and the caller
 * itself are never stopped.
 * A page read finds a page an agent showed on any task of the caller's
 * workspace by the page's id, as the caller's member could open it in the
 * side panel, and answers its HTML cut on a line to a bound, which a
 * mention of the page now points the agent at rather than carrying it.
 * Each tool reaches eve as the deployment acting for the caller's member,
 * which the coder channel's table admits for exactly this
 * (`coder-host/channel.ts`). Every answer is data the model reads, never a
 * credential.
 */

/** The most tasks a list of them answers, the newest started first. */
const TASKS_LIST_LIMIT = 50;

const AGENT_TOOL_BOUNDS = {
  /** The newest turns a progress read walks first, the one under way included. */
  TAIL_TURNS: 3,
  /** The entries a progress read answers where it asks for no number, the newest last. */
  TAIL_ENTRIES: 20,
  /** The most entries a progress read may ask for: with a coding agent's entries, about ten thousand tokens. */
  MAX_TAIL_ENTRIES: 50,
  /** The most characters one entry of a coding agent's tail carries, which it reads as text. */
  AGENT_ENTRY_CHARS: 800,
  /** The most characters an agent's latest activity carries in the list. */
  ACTIVITY_CHARS: 160,
} as const;

/** Why a call ran nothing, or sent nothing, in words the model can act on. */
export const AGENT_TOOL_REFUSAL = {
  UNREADABLE: `Not run: name the agent by the id ${AGENT_TOOL.LIST_AGENTS} answered.`,
  UNREADABLE_FILTER: "Not run: narrow the list by a taskId, by thisTask, or by neither.",
  UNREADABLE_TASKS:
    "Not run: narrow the tasks by words of their name, by a status " +
    `(${Object.values(TASK_STATUS).join(", ")}), and by an assignee as a member's mention link ` +
    "or null, and page them by an offset of 0 or more.",
  NO_AGENT: `Not run: no agent of your workspace has that id; ${AGENT_TOOL.LIST_AGENTS} names them.`,
  NO_WORKSPACE:
    "Not run: your workspace could not be read for you, so no agent is reached from here.",
  STORE: "Not run: the agents could not be read just now. The call may be made again.",
} as const;

/** How the task tools word a priority. */
export const TASK_PRIORITY_WORDS =
  "How much the task matters; none for a task no one has weighed yet.";

/** Why a task's change changed nothing, in words the model can act on. */
export const UPDATE_TASK_REFUSAL = {
  UNREADABLE:
    `Not run: name the task by the id ${AGENT_TOOL.LIST_TASKS} or ${AGENT_TOOL.LIST_AGENTS} answered, ` +
    `and at least one change: a name of at most ${TASK_BOUNDS.MAX_NAME_CHARS} characters, a ` +
    "repository as owner/name or null, pinned, a sectionId or null, a status " +
    `(${Object.values(TASK_STATUS).join(", ")}), a priority ` +
    `(${Object.values(TASK_PRIORITY).join(", ")}), an assignee as a member's mention link or ` +
    "null, or tasks to add to or take away from its blockedBy or blocks.",
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
} as const;

/** Why a stop changed nothing, in words the model can act on. */
export const STOP_AGENT_REFUSAL = {
  UNREADABLE: `Not run: name the agent by the id ${AGENT_TOOL.LIST_AGENTS} answered.`,
  SELF: "Not stopped: that id is your own, and an agent does not stop itself; end your turn by finishing it.",
  ARCHIVED:
    "Not stopped: that agent is archived, and an archived agent's turn was stopped as it was archived.",
  NOT_READY:
    "Not stopped: that agent's turn is still coming up, so there is no turn to stop yet; call again in a moment.",
  NO_SERVICE: "Not stopped: this deployment cannot reach the agents' service.",
  UNAVAILABLE:
    "Not stopped: the service could not reach that agent's session just now. The call may be made again.",
  NATIVE_NOT_HERE:
    "Not stopped: that agent runs on Claude Code or Codex, which cannot be reached from here yet; a member stops it from the agent's own tab.",
} as const;

/** The most characters of a page's HTML a read answers, about ten thousand tokens: the rest is counted, never sent. */
const READ_PAGE_CHARS = 40_000;

/** Why a page read answered nothing, in words the model can act on. */
export const READ_PAGE_REFUSAL = {
  UNREADABLE:
    "Not read: name the page by its id, and a version as a whole number from 1, or none for the newest.",
  NO_PAGE:
    "Not read: no page of a task of your workspace has that id, or that page has no such version.",
} as const;

/** Why a start made nothing, in words the model can act on; a choice the catalog refused is said with the choices (`choiceRefusal`). */
export const START_AGENT_REFUSAL = {
  UNREADABLE:
    "Not started: give a prompt as text of at most " +
    `${AGENT_BOUNDS.MAX_START_WORDS_CHARS} characters, or none to start on the plan, a note ` +
    `bounded the same or none, a title of at most ${AGENT_BOUNDS.MAX_TITLE_CHARS} ` +
    "characters or none, a branch as one git branch name or none, a model with its effort, " +
    `both or neither, a taskId or none, a repository as owner/name, null, or none, and images as ` +
    `at most ${AGENT_BOUNDS.MAX_ATTACHMENTS} attachment ids or none.`,
  NO_PROMPT:
    "Not started: you work on no task, so there is no plan to hand it; give it a prompt, or name " +
    `a task by its taskId, as ${AGENT_TOOL.LIST_TASKS} answered it.`,
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
  NO_SERVICE: "Not started: this deployment cannot reach the agents' service.",
  NO_REPOSITORY: "Not started: this task names no GitHub repository yet.",
  SOURCE_NO_REPOSITORY:
    "Not started: that agent works on no task and in no GitHub repository, so there is no " +
    "checkout to go on from; start a new agent with a prompt instead.",
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
  IMAGE_PREPARING:
    "Not started: the agent's sandbox image is still being prepared; start it again in a minute or two.",
  PLAN_SIGNED_OUT:
    "Not started: the plan that would pay for it is signed out; its starter signs in again in Settings.",
  PLAN_UNREACHABLE:
    "Not started: the plan's provider did not answer; start it again in a minute or two.",
  PLAN_LIMIT_REACHED:
    "Not started: the plan that would pay for it has reached its usage limit; start it after the limit resets, or its starter chooses the API key in Settings.",
  PLAN_INELIGIBLE:
    "Not started: the plan's provider said the account is not eligible to run it; its starter chooses the API key in Settings.",
  CREDENTIAL_MISSING:
    "Not started: no subscription or API key of its starter's pays for that model, and Luke's key pays for no agent; its starter connects one in Settings › Agents, or start it on a model whose provider is connected.",
  API_KEY_UNREADABLE:
    "Not started: the API key that would pay for it is saved but cannot be read here; its starter saves it again in Settings › Agents.",
  DEVICE_REMOVED:
    "Not started: the host it would run on was removed. Continue it in the cloud, or ask the member to add the host again.",
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
  TREE_STOPPED:
    "Not started: that task is a child task of a pilot tree whose Running switch is off, so no " +
    "agent starts or goes on there until a member switches Running on, on the top task.",
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

/** Why a list of the models answered none, in words the model can act on. */
export const LIST_MODELS_REFUSAL = {
  UNAVAILABLE: "Not listed: the models could not be read just now. The call may be made again.",
  UNREADABLE: `Not listed: name an agent, if any, by the id ${AGENT_TOOL.LIST_AGENTS} answered.`,
} as const;

/** Whether the caller may write to the agent under the plan's policy (`agent-reach.ts`'s `writesToAgent`), its payer read now. */
const writesAsPlanPolicy = (userId: string, agent: Agent) =>
  Effect.map(readAgentRouting(userId, agent.id), (routing) =>
    writesToAgent(userId, agent, Option.isSome(routing) ? routing.value.payer : null),
  );

/** The start refusal's sentence for each hosted refusal a start may answer; any other is the service down. */
const START_REFUSAL_WORDS: ReadonlyMap<string, string> = new Map([
  [HOSTED_API_ERROR.NO_REPOSITORY, START_AGENT_REFUSAL.NO_REPOSITORY],
  [HOSTED_API_ERROR.BRANCH_NOT_FOUND, START_AGENT_REFUSAL.NO_BRANCH],
  [HOSTED_API_ERROR.GITHUB_UNANSWERED, START_AGENT_REFUSAL.GITHUB_UNANSWERED],
  [HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE, START_AGENT_REFUSAL.NOT_REACHABLE],
  [HOSTED_API_ERROR.AGENT_IMAGE_PREPARING, START_AGENT_REFUSAL.IMAGE_PREPARING],
  [HOSTED_API_ERROR.AGENT_PLAN_SIGNED_OUT, START_AGENT_REFUSAL.PLAN_SIGNED_OUT],
  [HOSTED_API_ERROR.AGENT_PLAN_UNREACHABLE, START_AGENT_REFUSAL.PLAN_UNREACHABLE],
  [HOSTED_API_ERROR.AGENT_PLAN_LIMIT_REACHED, START_AGENT_REFUSAL.PLAN_LIMIT_REACHED],
  [HOSTED_API_ERROR.AGENT_PLAN_INELIGIBLE, START_AGENT_REFUSAL.PLAN_INELIGIBLE],
  [HOSTED_API_ERROR.AGENT_CREDENTIAL_MISSING, START_AGENT_REFUSAL.CREDENTIAL_MISSING],
  [HOSTED_API_ERROR.AGENT_API_KEY_UNREADABLE, START_AGENT_REFUSAL.API_KEY_UNREADABLE],
  [HOSTED_API_ERROR.DEVICE_REMOVED, START_AGENT_REFUSAL.DEVICE_REMOVED],
  [HOSTED_API_ERROR.TREE_STOPPED, START_AGENT_REFUSAL.TREE_STOPPED],
]);

/** Why a start on a device refused it, in words the calling model can act on: by what the device refused it for, bar another member's device, which names whose it is (`notOwnerWords`). */
const LOCAL_AGENT_REFUSAL_WORDS = {
  [LOCAL_AGENT_REFUSAL.OFF]:
    "Not started: this task runs its agents on a device, and Local agents is off for the member you start for. Ask them to turn it on, or to change where the task runs.",
  [LOCAL_AGENT_REFUSAL.MAC_AWAY]:
    "Not started: the device this task runs its agents on is away, asleep or with Luke closed, so it cannot take an agent. Try again once it is back, or ask the member to change where the task runs.",
  [LOCAL_AGENT_REFUSAL.CODEX]:
    "Not started: the device this task runs its agents on has no Codex set up yet, so it cannot run this model. Start on a Claude model, or ask the member to change where the task runs.",
  [LOCAL_AGENT_REFUSAL.NO_HARNESS]:
    "Not started: the device this task runs its agents on cannot run this model. Start on another model, or ask the member to change where the task runs.",
  [LOCAL_AGENT_REFUSAL.PREPARING]:
    "Not started: the device this task runs its agents on is still getting ready for local agents, downloading its sandbox. Try again in a few minutes.",
  [LOCAL_AGENT_REFUSAL.SETUP_FAILED]:
    "Not started: the device this task runs its agents on couldn't set up local agents, since its sandbox download failed. Ask the member to choose Retry under This Mac in Settings › Hosts on that Mac, or to restart luke-host on that Linux server, to try again, or to change where the task runs.",
} as const satisfies Record<
  Exclude<LocalAgentRefusal, typeof LOCAL_AGENT_REFUSAL.NOT_OWNER>,
  string
>;

/** Why a start on another member's device refused it, naming the device and its owner where the refusal did. */
function notOwnerWords(device: RefusedDevice | undefined): string {
  const where = device === undefined ? "another member's device" : device.name;
  const who = device?.owner ?? "its owner";
  return `Not started: this task runs on ${where}. Only ${who} can start agents on it, so ask them to, or start the work on a task that runs elsewhere.`;
}

/** Who calls an agent tool: a coding agent from its own session. */
export const AGENT_CALLER = {
  AGENT: "agent",
} as const;

/**
 * Who a call is made by, as the host established it and never as the call
 * said: a coding agent, acting for the member who started it, on its own task.
 */
type AgentCaller = { readonly kind: typeof AGENT_CALLER.AGENT; readonly agent: Agent };

/** What a call of the agent tools runs under: who calls, eve as the deployment acting for the caller's member, the writer, and the key the one message or start is made under. */
export interface AgentCall {
  readonly caller: AgentCaller;
  /** eve's coding-agent service as the deployment acting for the caller's member; nothing where the deployment names no secret or no origin for eve, which sends and starts nothing. */
  readonly eve: AgentSessions | undefined;
  /** eve as the deployment acting for any account, such as the creator an automation's run starts as, whoever fired it; nothing where the deployment names no secret or no origin for eve. */
  readonly eveAs?: ((account: string) => AgentSessions) | undefined;
  readonly writer: Effect.Effect<StoreWriter>;
  /** The key a message or a start is made under: eve's own id for the tool call, so a call run again sends or starts once. */
  readonly clientKey: string;
  /** How a start from another agent summarizes the steps its replay cannot keep, as the Start route's does; none leaves them out unsummarized. */
  readonly summaryModel?: SummaryModelOf | undefined;
}

/** What a message or a start reaches: the store, GitHub through the App on the member's standing, the network to eve, and the catalog a start's choice is checked against. */
export type AgentToolServices = DatabaseServices | HttpClient.HttpClient | GitHubApp | ModelCatalog;

const AGENT_ID = describeWire(
  wireUuidSchema,
  `The agent's id, as ${AGENT_TOOL.LIST_AGENTS} answered it or a message from it named it.`,
);

const READ_AGENT_INPUT = Schema.Struct({ agentId: AGENT_ID });

/** A list of models names, at most, the agent whose change it is for, whose runtime narrows it. */
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

/** A coding agent's read names the agent and, at most, how long a tail it wants. */
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

/** A bound in bytes as a tool's words say it, in megabytes. */
function megabytesOf(bytes: number): string {
  return `${bytes / 1_000_000} MB`;
}

/** A prompt or a note a start may name: bounded apart from a message, since a brief to a worker on a long plan is quoted whole. */
const START_PROMPT = Schema.Trim.check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(AGENT_BOUNDS.MAX_START_WORDS_CHARS),
);

/** A title a start may name: bounded as a rename's is, and never empty, since an empty one names nothing. */
const START_TITLE = Schema.Trim.check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(AGENT_BOUNDS.MAX_TITLE_CHARS),
);

/** A branch a start may name: one git ref's name as GitHub holds it, with no whitespace, which GitHub then confirms. */
const START_BRANCH = Schema.String.check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(255),
  Schema.isPattern(/^[^\s~^:?*[\\]+$/u),
);

/**
 * A start names a prompt at most, a note at most, a branch at most, and a
 * model with its effort or neither; the catalog decides whether the two
 * name anything, and GitHub whether the branch does. A
 * title it names is the agent's from the start, as an automation's run's
 * fixed name is, so no generated title ever covers it; without one the
 * agent is named from its first exchange as any is.
 * Note that the note is what lets one start carry everything: without it a
 * start on the plan had no room for what was said beyond the plan, so the
 * caller started the agent and then messaged it the rest.
 */
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
      "Where you work on no task and name none, the GitHub repository the agent works in, as " +
        "owner/name, which the workspace's GitHub installation must reach; null for none. Leave " +
        "it out for the repository you work in, if any. A task's agent works in the task's own.",
    ),
  ),
  prompt: Schema.optionalKey(
    describeWire(
      START_PROMPT,
      "What the agent should do, typed to it as its first message; the developer's words where " +
        "they named the job. Leave it out to start the agent on the task's plan itself.",
    ),
  ),
  note: Schema.optionalKey(
    describeWire(
      START_PROMPT,
      "Everything else the agent should hear as it starts (what to start with, what to watch out " +
        "for, what to leave alone), handed to it after the plan or the prompt in the same first " +
        "message; leave it out where there is nothing beyond the plan.",
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
        "agent is handed its brief and its transcript (with Luke's summary of the steps that " +
        "do not fit) and a copy of its work, runs on its model unless you name one, and hears " +
        "the note after them; it takes no prompt and no branch. Without messageId it continues " +
        "the agent, which is stopped; with one it forks the agent at that message, which goes on.",
    ),
  ),
});

const readAgentRef = Schema.decodeUnknownResult(READ_AGENT_INPUT);
const readAgentAsked = Schema.decodeUnknownResult(CODER_READ_AGENT_INPUT);

/**
 * A task's change names the task and at least one of what the member's own
 * menu changes of it: its name, its repository, where it stands, and the
 * member's own pin.
 */
const UPDATE_TASK_INPUT = Schema.Struct({
  taskId: describeWire(
    wireUuidSchema,
    `The task's id, as ${AGENT_TOOL.LIST_TASKS} or ${AGENT_TOOL.LIST_AGENTS} answered it, or a ` +
      "mention of it names.",
  ),
  name: Schema.optionalKey(
    describeWire(
      Schema.Trim.check(Schema.isNonEmpty(), Schema.isMaxLength(TASK_BOUNDS.MAX_NAME_CHARS)),
      "Its new name, as the sidebar shows it, which its plan's heading follows.",
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
  blockedBy: Schema.optionalKey(BLOCKED_BY_INPUT),
  blocks: Schema.optionalKey(BLOCKS_INPUT),
});

/**
 * A task's change as a call carries it: one from before a task stopped
 * being archived may still ask for its archive, which settles the task
 * instead, or its unarchive, which puts it back to work (`archive-settle.ts`).
 */
const UPDATE_TASK_CALL = Schema.Struct({
  ...UPDATE_TASK_INPUT.fields,
  archived: Schema.optionalKey(Schema.Boolean),
});

const readTaskUpdate = Schema.decodeUnknownResult(UPDATE_TASK_CALL);
/**
 * A start as a call carries it: one Luke made under the tool's earlier words
 * names its prompt `task`, and one made before `create_task` may name a
 * `newTask`, which is read only to be refused with where to go now.
 */
const START_AGENT_CALL = Schema.Struct({
  ...START_AGENT_INPUT.fields,
  task: Schema.optionalKey(START_PROMPT),
  newTask: Schema.optionalKey(Schema.Unknown),
});

const readStart = Schema.decodeUnknownResult(START_AGENT_CALL);

/** The tools as Luke and every coding agent are offered them: each its name, its words, and its input schema. */
export const LIST_AGENTS_TOOL = {
  name: AGENT_TOOL.LIST_AGENTS,
  description:
    "List the agents of your workspace, on any task or none and started by any member, " +
    "yourself left out: each with its id, its title (how the developer sees it named; a member's operator is named Luke instead), the model " +
    "and effort it runs on with the model's name to say it by, its status (starting, running, " +
    "completed, failed, cancelled) and why where it failed, its repository and the branch its " +
    "sandbox is on if a turn " +
    "has ended, one line of what it last did, its task (id and name; null for " +
    "an agent on no task) and whether that is the task you work on, and whether the agent is " +
    "archived, and its mention, the `[@title](link)` to name it by in your words, " +
    `the newest started first and at most ${WORKSPACE_AGENTS_LIST_LIMIT}. Pass thisTask ` +
    "for only your task's agents, or a taskId for another task's. Call it to find the agent you " +
    "or the developer mean. Failed covers a session that ended for good, which no message " +
    "reaches again: tell the developer, or start a new agent to go on from its work. An agent " +
    "still running long after its last activity may have lost its session; a message to it " +
    "refused as ended for good settles it as failed.",
  inputSchema: AGENT_LIST_INPUT,
} as const;

/** `read_agent` as a coding agent is offered it, which reads the tail as text and may ask for more of it. */
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
    `its taskId as ${AGENT_TOOL.LIST_TASKS} answered it, exactly as the developer's Start ` +
    "button would: on the task's plan itself with no prompt, or on the prompt given in the " +
    "plan's place, with the note after either and any pictures images names, which it sees as " +
    "images. Start it on the task you work on, taskId left " +
    "out, for any part of that task's work, even one that runs apart from yours, so its " +
    "branch, pull request, and transcript stand under that task; name another task only for " +
    "work unrelated to it, or where the developer asked for that, and for work that should " +
    `stand as a task of its own, make it with ${AGENT_TOOL.CREATE_TASK} first. Where you work ` +
    "on no task, taskId left out starts it in your own workspace with no task, in the " +
    "repository you work in or the one repository names, and it needs a prompt, since there is " +
    "no plan to hand it. " +
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
    "mention (earlierContinuations); the developer's operator continues an agent once, and a " +
    "second continuation of it is refused. A start from another agent " +
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
    "workspace or to no one, pin or unpin it in their sidebar, or add and take away the tasks " +
    "it is blocked by and the tasks it blocks; name at least one change, " +
    "and several go in one call. Mark a task whose work is " +
    "done Done, with status done, as the menu's Mark done does, such as one whose pull requests " +
    "merged, or one the developer asked you to clean up; never a teammate's " +
    "task still in use unless the developer asked for it, and as the developer's operator never " +
    "a teammate's task at all, which is refused. A task is never archived: a settled " +
    `one stands Done or Canceled, which ${AGENT_TOOL.LIST_TASKS} lists by status. A block is ` +
    "Linear's: the blocker's work comes first and the task it blocks waits on it, as one child " +
    "task builds on another. It is advice, never a lock, so nothing refuses to start a blocked " +
    "task. Both tasks must be in your workspace, a task never blocks itself, and a block that " +
    "would close a cycle is refused. Answers `accepted` with the task as it now stands, its " +
    "blockedBy and blocks among it where the call changed them, `already` true where every " +
    "change named already stood, or `rejected` and " +
    "why. Then say which tasks you changed and how.",
  inputSchema: UPDATE_TASK_INPUT,
} as const;

export const STOP_AGENT_TOOL = {
  name: AGENT_TOOL.STOP_AGENT,
  description:
    "Stop an agent of your workspace by its id, as the developer's Stop button would: " +
    "its turn under way is cancelled and its status reads cancelled, while the agent stays " +
    "available, its transcript and branch kept, and a later message starts a new turn. Stop " +
    "an agent you or the developer started that is going the wrong way, or one the developer " +
    "asked you to stop; never a teammate's agent still in use unless the developer asked for " +
    "it, and as the developer's operator never a teammate's agent at all, which is refused. No " +
    "agent stops itself, and an archived one is refused. Answers `accepted` with the " +
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

/** Why a change to an agent changed nothing, in words the model can act on; a choice the catalog refused is said with the choices (`choiceRefusal`). */
export const UPDATE_AGENT_REFUSAL = {
  UNREADABLE:
    `Not changed: name the agent by the id ${AGENT_TOOL.LIST_AGENTS} answered and at least one ` +
    `change: a title of at most ${AGENT_BOUNDS.MAX_TITLE_CHARS} characters (empty clears ` +
    "it), a model with its effort, both or neither, a contextWindow only with them, pinned, or " +
    "disabledServers as connection names, or archived, with a reason only where it is true.",
  UNAVAILABLE: "Not changed: the models could not be read just now. The call may be made again.",
  SELF: "Not archived: that id is your own, and an agent does not archive itself; say you are done, and the developer archives you.",
  WORKING:
    "Not archived: that agent is still starting or working, and archiving it would stop a turn no one gets back. " +
    "Wait until it is idle, or ask the developer, who can stop and archive it. Nothing else asked was changed.",
  REPLACED_OPERATOR:
    "Not unarchived: that agent is an operator its member has since replaced with a fresh one, " +
    "which stands in its place; its transcript is kept, and it stays archived.",
  REARCHIVED:
    "Not unarchived: that agent was archived again as it was read, so the archive standing is " +
    `another's; read it again with ${AGENT_TOOL.LIST_AGENTS} and call again if it should still come back.`,
} as const;

/** The lead a refused choice of a change is said under. */
const UPDATE_CHOICE_LEAD = "Not changed";

/** Whether a change names anything to change, and a model only with its effort and a window only with them. */
function updateNamesAChange(update: {
  readonly title?: string;
  readonly model?: string;
  readonly effort?: string;
  readonly contextWindow?: string;
  readonly pinned?: boolean;
  readonly disabledServers?: readonly string[];
  readonly archived?: boolean;
  readonly reason?: string;
}): boolean {
  const { title, model, effort, contextWindow, pinned, disabledServers, archived, reason } = update;
  if ((model === undefined) !== (effort === undefined)) return false;
  if (contextWindow !== undefined && model === undefined) return false;
  if (reason !== undefined && archived !== true) return false;
  return [title, model, pinned, disabledServers, archived].some((field) => field !== undefined);
}

/**
 * A change names the agent and at least one of: a title, the model with its
 * effort and, at most, its context window, which the catalog then checks,
 * whether the member pins it, and the MCP servers switched off for it, the
 * whole list. Each is the change a member makes from the agent's own menu,
 * model chip, or composer.
 */
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
        "its transcript, branch, and pull request kept; only an idle agent is archived, never " +
        "yourself. false to bring an archived one back.",
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
}).check(Schema.makeFilter(updateNamesAChange));

const readUpdateAsked = Schema.decodeUnknownResult(UPDATE_AGENT_INPUT);

export const UPDATE_AGENT_TOOL = {
  name: AGENT_TOOL.UPDATE_AGENT,
  description:
    "Change an agent of your workspace by its id, as the developer's own menu, model " +
    "chip, and composer would, for the developer you work for: rename it (empty clears the " +
    "title), move it to another model and effort, and context window, from its next step, as " +
    `${AGENT_TOOL.LIST_MODELS} lists them, pin or unpin it in that ` +
    "developer's sidebar, replace the list of MCP servers switched off for it, or archive it " +
    "or bring it back. Name at least one change; an archive is checked first, and the rest " +
    "land together or not at all. Archive an idle helper agent whose work is done, such as one " +
    "whose pull request merged, or one the developer asked you to clean up, with a short reason " +
    "its archived banner shows beside your name; one still starting or working is refused, and " +
    "no agent archives itself. Change a teammate's agent still in use only where the developer " +
    "asked for it, and as the developer's operator never, which is refused. Answers `accepted` " +
    "with the agent as it then stands, whether archived among " +
    "it, or `rejected` and why; a rejected model or effort lists the choices. Then say which " +
    "agent you changed and how.",
  inputSchema: UPDATE_AGENT_INPUT,
} as const;

/** A list of tasks names its words to look for at most, and how many of the matching tasks to pass over. */
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

/** How a refusal names a continuation that has no title yet. */
const CONTINUATION_NAME = "its continuation";

const ENTRY_WORDS = {
  SAID: "Said",
} as const;

function cut(text: string, maximumChars: number): string {
  const line = text.replace(/\s+/gu, " ").trim();
  return line.length > maximumChars ? `${line.slice(0, maximumChars - 1)}…` : line;
}

/** A journal's entries in order: each of the agent's own texts, and each call with its subject. */
function entriesOf(journal: StoredUIMessage, maximumChars: number): string[] {
  return journal.parts.flatMap((part) => {
    if (isTextUIPart(part) && part.text.trim().length > 0) {
      return [cut(`${ENTRY_WORDS.SAID}: ${part.text}`, maximumChars)];
    }
    if (isStoredToolPart(part)) return [cut(callEntry(part), maximumChars)];
    return [];
  });
}

/** One agent as the model reads it: its title, what it runs on, where it stands, the branch its row holds, and what it last did. */
interface AgentReading {
  readonly id: string;
  readonly task: AgentTask | null;
  /** Whether the agent works on the call's own task. */
  readonly onYourTask: boolean;
  readonly archived: boolean;
  /** The name the agent goes by apart from its title, as its tab shows it and its mention names it: Luke for an operator, none for any other agent. */
  readonly name?: string;
  /** The agent's title, what it works on, which update_agent renames; the model's id where it has none yet. */
  readonly title: string;
  readonly model: string;
  /** The model as Luke says it and the screen shows it, without the maker's word (`modelLabel`). */
  readonly modelName: string;
  readonly effort: string;
  readonly status: AgentStatus;
  readonly failureReason?: AgentFailure;
  /** The repository it works in; null for an agent with none. */
  readonly repository: string | null;
  readonly branch: string | null;
  readonly activity: string | null;
  /** The agent's mention, `[@title](link)`, as the caller writes it to name the agent in its words. */
  readonly mention: string;
}

/** The newest journals of an agent's conversation, each with its message's id, read under the member who started it, oldest first; none where the page does not read. */
const journalsOf = (agent: Agent, limit: number) =>
  Effect.map(
    listJournals(agent.userId, agent.conversationId, CODER_TOOL_SET, limit),
    (read): readonly StoredMessageRecord[] => (read.ok ? read.value : []),
  );

/** The agents' standings, read once for the lot: each one's newest turn, and whether a line of the developer's awaits one. The agents were read through their workspace's gate, so their conversations are read by id. */
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
      // Why the newest turn failed is said only while the agent reads as failed: a line awaiting the next turn makes it running again.
      return {
        status,
        failureReason: status === AGENT_STATUS.FAILED ? agentFailureOf(turn) : undefined,
      };
    };
  });

/**
 * The models offered as the catalog last read them, or none where it cannot
 * be read: a model is then named from its id, as the screen names it before
 * the catalog arrives.
 */
const offeredModels = Effect.flatMap(ModelCatalog, (catalog) =>
  Effect.orElseSucceed(catalog.read, (): readonly OfferedModel[] => []),
);

const readAgentReading = (
  agent: Agent,
  task: AgentTaskReading,
  standing: {
    readonly status: AgentStatus;
    readonly failureReason: AgentFailure | undefined;
  },
  offered: readonly OfferedModel[],
  workspace: string,
): Effect.Effect<AgentReading, StoreFailure, DatabaseServices> =>
  Effect.gen(function* () {
    const [newest] = yield* journalsOf(agent, 1);
    const activity =
      newest === undefined
        ? undefined
        : entriesOf(newest.message, AGENT_TOOL_BOUNDS.ACTIVITY_CHARS).at(-1);
    return {
      id: agent.id,
      ...task,
      archived: agent.archivedAt !== null,
      ...givenNameOf(agent),
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
  });

/** What the agent published as GitHub holds it, or nothing where GitHub could not be asked, which is said as no publication rather than none. */
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

/** The member a call acts for: the starter of the coding agent calling. */
export function callerUserId(caller: AgentCaller): string {
  return caller.agent.userId;
}

/** The task the caller works on: the coding agent's own, which may be none. */
export function callerTask(caller: AgentCaller): string | null {
  return caller.agent.taskId;
}

/**
 * The workspace the caller reaches agents in, read on its member's standing
 * now as the agent reads itself (`ownAgentWorkspace`); nothing where they no
 * longer reach the agent. Every agent and task its tools act on is still
 * read on the member's own rule (`workspaceAgent`, a start's reach).
 */
export const callerWorkspace = (caller: AgentCaller) =>
  ownAgentWorkspace(caller.agent.userId, caller.agent);

/** An agent of the caller's workspace under the id, with its task, or nothing: one of another workspace, the member's other ones included, or none. */
/** The provider's own harness the agent runs on; none on eve. */
const agentRuntimeOf = (agent: Agent) =>
  Effect.map(nativeRuntimesOfReached([agent.conversationId]), (runtimes) =>
    runtimes.get(agent.conversationId),
  );

const workspaceAgentOf = (caller: AgentCaller, agentId: string) =>
  Effect.gen(function* () {
    const workspace = yield* callerWorkspace(caller);
    if (Option.isNone(workspace)) return Option.none();
    const userId = callerUserId(caller);
    const found = yield* workspaceAgent(userId, workspace.value, agentId, caller.agent.id);
    if (Option.isNone(found)) return Option.none();
    const agent = found.value;
    const task = yield* agentTaskOf(userId, agent);
    return Option.some({
      agent,
      task: taskReading(task, callerTask(caller)),
      workspaceId: workspace.value,
    });
  });

/** Whether the task named is one of the caller's workspace, as its member reads both now. */
const taskOfCallerWorkspace = (caller: AgentCaller, taskId: string) =>
  Effect.gen(function* () {
    const workspace = yield* callerWorkspace(caller);
    if (Option.isNone(workspace)) return false;
    const owning = yield* taskWorkspace(callerUserId(caller), taskId);
    return Option.isSome(owning) && owning.value === workspace.value;
  });

/** A call's refusal as the model reads it, here and at a coding agent's edge for a session it does not admit. */
export function agentToolRejected(reason: string): WireRecord {
  return { status: ACTION_RESULT_STATUS.REJECTED, reason };
}

/** Why the caller may not act on the agent under Steward (`steward.ts`): an operator acts only on its member's own agents. */
function stewardRefused(caller: AgentCaller, agent: Agent, act: StewardAct): string | undefined {
  return stewardRefusal(caller.agent, agent, act);
}

/** Why the caller may not change the task under Steward (`steward.ts`): an operator changes only its member's own tasks. */
function stewardTaskRefused(
  caller: AgentCaller,
  task: { readonly ownerId: string },
): string | undefined {
  return stewardTaskRefusal(caller.agent, task);
}

/** Why the caller may not continue the agent again under Steward (`steward.ts`): an operator continues an agent once. */
function stewardContinuedRefused(
  caller: AgentCaller,
  continuedBefore: boolean,
): string | undefined {
  return stewardContinuedRefusal(caller.agent, continuedBefore);
}

/** A refusal's words, with when a plan's reached limit resets where the provider said, and which harness to connect where a credential is missing. */
function withReset(words: string, refusal: HostedRefusal): string {
  if (refusal.provider !== undefined) {
    return `${words} The model's provider is connected as ${harnessNameOf(refusal.provider)}.`;
  }
  return refusal.resetsAt === undefined
    ? words
    : `${words} It resets at ${new Date(refusal.resetsAt).toISOString()}.`;
}

/** A start's refusal in the model's words. */
function startRefusalWords(refusal: HostedRefusal): string {
  if (refusal.localAgentRefusal === LOCAL_AGENT_REFUSAL.NOT_OWNER) {
    return notOwnerWords(refusal.refusedDevice);
  }
  if (refusal.localAgentRefusal !== undefined) {
    return LOCAL_AGENT_REFUSAL_WORDS[refusal.localAgentRefusal];
  }
  return withReset(
    START_REFUSAL_WORDS.get(refusal.error) ?? START_AGENT_REFUSAL.UNAVAILABLE,
    refusal,
  );
}

/** A choice the catalog refused, the one named or the member's stored default, said with every model offered and the efforts each lists, so the model can try again or ask. */
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

/** The name an answer names an agent by apart from its title: Luke for an operator, none for any other agent. */
function givenNameOf(agent: Agent): { name?: string } {
  const name = agentGivenName(agent);
  return name === undefined ? {} : { name };
}

/** The agent's mention under the workspace's step, by the agent whichever task it works on, named as its tab is. */
function agentMention(agent: Agent, workspace: string): string {
  return writtenMention(
    { kind: MENTION_KIND.AGENT, agentId: agent.id },
    agentName(agent),
    workspace,
  );
}

/** How a coding agent names itself to another: its title, its id to answer it by, and its repository where it has one. */
function agentIntroduction(agent: Agent): string {
  const working = agent.repository === null ? "" : `, working in ${agent.repository}`;
  return `"${agentName(agent)}" (agent id ${agent.id})${working}`;
}

/**
 * The note an agent a coding agent starts is handed: which agent started it,
 * that it reports back with `message_agent` by that agent's id, as every
 * word between two agents goes (`coder-host/agent-message.ts`), and that
 * the threads the developer reads are its starter's to post, so what it
 * would post in one goes to its starter, who relays what the developer must
 * see, then the note it was given.
 */
function startedByNote(starter: Agent, note: string | undefined): string {
  const lead =
    `You were started by another agent of your workspace, ${agentIntroduction(starter)}, ` +
    `not by the developer. To report back to it, call ${AGENT_TOOL.MESSAGE_AGENT} with its agentId, ${starter.id}. ` +
    "Threads to the developer are that agent's to post: post none yourself, and send that agent what " +
    "you would have posted in one instead, a pull request ready for review, a decision, a question, " +
    "or something only the developer can do by hand.";
  return note === undefined ? lead : `${lead}\n\n${note}`;
}

/** The agent as a start answers it: its id, what it runs on, where it stands now, and whether it is on the caller's own task, which a window that opens the caller's task alone reads to link it or not. */
const startedReading = (agent: Agent, offered: readonly OfferedModel[], ownTask: string | null) =>
  Effect.gen(function* () {
    const standing = yield* standingsOf([agent]);
    const workspace = yield* workspaceStepOf(agent.userId, agent.organizationId);
    return {
      id: agent.id,
      ...givenNameOf(agent),
      model: agent.model,
      modelName: modelLabel(agent.model, offered),
      effort: agent.effort,
      status: standing(agent).status,
      onYourTask: agent.taskId !== null && agent.taskId === ownTask,
      mention: agentMention(agent, workspace),
    };
  });

/** A store that could not be read is the one refusal, logged for the operator and said to the model. */
export const orStoreRefusal = <R>(
  effect: Effect.Effect<WireRecord, StoreFailure, R>,
): Effect.Effect<WireRecord, never, R> =>
  Effect.catch(effect, (failure) =>
    Effect.as(logStoreFailure(failure), agentToolRejected(AGENT_TOOL_REFUSAL.STORE)),
  );

/** The repository the caller works in: the calling agent's own; none where it names none. */
export const workedRepository = (caller: AgentCaller) =>
  Effect.succeed<string | null>(caller.agent.repository);

/**
 * What a call made before, run again after its start landed: the agent made
 * under its key, while that agent is still of the caller's workspace, and
 * refused as naming no task once it has moved out of it, so a retry neither
 * starts a second agent nor tells of one in a workspace the caller left
 * behind; nothing where the call made no agent.
 */
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
    // A continue run again names the agents that continued its source before it, as its first answer did.
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

/** An agent as the reading spells it, which the wire holds to be JSON all the way down. */
function readingRecord(reading: AgentReading): WireRecord {
  return { ...reading, task: reading.task === null ? null : { ...reading.task } };
}

/** One call of `list_agents`: every agent of the caller's workspace, or of one task of it, the calling agent left out, archived ones marked, newest first. */
export function runListAgents(
  call: AgentCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, AgentToolServices> {
  const { caller } = call;
  const ownTask = callerTask(caller);
  const narrowed = listedTask(input, ownTask);
  if (Result.isFailure(narrowed)) {
    return Effect.succeed(
      agentToolRejected(narrowed.failure ?? AGENT_TOOL_REFUSAL.UNREADABLE_FILTER),
    );
  }
  return orStoreRefusal(
    Effect.gen(function* () {
      const workspace = yield* callerWorkspace(caller);
      if (Option.isNone(workspace)) return agentToolRejected(AGENT_TOOL_REFUSAL.NO_WORKSPACE);
      const { agents, taskOf } = yield* workspaceAgentsOf(callerUserId(caller), workspace.value, {
        taskId: narrowed.success,
        except: caller.agent.id,
      });
      const standing = yield* standingsOf(agents);
      const offered = yield* offeredModels;
      const step = yield* workspaceStepOf(callerUserId(caller), workspace.value);
      const readings = yield* Effect.forEach(agents, (agent) =>
        readAgentReading(
          agent,
          taskReading(taskOf(agent), ownTask),
          standing(agent),
          offered,
          step,
        ),
      );
      return { status: ACTION_RESULT_STATUS.ACCEPTED, agents: readings.map(readingRecord) };
    }),
  );
}

/**
 * The newest entries of an agent's transcript, as many as asked where it
 * has them, each with the id of the message it stands in, which a fork
 * names (`start_agent`'s `from`). Note that the newest turns are read first and older ones only
 * where those fall short, because a coding agent's one turn is often its
 * whole run, long enough on its own; and that the second read takes as many
 * turns as entries asked, since a turn that ended carries at least one.
 */
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

/** One call of `read_agent`: the agent as the list reads it, and the tail of its newest turns, as long as asked and each entry cut for the caller. */
export function runReadAgent(
  call: AgentCall,
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
      const reading = yield* readAgentReading(
        agent,
        task,
        standing(agent),
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

/** An agent that already continued the one a start continues, as the start's answer names it: its id and its mention. */
interface EarlierContinuation {
  readonly id: string;
  readonly mention: string;
}

/** Where a start from another agent lands: the source's own place, its task or, with none, its workspace and repository, and, for a continue, the agents that already continued the source, oldest first. */
interface SourceLanding {
  readonly place: StartWhere;
  readonly continuedBy: readonly EarlierContinuation[];
}

/**
 * The agents that continued a source, oldest first, each by its id and its
 * mention, up to the one named `upTo`, which is left out with every agent
 * after it; all of them where none is named. A fork is no continuation.
 */
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

/**
 * Whether the agent is started, directly or through the agents between,
 * by the ancestor, read on the starter links as stored now, since a pilot's
 * takeover moves them after an agent's session began. The links form a
 * chain that ends at an agent with no starter; one already seen ends it.
 */
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

/** The place a start from another agent lands in, the source's own, once the source is read and found fit to start from, with the agents that already continued it; or why it is not. */
const sourceLanding = (
  caller: AgentCaller,
  from: AgentStartFrom,
  named: string | undefined,
): Effect.Effect<Result.Result<SourceLanding, string>, StoreFailure, DatabaseServices> =>
  Effect.gen(function* () {
    const found = yield* workspaceAgentOf(caller, from.agentId);
    if (Option.isNone(found)) return Result.fail(START_AGENT_REFUSAL.NO_SOURCE);
    const { agent: source, workspaceId } = found.value;
    const steward = stewardRefused(caller, source, STEWARD_ACT.START_FROM);
    if (steward !== undefined) return Result.fail(steward);
    if (!controlsAgent(callerUserId(caller), source)) {
      return Result.fail(`Not started: only ${yield* agentStarterName(source)} can do this.`);
    }
    if (named !== undefined && named !== source.taskId) {
      return Result.fail(START_AGENT_REFUSAL.SOURCE_OTHER_TASK);
    }
    // An agent with no task is started from in its own workspace, on the repository it cloned.
    const place = placeOfAgent(source);
    if (place === undefined) return Result.fail(START_AGENT_REFUSAL.SOURCE_NO_REPOSITORY);
    // A fork names one of the source's own messages, and leaves the source going on beside it.
    if (from.messageId !== undefined) {
      const { userId, conversationId } = source;
      const role = MESSAGE_ROLE.ASSISTANT;
      const at = yield* messageSeqOf(userId, conversationId, from.messageId, role);
      if (Option.isNone(at)) return Result.fail(START_AGENT_REFUSAL.NO_MESSAGE);
      return Result.succeed({ place, continuedBy: [] });
    }
    // Note that a continue of an agent that started the caller records the caller as the new agent's starter and, for a pilot, moves the agents it started under it, so the two would name each other.
    if (yield* startedThrough(callerUserId(caller), caller.agent.id, source.id)) {
      return Result.fail(START_AGENT_REFUSAL.STARTER_CONTINUE);
    }
    // A continue takes over work that has ended; one already continued is
    // continued again, since a continuation may itself fail or go wrong, and
    // the answer names the earlier ones so the caller knows they stand; an
    // operator alone is refused the second (`steward.ts`).
    const { status } = (yield* standingsOf([source]))(source);
    if (status === AGENT_STATUS.STARTING || status === AGENT_STATUS.RUNNING) {
      return Result.fail(START_AGENT_REFUSAL.SOURCE_RUNNING);
    }
    const at = { userId: callerUserId(caller), workspaceId, taskId: source.taskId };
    const continuedBy = yield* earlierContinuationsOf(at, source.id);
    const continued = stewardContinuedRefused(caller, continuedBy.length > 0);
    if (continued !== undefined) return Result.fail(continued);
    return Result.succeed({ place, continuedBy });
  });

/** What a continue's answer adds where other agents already continued its source: those agents, oldest first, the one it started left out; nothing otherwise. */
function earlierContinuations(
  continuedBy: readonly EarlierContinuation[] | undefined,
  startedId: string,
): WireRecord {
  const earlier = (continuedBy ?? []).filter((each) => each.id !== startedId);
  return earlier.length === 0 ? {} : { earlierContinuations: earlier.map((each) => ({ ...each })) };
}

/** A start's refusal in the model's words, said of the source where the start named one: one that is none of the caller's, or a message that is none of the source's; and of the pilot a fresh start would have made. */
function startFromRefusalWords(refusal: HostedRefusal, from: AgentStartFrom | undefined): string {
  // Note that a fresh start is refused as not permitted only where it would be a pilot task's pilot.
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

/** Who hands pictures on in the caller's name: the coding agent its own conversation's. */
function forwarderOf(caller: AgentCaller): ImageForwarder {
  return {
    userId: callerUserId(caller),
    conversationId: caller.agent.conversationId,
  };
}

/**
 * The caller's own place, which a start on no task lands in: its
 * workspace, with no task, and the repository named, or the caller's own
 * where none is, which is none for the member's operator.
 */
function ownPlaceOf(
  agent: Pick<Agent, "organizationId" | "repository">,
  named: string | null | undefined,
): StartWhere {
  const repository = named === undefined ? agent.repository : named;
  const { organizationId } = agent;
  return repository === null
    ? { taskId: null, organizationId, repository: null }
    : { taskId: null, organizationId, repository };
}

/** Why a start's input asks for nothing that can start, read before anything is: a repository for an agent that lands on a task or with its source, a source with a prompt or a branch, or a coding agent continuing itself. */
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
  const self = from.agentId === caller.agent.id;
  return self && from.messageId === undefined ? START_AGENT_REFUSAL.SELF_CONTINUE : undefined;
}

/**
 * One call of `start_agent`: an agent started under the call's own key on
 * the caller's own task, another of its workspace, or the task of the agent
 * it starts from, or why nothing was started. A call naming `newTask`, as a
 * start did before `create_task` made tasks, is refused with where to go
 * now, rather than started on the caller's own task. Note that a start from another agent
 * can take tens of seconds, a copy of its work and a summary of its
 * transcript among them, which the call is let run: eve's workflow step runs
 * a tool to the function's own bound, and the copy and the summary each hold
 * to their own timeouts well inside it (`snapshot.ts`, `replay-summary.ts`).
 */
export function runStartAgent(
  call: AgentCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, AgentToolServices> {
  const asked = readStart(input);
  // A choice is one thing: a model without its effort, or the reverse, names nothing to run on.
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
  if (eve === undefined) return Effect.succeed(agentToolRejected(START_AGENT_REFUSAL.NO_SERVICE));
  const userId = callerUserId(caller);
  return orStoreRefusal(
    Effect.gen(function* () {
      // Another task, or another agent's, is started on only where it is of the caller's
      // own workspace; a call run again after its start landed answers what it made
      // (`startedBefore`), before a source is read, which its own continue has since stopped,
      // or the pictures it named, which may be gone since.
      const elsewhere = from !== undefined || (named !== undefined && named !== ownTask);
      if (elsewhere || asked.success.images !== undefined) {
        const before = yield* startedBefore(call);
        if (Option.isSome(before)) return before.value;
      }
      if (from === undefined && named !== undefined && named !== ownTask) {
        const reached = yield* taskOfCallerWorkspace(caller, named);
        if (!reached) return agentToolRejected(START_AGENT_REFUSAL.NO_SUCH_TASK);
      }
      // A start from another agent lands in that agent's own place, its task or its workspace.
      const landing = from === undefined ? undefined : yield* sourceLanding(caller, from, named);
      if (landing !== undefined && Result.isFailure(landing)) {
        return agentToolRejected(landing.failure);
      }
      // A caller on no task starts beside itself where it names none, handing words alone.
      const taskId = named ?? ownTask;
      const place: StartWhere | undefined =
        landing?.success.place ??
        (taskId !== null
          ? { taskId }
          : caller.kind === AGENT_CALLER.AGENT
            ? ownPlaceOf(caller.agent, asked.success.repository)
            : undefined);
      if (
        place === undefined ||
        (place.taskId === null && from === undefined && prompt === undefined)
      ) {
        return agentToolRejected(START_AGENT_REFUSAL.NO_PROMPT);
      }
      if (
        place.taskId === null &&
        place.repository === null &&
        asked.success.branch !== undefined
      ) {
        return agentToolRejected(START_AGENT_REFUSAL.BRANCH_NO_REPOSITORY);
      }
      // The pictures it is handed are read as the caller may read them, and refused whole where one is not.
      const images =
        asked.success.images === undefined
          ? Result.succeed([])
          : yield* forwardedImages(forwarderOf(caller), asked.success.images);
      if (Result.isFailure(images)) {
        return agentToolRejected(`Not started: ${forwardedImageRefusalWords(images.failure)}`);
      }
      // An agent a coding agent starts hears who started it, and that it reports back to it by message.
      const note = startedByNote(caller.agent, asked.success.note);
      const started = yield* startAgent(Effect.succeed(eve), userId, {
        ...place,
        idempotencyKey: call.clientKey,
        choice,
        prompt,
        note,
        attachments: images.success,
        title: asked.success.title,
        branch: asked.success.branch,
        from,
        summaryModel: call.summaryModel,
        noteHeading: START_NOTE_HEADING.AGENT,
        startedBy: caller.agent,
      }).pipe(Effect.result);
      if (Result.isFailure(started)) {
        const refusal = started.failure;
        if (refusal instanceof ModelChoiceRefused) {
          // The choices are the models the start was checked against, so no second read can lose them.
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

/** Who an archive is by: the calling coding agent by its id and name, for the member the caller acts for, with the reason given. */
function archiverOf(caller: AgentCaller, reason: string | undefined): StoredArchive {
  const why = reason === undefined ? undefined : { reason };
  return {
    by: AGENT_ARCHIVER.AGENT,
    userId: caller.agent.userId,
    agentId: caller.agent.id,
    agentName: agentName(caller.agent),
    ...why,
  };
}

/**
 * Whether an agent stands idle for an archive: no line awaits its turn, its
 * newest turn is neither queued nor running, a Stop requested of it or not,
 * since a stopped turn still runs until eve ends it, and it is past its
 * start where it has no turn yet.
 */
const idleForArchive = (agent: Agent) =>
  Effect.gen(function* () {
    const turns = yield* latestTurnsOfReached([agent.conversationId]);
    const awaiting = yield* awaitingLinesOfReached([agent.conversationId]);
    const now = yield* Clock.currentTimeMillis;
    const turn = turns.get(agent.conversationId);
    if (lineAwaitsTurn(turn, { now, awaitingLineAt: awaiting.get(agent.conversationId) })) {
      return false;
    }
    if (turn !== undefined) return !RUNNING_TURN_STATUSES.has(turn.status);
    return (
      agentStatusOf(undefined, {
        createdAt: agent.createdAt,
        now,
        blank: startedBlank(agent),
      }) !== AGENT_STATUS.STARTING
    );
  });

/**
 * An agent archived for the caller's member, by the caller and for the reason
 * given, as the Archive agent menu archives it, only while it stands idle,
 * read idle under its conversation's lock, so a turn queued or a message
 * handed over meanwhile waits on the archive and is seen by it; or brought
 * back, only the archive read cleared, so one made again since stands as its
 * maker left it. An archive or an unarchive already standing is no refusal.
 * Answers why nothing was changed, or nothing where the change stands.
 */
const archiveChange = (
  caller: AgentCaller,
  agent: Agent,
  archived: boolean,
  reason: string | undefined,
) =>
  Effect.gen(function* () {
    const userId = callerUserId(caller);
    if (archived) {
      const outcome = yield* archiveIdleAgent(
        userId,
        agent.id,
        archiverOf(caller, reason),
        idleForArchive,
      );
      if (outcome === IDLE_ARCHIVE.NOT_FOUND) return AGENT_TOOL_REFUSAL.NO_AGENT;
      if (outcome === IDLE_ARCHIVE.WORKING) return UPDATE_AGENT_REFUSAL.WORKING;
      // A local agent archived now is let go of on its device, as an archive by hand lets it go.
      // Note that the agent's line is queued under its starter, whoever archived it.
      if (outcome === IDLE_ARCHIVE.ARCHIVED) {
        yield* discardedOrLogged({ id: agent.id, userId: agent.userId });
      }
      return undefined;
    }
    if (agent.archivedAt === null) return undefined;
    // An operator a Reset replaced stays archived while the fresh one stands.
    if (yield* operatorReplaced(userId, agent.id)) return UPDATE_AGENT_REFUSAL.REPLACED_OPERATOR;
    if (yield* unarchiveAgentFrom(userId, agent.id, agent.archivedAt)) return undefined;
    const now = yield* readAgent(userId, agent.id);
    return Option.isSome(now) && now.value.archivedAt === null
      ? undefined
      : UPDATE_AGENT_REFUSAL.REARCHIVED;
  });

/**
 * A task's key, where it stands, how much it matters, and who it is assigned
 * to, as every task tool answers them: its key drawn from its workspace's
 * name as the member reads it (`workspace-key.ts`), and its assignee by their
 * mention link under the workspace's step (`task-assignee.ts`); null for any
 * a service before them left out, and for a task no one is assigned to.
 */
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

/** What a task's answer says beside the task: whether every change named already stood, the section it was placed in, and whether the call named its blocks. */
interface TaskUpdateAnswered {
  readonly already: boolean;
  readonly section: TaskSectionReading | null | undefined;
  readonly blocksNamed: boolean;
}

/** A task's change as the model reads it: the task as it now stands, with its mention, its blocks where the call named them, and whether every change named already stood before the call. */
const taskUpdateAnswer = (
  userId: string,
  task: StoredTask["task"],
  { already, section, blocksNamed }: TaskUpdateAnswered,
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
        mention: writtenMention({ kind: MENTION_KIND.TASK, taskId: task.id }, task.name, step),
        ...(section === undefined
          ? undefined
          : { section: section === null ? null : { ...section } }),
        ...blocks,
      },
      already,
    };
    return answer;
  });

/** A sidebar section as an answer names it. */
interface TaskSectionReading {
  readonly id: string;
  readonly title: string;
}

/**
 * Where a task is asked to stand in its member's sidebar, read before
 * anything is written: the section of the caller's workspace named, none for
 * null, the refusal's words for a section of no workspace of the caller's,
 * and whether the task already stands there.
 */
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

/**
 * Whether every change named already stands on the task as its member reads
 * it. Note that a repository confirmed again stands only where it is reached
 * as the task records it, because the write records the access it was reached
 * through.
 */
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

/** A repository's refusal in the model's words: one the installation does not reach, GitHub not answering, or else the service down. */
function repositoryRefusalWords(refusal: HostedRefusal): string {
  if (refusal.error === HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE) {
    return UPDATE_TASK_REFUSAL.NOT_REACHABLE;
  }
  return refusal.error === HOSTED_API_ERROR.GITHUB_UNANSWERED
    ? UPDATE_TASK_REFUSAL.GITHUB_UNANSWERED
    : AGENT_TOOL_REFUSAL.STORE;
}

/** A repository as a task records it: its name as GitHub spells it, none where it is cleared, and how it was reached. */
interface RecordedRepository {
  readonly repository: string | null;
  readonly githubAccess: GitHubAccess;
}

/**
 * A repository confirmed as the menu's PATCH confirms one, through the
 * workspace's installation or else the member's own token, or the refusal's
 * words; none clears it.
 */
export const reachedRepository = (
  workspaceId: string,
  repository: string | null,
  member: string | undefined,
) =>
  repository === null
    ? Effect.succeed<Result.Result<RecordedRepository, string>>(
        Result.succeed({ repository: null, githubAccess: GITHUB_ACCESS.APP }),
      )
    : Effect.map(
        Effect.result(workspaceRepository(workspaceId, repository, member)),
        (reached): Result.Result<RecordedRepository, string> =>
          Result.isSuccess(reached)
            ? Result.succeed({
                repository: reached.success.repository.fullName,
                githubAccess: reached.success.access,
              })
            : Result.fail(repositoryRefusalWords(reached.failure)),
      );

/**
 * One call of `update_task`: a task of the caller's workspace changed as the
 * member's own menu changes it (`updateTask`, which `tasks-app.ts`'s PATCH
 * runs), for the member the caller acts for, its repository confirmed first
 * as the PATCH confirms one, or why not. Note that the task is read first, on
 * that member's standing, both to hold it to the caller's workspace and to
 * tell a change already standing, which the store keeps as it stood; that an
 * operator is refused a teammate's task under Steward (`../steward.ts`); and
 * that the caller never archives the task it works on.
 */
export function runUpdateTask(
  call: AgentCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, AgentToolServices> {
  const asked = readTaskUpdate(input);
  if (Result.isFailure(asked)) {
    return Effect.succeed(agentToolRejected(UPDATE_TASK_REFUSAL.UNREADABLE));
  }
  const { taskId, sectionId, assignee, archived, blockedBy, blocks, ...named } = asked.success;
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
      const steward = stewardTaskRefused(caller, read.value);
      if (steward !== undefined) return agentToolRejected(steward);
      // Where it is asked to stand in the sidebar is read before anything is written.
      const placing =
        sectionId === undefined
          ? undefined
          : yield* sectionAsked(userId, workspace.value, taskId, sectionId);
      if (placing !== undefined && Result.isFailure(placing)) {
        return agentToolRejected(placing.failure);
      }
      // So are the tasks its blocks name, each held to the workspace and to Steward as the task itself is.
      const blocking = blockChangesNamed(blockChanges)
        ? yield* blockWritesAsked(userId, workspace.value, taskId, blockChanges, (other) =>
            stewardTaskRefused(caller, other),
          )
        : undefined;
      if (blocking !== undefined && Result.isFailure(blocking)) {
        return agentToolRejected(blocking.failure);
      }
      // Note that a teammate names a repository on the App alone, never their own token, because a task on a token is its owner's.
      const owner = read.value.ownerId === userId ? userId : undefined;
      const repository =
        changes.repository === undefined
          ? undefined
          : yield* reachedRepository(workspace.value, changes.repository, owner);
      if (repository !== undefined && Result.isFailure(repository)) {
        return agentToolRejected(repository.failure);
      }
      // An archive from an older call settles the task, and an unarchive puts it back to work; a status named beside either is the one written.
      const status =
        changes.status !== undefined || archived === undefined
          ? changes.status
          : yield* archiveAskedStatus(
              userId,
              taskId,
              read.value.task.status ?? TASK_STATUS.TODO,
              archived,
            );
      // A repository is compared as GitHub spells it, which is how the task holds it.
      const asWritten = {
        ...changes,
        ...(status === undefined ? undefined : { status }),
        ...(repository === undefined
          ? undefined
          : {
              repository: repository.success.repository,
              githubAccess: repository.success.githubAccess,
            }),
      };
      const stands = changesStand(read.value, asWritten) && (placing?.success.stands ?? true);
      // The task's change, its place in the sidebar, and its blocks are one transaction, so a place
      // refused, its section deleted meanwhile, or a block refused takes the change back with it.
      const writing = Effect.gen(function* () {
        // Every task the blocks name is locked before the task's change, so the change takes no lock first that another call's blocks wait on.
        if (blocking !== undefined) {
          yield* lockTasksForBlocks(userId, tasksOfWrites(blocking.success));
        }
        const task =
          Object.keys(asWritten).length === 0
            ? Option.some(read.value.task)
            : yield* updateTask(userId, taskId, asWritten);
        if (Option.isSome(task) && placing !== undefined && !placing.success.stands) {
          // The sidebar's own write puts it in the section named, or in none, as the developer's drag does.
          const placed = yield* writeTaskSections(userId, {
            kind: TASK_SECTION_WRITE.PLACE,
            taskId,
            sectionId: placing.success.section?.id ?? null,
          });
          if (Option.isNone(placed)) return yield* Effect.fail(new TaskPlaceRefused());
        }
        const blocksChanged =
          Option.isSome(task) && blocking !== undefined
            ? yield* writeTaskBlocks(userId, blocking.success)
            : false;
        return { task, blocksChanged };
      });
      const changed = yield* Effect.flatMap(SqlClient.SqlClient, (client) =>
        client.withTransaction(writing),
      ).pipe(
        Effect.map(
          (
            written,
          ): Result.Result<
            { task: Option.Option<StoredTask["task"]>; blocksChanged: boolean },
            string
          > => Result.succeed(written),
        ),
        Effect.catchTag("TaskAssigneeNotMember", () =>
          Effect.succeed(Result.fail(UPDATE_TASK_REFUSAL.NOT_MEMBER)),
        ),
        Effect.catchTag("TaskPlaceRefused", () =>
          Effect.succeed(Result.fail(UPDATE_TASK_REFUSAL.NO_SECTION)),
        ),
        Effect.catchTag("TaskBlockRefused", ({ words }) => Effect.succeed(Result.fail(words))),
        Effect.catchTag("TaskTreeRepositoryLocked", () =>
          Effect.succeed(Result.fail(UPDATE_TASK_REFUSAL.TREE_REPOSITORY)),
        ),
      );
      if (Result.isFailure(changed)) return agentToolRejected(changed.failure);
      const { task, blocksChanged } = changed.success;
      if (Option.isNone(task)) return agentToolRejected(UPDATE_TASK_REFUSAL.NO_TASK);
      return yield* taskUpdateAnswer(userId, task.value, {
        already: stands && !blocksChanged,
        section: placing?.success.section,
        blocksNamed: blocking !== undefined,
      });
    }),
  );
}

/** A stop's refusal in the model's words: an agent gone meanwhile is none, a deployment with no eve says so, and anything else is the service down. */
function stopRefusalWords(refusal: HostedRefusal, eve: AgentSessions | undefined): string {
  if (refusal.error === HOSTED_API_ERROR.NOT_FOUND) return AGENT_TOOL_REFUSAL.NO_AGENT;
  if (refusal.error === HOSTED_API_ERROR.NATIVE_AGENT_NOT_HERE) {
    return STOP_AGENT_REFUSAL.NATIVE_NOT_HERE;
  }
  return eve === undefined ? STOP_AGENT_REFUSAL.NO_SERVICE : STOP_AGENT_REFUSAL.UNAVAILABLE;
}

/** Whether a Stop already stands on the turn, which is still ending. */
function stopStands(turn: AgentLatestTurn | undefined): boolean {
  return (
    turn !== undefined && RUNNING_TURN_STATUSES.has(turn.status) && turn.cancelRequestedAt !== null
  );
}

/**
 * The agent stopped as the Stop button stops it under the call's key, and
 * where it stands: whether it was stopped, by this call now or when it first
 * ran, by eve taking its cancel, or by a Stop already standing on the turn
 * it stood on as the call began and still stands on, and its status read
 * after. A call run again finds the turn it stopped by its key and cancels
 * nothing, so a turn begun since, by a message the agent took meanwhile,
 * runs on. Note that eve is asked for only where there is a turn to cancel,
 * so a deployment with no eve still answers an idle agent as idle.
 */
const stopOf = (
  eve: AgentSessions | undefined,
  writer: Effect.Effect<StoreWriter>,
  agent: Agent,
  key: string,
  by: string,
) =>
  Effect.gen(function* () {
    const earlier = yield* hostedStoreOrUnavailable(
      turnStoppedUnderReached(agent.conversationId, key),
    );
    const before = (yield* turnStandingsOf([agent.conversationId]))(agent.conversationId);
    const eveOf = eve === undefined ? Effect.fail(HOSTED_REFUSAL.UNAVAILABLE) : Effect.succeed(eve);
    const cancelled = earlier ? false : yield* cancelledTurn(eveOf, writer, agent, { key, by });
    const after = (yield* turnStandingsOf([agent.conversationId]))(agent.conversationId);
    const status = agentStatusOf(after.turn, {
      createdAt: agent.createdAt,
      now: yield* Clock.currentTimeMillis,
      awaitingLineAt: after.awaitingLineAt,
      blank: startedBlank(agent),
    });
    const standing = stopStands(before.turn) && after.turn?.id === before.turn?.id;
    return { stopped: earlier || cancelled || standing, status };
  });

/** One call of `stop_agent`: the turn under way of an agent of the caller's workspace stopped as a Stop stops it, an idle one answered as idle, or why nothing was stopped. */
export function runStopAgent(
  call: AgentCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, AgentToolServices> {
  const asked = readAgentRef(input);
  if (Result.isFailure(asked)) {
    return Effect.succeed(agentToolRejected(STOP_AGENT_REFUSAL.UNREADABLE));
  }
  const { agentId } = asked.success;
  const { caller, eve } = call;
  if (agentId === caller.agent.id) {
    return Effect.succeed(agentToolRejected(STOP_AGENT_REFUSAL.SELF));
  }
  return orStoreRefusal(
    Effect.gen(function* () {
      const found = yield* workspaceAgentOf(caller, agentId);
      if (Option.isNone(found)) return agentToolRejected(AGENT_TOOL_REFUSAL.NO_AGENT);
      const { agent, task } = found.value;
      const steward = stewardRefused(caller, agent, STEWARD_ACT.STOP);
      if (steward !== undefined) return agentToolRejected(steward);
      if (agent.archivedAt !== null) return agentToolRejected(STOP_AGENT_REFUSAL.ARCHIVED);
      if (!(yield* writesAsPlanPolicy(callerUserId(caller), agent))) {
        return agentToolRejected(
          `Not stopped: ${yield* agentStarterName(agent)}'s own subscription pays for that agent, so only they and their agents can stop it.`,
        );
      }
      const stop = yield* Effect.result(
        stopOf(eve, call.writer, agent, call.clientKey, caller.agent.id),
      );
      if (Result.isFailure(stop)) return agentToolRejected(stopRefusalWords(stop.failure, eve));
      // Note that a Stop already standing on a turn still ending is this call's own run again, or
      // the developer's, and is answered as stopped so a call run again reads as it first did.
      const { stopped, status } = stop.success;
      const working = status === AGENT_STATUS.STARTING || status === AGENT_STATUS.RUNNING;
      if (!stopped && working) return agentToolRejected(STOP_AGENT_REFUSAL.NOT_READY);
      return {
        status: ACTION_RESULT_STATUS.ACCEPTED,
        agent: {
          id: agent.id,
          ...givenNameOf(agent),
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

/** A change to an agent that found no row to write: the agent left the caller's reach as it was changed. */
class AgentChangeLost extends Data.TaggedError("AgentChangeLost") {}

/** A task's place in a section refused inside its change's transaction, its section gone meanwhile, which takes the change back. */
class TaskPlaceRefused extends Data.TaggedError("TaskPlaceRefused") {}

/** An archive or an unarchive refused inside a change's transaction, its words for the model, which takes every change back. */
class AgentChangeRefused extends Data.TaggedError("AgentChangeRefused")<{
  readonly refusal: string;
}> {}

/** The changes a call asks of an agent, each already read and its choice already the catalog's. */
interface AgentChanges {
  readonly title: string | undefined;
  readonly choice: ModelChoice | undefined;
  readonly pinned: boolean | undefined;
  readonly disabledServers: readonly string[] | undefined;
}

/**
 * Writes every change asked of an agent in one transaction and answers the
 * agent as the last write left it, nothing where none was asked; a write that
 * finds no row fails it, so either every change stands or none does.
 */
const changedAgent = (userId: string, agentId: string, changes: AgentChanges) =>
  Effect.flatMap(SqlClient.SqlClient, (client) =>
    client.withTransaction(
      Effect.gen(function* () {
        const kept = (changed: Option.Option<Agent>) =>
          Option.isSome(changed) ? Effect.succeed(changed) : Effect.fail(new AgentChangeLost());
        const { title, choice, pinned, disabledServers } = changes;
        let last = Option.none<Agent>();
        if (title !== undefined) {
          last = yield* kept(
            yield* renameAgent(userId, agentId, title.length === 0 ? null : title),
          );
        }
        if (choice !== undefined)
          last = yield* kept(yield* updateAgentChoice(userId, agentId, choice));
        if (pinned !== undefined) last = yield* kept(yield* pinAgent(userId, agentId, pinned));
        if (disabledServers !== undefined) {
          last = yield* kept(yield* updateAgentServers(userId, agentId, disabledServers));
        }
        return last;
      }),
    ),
  );

/**
 * One call of `update_agent`: an agent of the caller's workspace renamed,
 * moved to another choice the catalog takes, pinned or unpinned for the
 * caller's member, or given another list of servers switched off, each by
 * the store's own write the agent's menu, chip, and composer make. A choice
 * is checked before anything is written, so one refused changes nothing, and
 * every change asked is written in one transaction, so none stands where
 * another failed.
 */
export function runUpdateAgent(
  call: AgentCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, AgentToolServices> {
  const asked = readUpdateAsked(input);
  if (Result.isFailure(asked)) {
    return Effect.succeed(agentToolRejected(UPDATE_AGENT_REFUSAL.UNREADABLE));
  }
  const { agentId, title, model, effort, contextWindow, pinned, disabledServers } = asked.success;
  const { archived, reason } = asked.success;
  const { caller } = call;
  if (archived === true && agentId === caller.agent.id) {
    return Effect.succeed(agentToolRejected(UPDATE_AGENT_REFUSAL.SELF));
  }
  const userId = callerUserId(caller);
  return orStoreRefusal(
    Effect.gen(function* () {
      const found = yield* workspaceAgentOf(caller, agentId);
      if (Option.isNone(found)) return agentToolRejected(AGENT_TOOL_REFUSAL.NO_AGENT);
      const steward = stewardRefused(caller, found.value.agent, STEWARD_ACT.CHANGE);
      if (steward !== undefined) return agentToolRejected(steward);
      const { task, workspaceId } = found.value;
      const choices = yield* Effect.result(accountModelChoices(userId));
      if (Result.isFailure(choices)) return agentToolRejected(UPDATE_AGENT_REFUSAL.UNAVAILABLE);
      const { offered } = choices.success;
      const asked =
        model === undefined || effort === undefined
          ? undefined
          : { model, effort, ...(contextWindow === undefined ? undefined : { contextWindow }) };
      // A provider's own harness takes only what it runs (`agent-runtime-models.ts`).
      const runtime = asked === undefined ? undefined : yield* agentRuntimeOf(found.value.agent);
      const refused = asked === undefined ? undefined : runtimeChoiceRefusal(runtime, asked);
      if (refused !== undefined) {
        return agentToolRejected(
          `${UPDATE_CHOICE_LEAD}: ${runtimeChoiceRefusalWords(runtime, refused)}`,
        );
      }
      const accepted = asked === undefined ? undefined : validateModelChoice(offered, asked);
      if (asked !== undefined && accepted !== undefined && Result.isFailure(accepted)) {
        return agentToolRejected(choiceRefusal(asked, offered, UPDATE_CHOICE_LEAD));
      }
      // The catalog's own reading of the choice is written, a window the model does not offer apart dropped.
      const choice = accepted === undefined ? undefined : Result.getOrUndefined(accepted);
      // An archive is checked first, so one refused, its agent working, leaves every change asked unwritten.
      // The archive and every other change are one transaction: a refused archive writes nothing, and
      // a change that finds no row takes the archive back with it.
      const written = yield* Effect.flatMap(SqlClient.SqlClient, (client) =>
        client.withTransaction(
          Effect.gen(function* () {
            if (archived !== undefined) {
              const refusal = yield* archiveChange(caller, found.value.agent, archived, reason);
              if (refusal !== undefined)
                return yield* Effect.fail(new AgentChangeRefused({ refusal }));
            }
            return yield* changedAgent(userId, agentId, { title, choice, pinned, disabledServers });
          }),
        ),
      ).pipe(
        Effect.map(
          (changed): Result.Result<Option.Option<Agent>, string> => Result.succeed(changed),
        ),
        Effect.catchTag("AgentChangeLost", () =>
          Effect.succeed(Result.fail(AGENT_TOOL_REFUSAL.NO_AGENT)),
        ),
        Effect.catchTag("AgentChangeRefused", (refused) =>
          Effect.succeed(Result.fail(refused.refusal)),
        ),
      );
      if (Result.isFailure(written)) return agentToolRejected(written.failure);
      // A native agent's runner that runs is handed the change now; eve reads the row at its next step.
      if (choice !== undefined) yield* runnerChoiceApplied(found.value.agent);
      // The agent as it now stands, its archive among it, which a change left unwritten does not answer.
      const now = Option.isSome(written.success)
        ? written.success
        : yield* readAgent(userId, agentId);
      const agent = Option.getOrElse(now, () => found.value.agent);
      const step = yield* workspaceStepOf(userId, workspaceId);
      return {
        status: ACTION_RESULT_STATUS.ACCEPTED,
        agent: {
          id: agent.id,
          ...givenNameOf(agent),
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

/** One call of `list_tasks`: the open tasks of the caller's workspace, and the archived ones too where asked, newest first, each with the section its member keeps it in, and those sections. */
export function runListTasks(
  call: AgentCall,
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
  // The tasks of one member, or with null of no one; a link that names no person names no one's tasks.
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
        mention: writtenMention({ kind: MENTION_KIND.TASK, taskId: task.id }, task.name, step),
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

/**
 * One call of `list_models`: the models the caller's member may start an
 * agent on, each by its catalog id, the name to say it by, and its efforts,
 * and the member's default choice and whether it is still offered, read from
 * the one source a start is checked against (`accountModelChoices`), so a
 * choice listed is one `start_agent` takes. It names nothing of the call's.
 */
export function runListModels(
  call: AgentCall,
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
      // The agent named, whose runtime narrows the list to what it may move to.
      let runtime: NativeAgentRuntime | undefined;
      if (agentId !== undefined) {
        const found = yield* workspaceAgentOf(caller, agentId);
        if (Option.isNone(found)) return agentToolRejected(AGENT_TOOL_REFUSAL.NO_AGENT);
        runtime = yield* agentRuntimeOf(found.value.agent);
      }
      const choices = yield* Effect.result(accountModelChoices(callerUserId(caller)));
      if (Result.isFailure(choices)) return agentToolRejected(LIST_MODELS_REFUSAL.UNAVAILABLE);
      const { offered, defaultChoice } = choices.success;
      const listed = runtimeModels(offered, runtime);
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
          // Whether the default is among the models listed: for the agent named, one it may move to.
          offered: Result.isSuccess(validateModelChoice(listed, defaultChoice)),
        },
      };
    }),
  );
}

/** A page's HTML as a read answers it, and how many characters of it were left out. */
interface PageCut {
  readonly html: string;
  readonly leftOutChars: number;
}

/** A text as a read answers it, cut to a bound, and how many characters of it were left out. */
export interface TextCut {
  readonly text: string;
  readonly leftOutChars: number;
}

/** A text cut on a line to a bound, and how many characters were left out; whole where it fits. */
export function cutOnLine(text: string, maximumChars: number): TextCut {
  if (text.length <= maximumChars) return { text, leftOutChars: 0 };
  const lineEnd = text.lastIndexOf("\n", maximumChars);
  const kept = text.slice(0, lineEnd > 0 ? lineEnd : maximumChars);
  return { text: kept, leftOutChars: text.length - kept.length };
}

/** A page's HTML cut on a line to the read's bound, and how many characters were left out; whole where it fits. */
function pageCut(html: string): PageCut {
  const cut = cutOnLine(html, READ_PAGE_CHARS);
  return { html: cut.text, leftOutChars: cut.leftOutChars };
}

/**
 * What a page read says it stands on, where that is of the caller's
 * workspace: its task, by name, and whether it is the caller's own, or the
 * coding agent on no task that showed it, by name, and whether that is the
 * caller; nothing for an owner of another workspace.
 */
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
      isYours: caller.agent.id === owner.agentId,
    });
  });

/** One call of `read_page`: a version of a page of the caller's workspace, on a task or on an agent with no task, its HTML cut to the bound, or why there is none. */
export function runReadPage(
  call: AgentCall,
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
      // A page of another workspace, even one the member is also in, is none of the caller's.
      const standing = yield* pageStandingOf(caller, owner);
      if (Option.isNone(standing)) return agentToolRejected(READ_PAGE_REFUSAL.NO_PAGE);
      const step = yield* pageStepOf(userId, owner);
      const cut = pageCut(page.html);
      return {
        status: ACTION_RESULT_STATUS.ACCEPTED,
        page: {
          id: page.id,
          title: page.title,
          version: page.version,
          newestVersion,
          ...standing.value,
          // The page's mention, ready to write, wherever its owner's workspace reads for the member.
          ...(Option.isNone(step)
            ? undefined
            : { mention: writtenMention(pageMention(owner, page.id), page.title, step.value) }),
          html: cut.html,
          leftOutChars: cut.leftOutChars,
        },
      };
    }),
  );
}
