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
import { lockTasksForBlocks } from "@repo/database/models/task-block-store";
import { readPageById } from "@repo/database/models/task-pages";
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
import { EXPERIMENT } from "@repo/settings";
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
import { deploymentSandboxStops } from "./session-sandboxes.js";
import type { AgentSessions } from "./sessions/agent-sessions.js";
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
  EVERY_EXPERIMENT_ON,
  EXPERIMENT_OFF_REFUSAL,
  type ExperimentsOn,
  experimentOnIn,
} from "./workspace-experiment-on.js";
import {
  workspaceNamingOf,
  workspaceStepOf,
  writtenMention,
  writtenPageMention,
  writtenTaskMention,
} from "./written-mentions.js";

/**
 * agent-tools.ts -- the tools every agent reaches the workspace's coding agents by: list them, read one's progress, start one.
 *
 * Every coding agent is offered the same `list_agents`,
 * `read_agent`, and `start_agent`, one implementation each;
 * the caller is what differs (`AgentCaller`):
 * a coding agent acting for its starter, on its own task, which the host
 * read from the session it admitted and never from the call; or a member,
 * as an outside agent acts for them through the member MCP server
 * (`../member-mcp/`), on the token it admitted, in the one workspace a call
 * is about, on no task and as no agent, so nothing is left out of a list
 * or read around it, and nothing is ever its own. A list and a read
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
 * nothing of it where GitHub could not be asked. The app's voice summarizes a read
 * aloud, so its tail's entries are cut close and its words for the tool say
 * so; a coding agent reads its tail as text, to learn why an agent went
 * quiet, so each of its entries keeps more, and it may ask for a longer
 * tail, to a bound. One agent messages another with `message_agent`
 * (`coder-host/agent-message.ts`). A start takes the one path every other start does
 * (`coder-host/start.ts`), on the caller's own task or another of its workspace, under the
 * same key, so a call run again starts no second agent: the description as the
 * agent's brief, or the prompt in its place, and the note the call carries
 * after either, on the model and effort named or else the member's default,
 * checked against the catalog as the member is offered it, whose choices the
 * refusal lists and `list_models` answers from the same read, so a choice it
 * lists is one a start takes, with its checkout cloned at the branch named
 * where one is, which GitHub must hold. An agent a
 * coding agent starts is told in that note which agent started it, that its
 * final message reaches that agent by itself once its turn ends
 * (`coder-host/starter-report.ts`), and how to reach it before then, with
 * `message_agent`, and its choice leaves the member's default as it stood.
 * A start may name a new task instead, which is made as the member the
 * caller acts for would make it from the sidebar: in the caller's workspace,
 * owned by that member, with an empty description, on the repository the caller
 * works in (the calling agent's own), confirmed through the
 * workspace's installation first; a start that then fails takes the task it
 * made away again, and a call run again answers the agent and task it made.
 * A start may instead go on from another agent of the workspace, on that
 * agent's own task, as the Start route's continue and fork do: without a
 * message it continues an agent that has ended, which its start then stops,
 * one another agent already continued among them, whose earlier
 * continuations its answer names, and with one of its messages
 * it forks it there, which leaves it going on; either is handed the
 * source's brief, its replay with our summary of what does not fit, a
 * copy of its work, and the note, and takes no prompt and no branch. A read
 * names the message each entry of the tail stands in, which a fork names.
 * An archive and every other change of an agent take the one operation the
 * Archive agent menu and the agent's menu run (`agent-change.ts`) for the
 * member the caller acts for: any agent of the workspace that member could
 * archive, a teammate's among them, a turn still running stopped first, with
 * the stamp the menu writes, and beside it who archived it, the caller on
 * that member's behalf, and the reason given, which the archived agent's
 * banner shows; an agent never archives itself. An archive or an unarchive
 * already standing answers as done.
 * A task's change takes the one path the member's own task menu does
 * (`tasks-procedures.ts`'s PATCH, `task-store.ts`'s `updateTask`), for the member
 * the caller acts for: a new name, a repository confirmed through the
 * workspace's installation or none, where it stands, or that member's own
 * pin, on any task of the caller's workspace, a teammate's among them. A
 * task is archived no longer, so an archive a call from before still asks
 * for settles the task instead, Done or Canceled by whether an agent's
 * pull request merged, without asking and without stopping the task's
 * agents, and an unarchive puts it back to work (`tasks/archive-settle.ts`);
 * a change already standing answers as done.
 * A stop takes the one path the Stop button's does (`coder-host/stop.ts`'s `stoppedAgent`):
 * the harness's cancel of the turn under way, named by its own id for it, then the
 * row's stamp, which `list_agents` then reads as canceled. The agent stays
 * as it was, its transcript and branch kept, and a later message starts a
 * new turn. A Stop already standing on a turn still ending answers as done,
 * so a call run again cancels nothing twice; an agent already idle is
 * answered as it stands and nothing changes; the caller itself is never
 * stopped.
 * A page read finds a page an agent showed on any task of the caller's
 * workspace by the page's id, as the caller's member could open it in the
 * side panel, and answers its HTML cut on a line to a bound, which a
 * mention of the page now points the agent at rather than carrying it.
 * Each tool reaches an agent's session as the deployment acting for the
 * caller's member, and the agent's harness answers it
 * (`coder-host/runtime-sessions.ts`). Every answer is data the model reads,
 * never a credential.
 */

/** The most tasks a list of them answers, the newest started first. */
export const TASKS_LIST_LIMIT = 50;

export const AGENT_TOOL_BOUNDS = {
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

/** Why a stop changed nothing, in words the model can act on. */
export const STOP_AGENT_REFUSAL = {
  UNREADABLE: `Not run: name the agent by the id ${AGENT_TOOL.LIST_AGENTS} answered.`,
  SELF: "Not stopped: that id is your own, and an agent does not stop itself; end your turn by finishing it.",
  UNAVAILABLE:
    "Not stopped: the service could not reach that agent's session just now. The call may be made again.",
  NATIVE_NOT_HERE:
    "Not stopped: that agent runs on Claude Code or Codex, which cannot be reached from here yet; a member stops it from the agent's own tab.",
} as const;

/** The most characters of a page's HTML a read answers, about ten thousand tokens: the rest is counted, never sent. */
export const READ_PAGE_CHARS = 40_000;

/** Why a page read answered nothing, in words the model can act on. */
export const READ_PAGE_REFUSAL = {
  UNREADABLE:
    "Not read: name the page by its id, and a version as a whole number from 1, or none for the newest.",
  NO_PAGE:
    "Not read: no page of a task of your workspace has that id, or that page has no such version.",
} as const;

/** The cloud as `start_agent`'s runsOn names it, which a device's refusal offers instead. */
const IN_THE_CLOUD_WORDS = JSON.stringify({ machine: AGENT_MACHINE.VERCEL });

/** Why a start made nothing, in words the model can act on; a choice the catalog refused is said with the choices (`choiceRefusal`). */
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
  PROMPT_NEEDED:
    "Not started: give the agent a prompt carrying everything it needs to start on its work; " +
    "every start takes one but a start from another agent.",
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

/** The start refusal's sentence for each hosted refusal a start may answer; any other is the service down. */
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

/** Why a start on a device refused it, in words the calling model can act on: by what the device refused it for, bar another member's device, which names whose it is (`notOwnerWords`). */
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

/** Why a repository beside an agent's own is refused, in the words a start and an added repository share: the agent on a device, and the repository named reached on the member's token or another installation. */
const EXTRA_REPOSITORY_WHY = {
  device: "an agent in several repositories runs only in the cloud.",
  token: (named: string) =>
    `${named} is reached only on the member's own GitHub token, and an agent's repositories are all reached through the GitHub App.`,
  otherInstallation: (named: string) =>
    `${named} is on another GitHub account's installation of the App than the agent's own repository, and one agent's repositories share one.`,
} as const;

/** Why a start naming repositories beside its agent's own refused it, in words the calling model can act on, naming the repository where one is why. A start is never refused for what only an added repository is refused for, which reads as the request refused. */
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

/** Why a repository added to an agent was refused, in words the calling model can act on, naming the repository where one is why; the shared reasons in a start's words (`EXTRA_REPOSITORY_WHY`). */
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

/** Why a start on another member's device refused it, naming the device and its owner where the refusal did. */
function notOwnerWords(device: RefusedDevice | undefined): string {
  const where = device === undefined ? "another member's device" : device.name;
  const who = device?.owner ?? "its owner";
  return `Not started: it would run on ${where}. Only ${who} can start agents on it, so ask them to, or start it in the cloud with runsOn ${IN_THE_CLOUD_WORDS}.`;
}

/** A device of the member's as a refusal of a device's name lists it: its name, its id, and whether it is online now, as a start would take it (`freshOffer`). */
function listedDevice(device: Device, now: number): string {
  const online = device.lastSeenAt.getTime() >= now - MAC_PRESENCE.FRESH_MS;
  return `${JSON.stringify(device.name)} (deviceId ${device.id}, ${online ? "online" : "away"})`;
}

/**
 * Why a start naming a device by its name started nothing: the name matches
 * none of the member's devices, or more than one, said with every device of
 * theirs by name, id, and whether it is online, so the call can be made again
 * naming one; or the member has none to list.
 */
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

/** Who calls an agent tool: a coding agent from its own session, or a member through the member MCP server. */
export const AGENT_CALLER = {
  AGENT: "agent",
  MEMBER: "member",
} as const;

/**
 * Who a call is made by, as the host established it and never as the call
 * said: a coding agent, acting for the member who started it, on its own
 * task; or a member, as an outside agent acts for them through the member
 * MCP server (`../member-mcp/`) on a token minted to an OAuth client, in the
 * one workspace the call is about, on no task and as no agent. A coding
 * agent carries whether it reaches tasks' descriptions, read once with the
 * rest of its standing by the catalog (`tool-catalog/gates.ts`); a member's
 * own Task descriptions are read where a tool needs them.
 */
export type AgentCaller =
  | {
      readonly kind: typeof AGENT_CALLER.AGENT;
      readonly agent: Agent;
      readonly descriptionsOn: boolean;
    }
  | {
      readonly kind: typeof AGENT_CALLER.MEMBER;
      readonly userId: string;
      readonly workspaceId: string;
      readonly clientId: string;
    };

/** What a call of the agent tools runs under: who calls, the agents' sessions as the deployment acting for the caller's member, the writer, and the key the one message or start is made under. */
export interface AgentCall {
  readonly caller: AgentCaller;
  /** The agents' sessions as the deployment acting for the caller's member. */
  readonly agentSessions: AgentSessions;
  /** The agents' sessions as the deployment acting for any account, such as the creator an automation's run starts as, whoever fired it. */
  readonly agentSessionsAs: (account: string) => AgentSessions;
  readonly writer: Effect.Effect<StoreWriter>;
  /** The key a message or a start is made under: the call's key (`workspace-mcp/call-key.ts`), so a call run again sends or starts once. */
  readonly clientKey: string;
  /** How a start from another agent summarizes the steps its replay cannot keep, as the Start route's does; none leaves them out unsummarized. */
  readonly summaryModel?: SummaryModelOf | undefined;
}

/** What a read of the agent tools runs under: who calls, alone, since a read reaches no session, writes nothing, and keys nothing. */
export type AgentReadCall = Pick<AgentCall, "caller">;

/** What a message or a start reaches: the store, GitHub through the App on the member's standing, the network to the agents' sessions, and the catalog a start's choice is checked against. */
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

/** A prompt or a note a start may name: bounded apart from a message, since a brief to a worker on a long description is quoted whole. */
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
const START_BRANCH = startBranchSchema;

/**
 * A start names a prompt at most, a note at most, a branch at most, and a
 * model with its effort or neither; the catalog decides whether the two
 * name anything, and GitHub whether the branch does. A
 * title it names is the agent's from the start, as an automation's run's
 * fixed name is, so no generated title ever covers it; without one the
 * agent is named from its first exchange as any is.
 * Note that the note is what lets one start carry everything: without it a
 * start on the description had no room for what was said beyond the description, so the
 * caller started the agent and then messaged it the rest.
 */
/**
 * Where a started agent runs, as `start_agent` names it: as a start request
 * does (`agentRunsOnRequestSchema`), or one of the member's own devices by
 * its name, which the call matches to its id (`runsOnOfStart`) before the
 * start is asked.
 */
const START_RUNS_ON = Schema.Union([
  ...agentRunsOnRequestSchema.members,
  Schema.Struct({
    machine: Schema.Literal(AGENT_MACHINE.DEVICE),
    device: deviceAgentRegisterRequestSchema.fields.name,
  }),
]);

/**
 * `start_agent`'s `prompt` and `note` as a workspace with Task descriptions on
 * or off words them: off, a start is handed no description, so its prompt
 * carries everything the agent needs, and nothing names a description.
 */
const START_WORDS = {
  on: {
    prompt:
      "What the agent should do, typed to it as its first message; the developer's words where " +
      "they named the job. Leave it out to start the agent on the task's description itself.",
    note:
      "Everything else the agent should hear as it starts (what to start with, what to watch out " +
      "for, what to leave alone), handed to it after the description or the prompt in the same first " +
      "message; leave it out where there is nothing beyond the description.",
  },
  off: {
    prompt:
      "What the agent should do, typed to it as its first message: everything it needs to start " +
      "on its work, or the developer's words where they named the job. Every start takes one but " +
      "a start from another agent, which takes none.",
    note:
      "Everything else the agent should hear as it starts (what to start with, what to watch out " +
      "for, what to leave alone), handed to it after the prompt in the same first message; leave " +
      "it out where there is nothing beyond the prompt.",
  },
} as const;

/** Which of a tool's two wordings a workspace reads: the one naming its description, or the one naming none. */
function wordsOf(on: Pick<ExperimentsOn, "descriptionsOn">): "on" | "off" {
  return on.descriptionsOn ? "on" : "off";
}

/** `start_agent`'s input in the words of the workspace's experiments. */
function startAgentInputOf(on: Pick<ExperimentsOn, "descriptionsOn">) {
  return Schema.Struct({
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
    prompt: Schema.optionalKey(describeWire(START_PROMPT, START_WORDS[wordsOf(on)].prompt)),
    note: Schema.optionalKey(describeWire(START_PROMPT, START_WORDS[wordsOf(on)].note)),
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
}

const START_AGENT_INPUT = startAgentInputOf(EVERY_EXPERIMENT_ON);

const readAgentRef = Schema.decodeUnknownResult(READ_AGENT_INPUT);
const readAgentAsked = Schema.decodeUnknownResult(CODER_READ_AGENT_INPUT);

/**
 * A task's change names the task and at least one of what the member's own
 * menu changes of it: its name, its repository, where it stands, and the
 * member's own pin.
 */
/** `update_task`'s `name` as a workspace with Task descriptions on or off words it. */
const UPDATE_NAME_WORDS = {
  on: "Its new name, as the sidebar shows it, which its description's heading follows.",
  off: "Its new name, as the sidebar shows it.",
} as const;

/** `update_task`'s input in the words of the workspace's experiments. */
function updateTaskInputOf(on: Pick<ExperimentsOn, "descriptionsOn">) {
  return Schema.Struct({
    taskId: describeWire(
      wireUuidSchema,
      `The task's id, as ${AGENT_TOOL.LIST_TASKS} or ${AGENT_TOOL.LIST_AGENTS} answered it.`,
    ),
    name: Schema.optionalKey(
      describeWire(
        Schema.Trim.check(Schema.isNonEmpty(), Schema.isMaxLength(TASK_BOUNDS.MAX_NAME_CHARS)),
        UPDATE_NAME_WORDS[wordsOf(on)],
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
}

const UPDATE_TASK_INPUT = updateTaskInputOf(EVERY_EXPERIMENT_ON);

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
 * A start as a call carries it: one the app made under the tool's earlier words
 * names its prompt `task`, and one made before `create_task` may name a
 * `newTask`, which is read only to be refused with where to go now.
 */
const START_AGENT_CALL = Schema.Struct({
  ...START_AGENT_INPUT.fields,
  task: Schema.optionalKey(START_PROMPT),
  newTask: Schema.optionalKey(Schema.Unknown),
});

const readStart = Schema.decodeUnknownResult(START_AGENT_CALL);

/** The tools as the app and every coding agent are offered them: each its name, its words, and its input schema. */
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

/** How a start is handed what it is told, as a workspace with Task descriptions on or off words it. */
const START_HANDED_WORDS = {
  on:
    "on the task's description itself with no prompt, or on the prompt given in the " +
    "description's place, with the note after either and any pictures images names, which it sees as " +
    "images.",
  off:
    "on the prompt given, with the note after it and any pictures images names, which it sees as " +
    "images.",
} as const;

/** Why a start on no task needs a prompt, said only where a task would otherwise hand its description. */
const NEW_TASK_PROMPT_WORDS = {
  on: "; it needs a prompt, since that task has no description to hand it",
  off: "",
} as const;

/** `start_agent` in the words of the workspace's experiments: its name, its words, and its input schema. */
export function startAgentToolOf(on: Pick<ExperimentsOn, "descriptionsOn">) {
  return {
    name: AGENT_TOOL.START_AGENT,
    description: startAgentWords(on),
    inputSchema: startAgentInputOf(on),
  } as const;
}

function startAgentWords(on: Pick<ExperimentsOn, "descriptionsOn">): string {
  const words = wordsOf(on);
  return (
    "Start a new agent on the task you work on, or on another task of your workspace by " +
    `its taskId as ${AGENT_TOOL.LIST_TASKS} answered it, exactly as the developer would: ` +
    `${START_HANDED_WORDS[words]} Start it on the task you work on, taskId left ` +
    "out, for any part of that task's work, even one that runs apart from yours, so its " +
    "branch, pull request, and transcript stand under that task; name another task only for " +
    "work unrelated to it, or where the developer asked for that, and for work that should " +
    `stand as a task of its own, make it with ${AGENT_TOOL.CREATE_TASK} first. Where you work ` +
    "on no task, taskId left out starts it on a new task made for it, named as its agent is, " +
    "assigned to the member you work for, in the repository you work in or the one repository " +
    `names, and done by itself once its agents finish well${NEW_TASK_PROMPT_WORDS[words]}. ` +
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
    "copies its work and summarizes its transcript, so it may take a minute to answer."
  );
}

export const START_AGENT_TOOL = startAgentToolOf(EVERY_EXPERIMENT_ON);

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

/** `update_task` in the words of the workspace's experiments. */
export function updateTaskToolOf(on: Pick<ExperimentsOn, "descriptionsOn">) {
  return { ...UPDATE_TASK_TOOL, inputSchema: updateTaskInputOf(on) } as const;
}

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

/** Why a change to an agent changed nothing, in words the model can act on; a choice the catalog refused is said with the choices (`choiceRefusal`). */
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

/** The lead a refused choice of a change is said under. */
const UPDATE_CHOICE_LEAD = "Not changed";

/** The lead a refused repository added to an agent is said under. */
const ADD_REPOSITORY_LEAD = "Not added";

/** An added repository's refusal's sentence for each hosted refusal its GitHub reads may answer, as a start says it (`START_REFUSAL_WORDS`); any other is the service down. */
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
  readonly addRepository?: AgentAlsoRepository;
}): boolean {
  const { title, model, effort, contextWindow, pinned, disabledServers, archived, reason } = update;
  const changes = [title, model, pinned, disabledServers, archived];
  // Note that a repository is added alone, since its GitHub reads and its checkout land outside any transaction.
  if (update.addRepository !== undefined) return changes.every((field) => field === undefined);
  if ((model === undefined) !== (effort === undefined)) return false;
  if (contextWindow !== undefined && model === undefined) return false;
  if (reason !== undefined && archived !== true) return false;
  return changes.some((field) => field !== undefined);
}

/** A repository added to an agent: `owner/name`, and the branch its checkout is cloned at, none for its default branch. */
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

/**
 * A change names the agent and at least one of: a title, the model with its
 * effort and, at most, its context window, which the catalog then checks,
 * whether the member pins it, and the MCP servers switched off for it, the
 * whole list; or, alone, a repository added beside the ones it works in.
 * Each is the change a member makes from the agent's own menu, model chip,
 * or composer.
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
  /** The agent's title, what it works on, which update_agent renames; the model's id where it has none yet. */
  readonly title: string;
  readonly model: string;
  /** The model as the app says it and the screen shows it, without the maker's word (`modelLabel`). */
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

/** The newest journal of each agent's conversation, read once for the lot, keyed by conversation. The agents were read through their workspace's gate, so their conversations are read by id. */
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

/** The coding agent calling; none for a member, who is never one of the agents a tool reaches as itself. */
export function callerAgent(caller: AgentCaller): Agent | undefined {
  return caller.kind === AGENT_CALLER.AGENT ? caller.agent : undefined;
}

/** The member a call acts for: the starter of the coding agent calling, or the member calling. */
export function callerUserId(caller: AgentCaller): string {
  return caller.kind === AGENT_CALLER.AGENT ? caller.agent.userId : caller.userId;
}

/** The workspace a call is in, whose experiments it reads: the coding agent's own, or the one the member's call is about. */
export function callerWorkspaceId(caller: AgentCaller): string {
  return caller.kind === AGENT_CALLER.AGENT ? caller.agent.organizationId : caller.workspaceId;
}

/** The task the caller works on: the coding agent's own, which may be none; none for a member. */
export function callerTask(caller: AgentCaller): string | null {
  return caller.kind === AGENT_CALLER.AGENT ? caller.agent.taskId : null;
}

/**
 * The workspace the caller reaches agents in, read on its member's standing
 * now: as the agent reads itself (`ownAgentWorkspace`), or the member's
 * workspace while they are still a member of it; nothing where they no
 * longer reach it. Every agent and task its tools act on is still read on
 * the member's own rule (`workspaceAgent`, a start's reach).
 */
export const callerWorkspace = (
  caller: AgentCaller,
): Effect.Effect<Option.Option<string>, StoreFailure, DatabaseServices> =>
  caller.kind === AGENT_CALLER.AGENT
    ? ownAgentWorkspace(caller.agent.userId, caller.agent)
    : Effect.map(isWorkspaceMember(caller.userId, caller.workspaceId), (member) =>
        member ? Option.some(caller.workspaceId) : Option.none(),
      );

/** The agent's native runtime and payer, which decide the models it may move to; none on the retired runtime. */
const agentRouteOf = (agent: Agent) =>
  Effect.map(nativeRouteOfReached(agent.conversationId), Option.getOrUndefined);

/** An agent of the caller's workspace under the id, with its task, or nothing: one of another workspace, the member's other ones included, or none. */
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
  if (refusal.extraRepositoryRefusal !== undefined) {
    return extraRepositoryWords(refusal.extraRepositoryRefusal, refusal.refusedRepository);
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
 * The run an agent the caller starts on no task belongs to: the run the
 * caller works on now, else the one the caller itself belongs to, else none.
 * Note that the run handed to it is read rather than its own row's, because
 * a same-agent automation hands every run to one agent, whose row keeps the
 * run that first started it.
 */
function runOfCaller(calling: Agent) {
  return Effect.map(currentAutomationRun(calling.id), (current) =>
    Option.getOrElse(current, () => calling.automationRunId ?? undefined),
  );
}

/**
 * The note an agent a coding agent starts is handed: which agent started it,
 * that its final message reaches that agent by itself once its turn ends
 * (`coder-host/starter-report.ts`), that it messages it before then with
 * `message_agent` by that agent's id, as every word between two agents goes
 * (`coder-host/agent-message.ts`), then the note it was given. Note that it
 * is not told to keep off the developer's threads: it posts in one what it
 * would post there, as any agent may.
 */
function startedByNote(starter: Agent, note: string | undefined): string {
  const lead =
    `You were started by another agent of your workspace, ${agentIntroduction(starter)}, ` +
    "not by the developer. Your final message reaches it by itself once your turn ends, so make " +
    "that message your report: what you did, what you published, and what you need of it. To " +
    `reach it before then, call ${AGENT_TOOL.MESSAGE_AGENT} with its agentId, ${starter.id}.`;
  return note === undefined ? lead : `${lead}\n\n${note}`;
}

/** The agent as a start answers it: its id, what it runs on, where it stands now, and whether it is on the caller's own task, which a window that opens the caller's task alone reads to link it or not. */
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

/** A store that could not be read is the one refusal, logged for the operator and said to the model. */
export const orStoreRefusal = <R>(
  effect: Effect.Effect<WireRecord, StoreFailure, R>,
): Effect.Effect<WireRecord, never, R> =>
  Effect.catch(effect, (failure) =>
    Effect.as(logStoreFailure(failure), agentToolRejected(AGENT_TOOL_REFUSAL.STORE)),
  );

/** The repository the caller works in: the calling agent's own; none where it names none, or for a member, who works in none. */
export const workedRepository = (caller: AgentCaller) =>
  Effect.succeed<string | null>(callerAgent(caller)?.repository ?? null);

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

/** One call of `list_agents`: a page of the agents of the caller's workspace, or of one task of it, or those the words name, the calling agent left out, archived ones marked, the caller's own first and then the newest, and the next page's offset where more stand. */
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
    if (!controlsAgent(callerUserId(caller), source)) {
      return Result.fail(`Not started: only ${yield* agentStarterName(source)} can do this.`);
    }
    if (named !== undefined && named !== source.taskId) {
      return Result.fail(START_AGENT_REFUSAL.SOURCE_OTHER_TASK);
    }
    // An agent with no task is started from in its own workspace, on the repository it cloned, or in none.
    const place = placeOfAgent(source);
    // A fork names one of the source's own messages, and leaves the source going on beside it.
    if (from.messageId !== undefined) {
      const { userId, conversationId } = source;
      const role = MESSAGE_ROLE.ASSISTANT;
      const at = yield* messageSeqOf(userId, conversationId, from.messageId, role);
      if (Option.isNone(at)) return Result.fail(START_AGENT_REFUSAL.NO_MESSAGE);
      return Result.succeed({ place, continuedBy: [] });
    }
    // Note that a continue of an agent that started the caller records the caller as the new agent's starter and, for a pilot, moves the agents it started under it, so the two would name each other.
    // A member is started by no agent, so no source started them.
    const calling = callerAgent(caller);
    if (
      calling !== undefined &&
      (yield* startedThrough(callerUserId(caller), calling.id, source.id))
    ) {
      return Result.fail(START_AGENT_REFUSAL.STARTER_CONTINUE);
    }
    // A continue takes over work that has ended; one already continued is
    // continued again, since a continuation may itself fail or go wrong, and
    // the answer names the earlier ones so the caller knows they stand.
    const { status } = (yield* standingsOf([source]))(source);
    if (status === AGENT_STATUS.STARTING || status === AGENT_STATUS.RUNNING) {
      return Result.fail(START_AGENT_REFUSAL.SOURCE_RUNNING);
    }
    const at = { userId: callerUserId(caller), workspaceId, taskId: source.taskId };
    const continuedBy = yield* earlierContinuationsOf(at, source.id);
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
    return EXPERIMENT_OFF_REFUSAL;
  }
  if (from !== undefined && refusal.error === HOSTED_API_ERROR.NOT_FOUND) {
    return START_AGENT_REFUSAL.NO_SOURCE;
  }
  if (from?.messageId !== undefined && refusal.error === HOSTED_API_ERROR.INVALID_REQUEST) {
    return START_AGENT_REFUSAL.NO_MESSAGE;
  }
  return startRefusalWords(refusal);
}

/** Who hands pictures on in the caller's name: the coding agent its own conversation's; a member, who keeps no conversation here, none. */
function forwarderOf(caller: AgentCaller): ImageForwarder {
  return {
    userId: callerUserId(caller),
    conversationId: callerAgent(caller)?.conversationId,
  };
}

/**
 * The task made for the agent a caller on no task starts, through the one
 * make every door shares (`createTaskAsked`): untitled, so the agent's title
 * names it as it names any untitled task (`title.ts`), assigned to the
 * member the caller works for, in the repository named or the caller's own,
 * or none, in progress, and with a blank description, since the prompt is handed to
 * the agent as its first message; marked as made by `start_agent` so it
 * finishes once its agents finished well, with no merge asked
 * (`task-finish.ts`). Note that it is made under an id drawn from the call's
 * key, as the agent is keyed by it, because a call run again must find the
 * task it made rather than make a second. The refusal's words where the
 * repository is out of reach, or the member no longer stands in the caller's
 * workspace.
 */
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
        // The member gone from the workspace refuses its assignee; no parent or relation is asked, so no other refusal comes.
        default:
          return Effect.succeed(Result.fail(START_AGENT_REFUSAL.NO_WORKSPACE));
      }
    }),
  );

/**
 * The task a refused start made for its agent, deleted where no agent
 * stands on it, so a refusal leaves nothing behind; one an agent the
 * refused start made stands on is kept, as that agent works all the same,
 * and a delete that failed is logged.
 */
const discardUnstarted = (userId: string, taskId: string) =>
  deleteTask(userId, taskId, { stoppedAgentIds: new Set() }).pipe(
    Effect.catchTag("TaskAgentUnstopped", () => Effect.succeed(false)),
    Effect.catch((failure) => Effect.as(logStoreFailure(failure), false)),
  );

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
  const self = from.agentId === callerAgent(caller)?.id;
  return self && from.messageId === undefined ? START_AGENT_REFUSAL.SELF_CONTINUE : undefined;
}

/**
 * The place a start's runsOn names, as a start request names it: a device
 * named by its name is the starting member's own registered device of that
 * name, any case, by its id; a name that matches none of theirs, or more than
 * one, is refused with their devices listed (`deviceNameRefusal`). Note that
 * only the member's own devices are read, so a teammate's device of that name
 * never matches and is never listed.
 */
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

/**
 * One call of `start_agent`: an agent started under the call's own key on
 * the caller's own task, another of its workspace, the task of the agent
 * it starts from, or, for a caller on no task naming none, a task made for
 * it (`startTaskOf`), or why nothing was started; a fresh start never
 * lands on no task. Only a continue or a fork of an agent on no task does,
 * in that agent's own place. A call naming `newTask`, as a
 * start did before `create_task` made tasks, is refused with where to go
 * now, rather than started on the caller's own task. Note that a start from another agent
 * can take tens of seconds, a copy of its work and a summary of its
 * transcript among them, which the call is let run: our MCP server's function runs
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
  const { caller, agentSessions } = call;
  const refused = startInputRefusal(caller, asked.success);
  if (refused !== undefined) return Effect.succeed(agentToolRejected(refused));
  const prompt = asked.success.prompt ?? asked.success.task;
  const choice = model !== undefined && effort !== undefined ? { model, effort } : undefined;
  const named = asked.success.taskId;
  const ownTask = callerTask(caller);
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
      // A caller on no task that names none starts on a task made for the agent, handed words alone,
      // in the repository named or its own.
      const taskId = named ?? ownTask;
      // Note that a workspace with Task descriptions off has no description to hand a start, so every start but one from another agent names its prompt.
      if (
        landing === undefined &&
        prompt === undefined &&
        !(yield* experimentOnIn(callerWorkspaceId(caller), EXPERIMENT.DESCRIPTIONS))
      ) {
        return agentToolRejected(START_AGENT_REFUSAL.PROMPT_NEEDED);
      }
      const fresh = landing === undefined && taskId === null;
      if (fresh && prompt === undefined) return agentToolRejected(START_AGENT_REFUSAL.NO_PROMPT);
      const repository =
        asked.success.repository === undefined
          ? (callerAgent(caller)?.repository ?? null)
          : asked.success.repository;
      if (fresh && repository === null && asked.success.branch !== undefined) {
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
      const runsOn = yield* runsOnOfStart(userId, asked.success.runsOn);
      if (Result.isFailure(runsOn)) return agentToolRejected(runsOn.failure);
      // Note that the task is made only once the call's input is read whole, so a call refused for it makes none.
      const making = fresh ? yield* startTaskOf(call, repository) : undefined;
      if (making !== undefined && Result.isFailure(making))
        return agentToolRejected(making.failure);
      const made = making?.success;
      const onTask = taskId ?? made;
      const place: StartWhere | undefined =
        landing?.success.place ?? (onTask === undefined ? undefined : { taskId: onTask });
      if (place === undefined) return agentToolRejected(START_AGENT_REFUSAL.NO_WORKSPACE);
      // An agent a coding agent starts hears who started it, and that it reports back to it by message; one a member starts hears their note as the developer's.
      const calling = callerAgent(caller);
      const note =
        calling === undefined ? asked.success.note : startedByNote(calling, asked.success.note);
      const started = yield* startAgent(Effect.succeed(agentSessions), userId, {
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
        // One that lands beside the caller, on its task or on one made for it, belongs to the caller's
        // run, if any; one on another task is that task's. Note that the automation and its origin are
        // not handed on, because either would make it an automation's agent, which changes who it
        // commits as and how its start is counted.
        automationRunId:
          (place.taskId === ownTask || place.taskId === made) && calling !== undefined
            ? yield* runOfCaller(calling)
            : undefined,
      }).pipe(Effect.result);
      if (Result.isFailure(started)) {
        const refusal = started.failure;
        if (made !== undefined) yield* discardUnstarted(userId, made);
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

/** Who an archive is by: the calling coding agent by its id and name, for the member the caller acts for, or the member calling, with the reason given. */
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

/** What a task's answer says beside the task: whether every change named already stood, the section it was placed in, whether the call named its parent, and whether it named its blocks. */
interface TaskUpdateAnswered {
  readonly already: boolean;
  readonly section: TaskSectionReading | null | undefined;
  readonly parentNamed: boolean;
  readonly blocksNamed: boolean;
}

/** A task's change as the model reads it: the task as it now stands, with its mention, its parent and its blocks where the call named them, and whether every change named already stood before the call. */
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
export function repositoryRefusalWords(refusal: HostedRefusal): string {
  if (refusal.error === HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE) {
    return UPDATE_TASK_REFUSAL.NOT_REACHABLE;
  }
  return refusal.error === HOSTED_API_ERROR.GITHUB_UNANSWERED
    ? UPDATE_TASK_REFUSAL.GITHUB_UNANSWERED
    : AGENT_TOOL_REFUSAL.STORE;
}

/** A change's refusal in the model's words (`taskChangeAsked`, `taskChangeWritten`): a task gone, an assignee who is no member, a repository its tree holds, an archive whose agents are not ready, or the repository's own. */
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

/**
 * One call of `update_task`: a task of the caller's workspace changed as the
 * app's menu changes it (`tasks/task-change.ts`), for the member the caller
 * acts for, with its place in the sidebar, its parent, and its blocks in the
 * same transaction, or why not. Note that the task is read first, on that
 * member's standing, both to hold it to the caller's workspace and to tell a
 * change already standing; and that a move to Done archives the task's idle
 * agents as the caller, which, still answering whoever asked, is never one.
 */
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
      // Where it is asked to stand in the sidebar is read before anything is written.
      const placing =
        sectionId === undefined
          ? undefined
          : yield* sectionAsked(userId, workspace.value, taskId, sectionId);
      if (placing !== undefined && Result.isFailure(placing)) {
        return agentToolRejected(placing.failure);
      }
      // So are the tasks its blocks name, each held to the workspace as the task itself is.
      const blocking = blockChangesNamed(blockChanges)
        ? yield* blockWritesAsked(userId, workspace.value, taskId, blockChanges)
        : undefined;
      if (blocking !== undefined && Result.isFailure(blocking)) {
        return agentToolRejected(blocking.failure);
      }
      // The change itself is confirmed as the app's is (`taskChangeAsked`), an archive stopping the task's agents but the caller.
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
      // The tasks the blocks name, and the parent, are locked before the task's change, so the change takes no lock first that another call's writes wait on.
      const locking = [
        ...(blocking === undefined ? [] : tasksOfWrites(blocking.success)),
        ...(typeof parentTaskId === "string" ? [taskId, parentTaskId] : []),
      ];
      // The task's change, its place in the sidebar, its parent, and its blocks are one transaction, so a place
      // refused, its section deleted meanwhile, a parent refused, or a block refused takes the change back with it.
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
          // The sidebar's own write puts it in the section named, or in none, as the developer's drag does.
          const placed = yield* writeTaskSections(userId, {
            kind: TASK_SECTION_WRITE.PLACE,
            taskId,
            sectionId: placing.success.section?.id ?? null,
          });
          if (Option.isNone(placed)) {
            return yield* new TaskChangeRefused({ words: UPDATE_TASK_REFUSAL.NO_SECTION });
          }
        }
        // The parent is written under the store's own rules, and the task answered as it then stands.
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
      // The agents its Done archived are let go of once it commits, and a finish counted, as the app's change does.
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

/** A stop's refusal in the model's words, naming the agent's starter where only they may stop it: an agent gone meanwhile is none, and anything else is the service down. */
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

/** Whether a Stop already stands on the turn, which is still ending. */
function stopStands(turn: AgentLatestTurn | undefined): boolean {
  return (
    turn !== undefined && RUNNING_TURN_STATUSES.has(turn.status) && turn.cancelRequestedAt !== null
  );
}

/**
 * The agent stopped by the Stop every surface makes (`stoppedAgent`) under
 * the call's key, and where it stands: whether it was stopped, by this call
 * now or when it first ran, by the harness taking its cancel, or by a Stop already
 * standing on the turn it stood on as the call began and still stands on,
 * and its status read after. A call run again finds the turn it stopped by
 * its key and cancels nothing, so a turn begun since, by a message the agent
 * took meanwhile, runs on.
 */
const stopOf = (call: AgentCall, agent: Agent) =>
  Effect.gen(function* () {
    const { caller, clientKey: key } = call;
    const earlier = yield* hostedStoreOrUnavailable(
      turnStoppedUnderReached(agent.conversationId, key),
    );
    const before = (yield* turnStandingsOf([agent.conversationId]))(agent.conversationId);
    // A member's Stop names no agent that made it, as the developer's names none.
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

/** One call of `stop_agent`: the turn under way of an agent of the caller's workspace stopped as the app's Stop stops it, an idle one answered as idle, or why nothing was stopped. */
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
      // Note that a Stop already standing on a turn still ending is this call's own run again, or
      // the developer's, and is answered as stopped so a call run again reads as it first did.
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

/** A task's change refused inside its transaction, its words for the model: its section or its parent gone meanwhile, or the change refused under the row's lock, which takes every change back. */
class TaskChangeRefused extends Data.TaggedError("TaskChangeRefused")<{ readonly words: string }> {}

/** An archive's refusal in the model's words, naming the agent's starter where only they may stop it: an agent gone meanwhile is none, and anything else is the service down. */
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

/**
 * One call of `update_agent`: an agent of the caller's workspace renamed,
 * moved to another choice the catalog takes, pinned or unpinned for the
 * caller's member, given another list of servers switched off, or archived
 * or brought back, each by the one operation the app's menu runs
 * (`agent-change.ts`). A choice is checked before anything is written, so
 * one refused changes nothing; an archive goes first, stopping a turn still
 * running as the app's does, so one refused changes nothing either; and
 * every other change asked is written in one transaction, so none stands
 * where another failed.
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
      // A provider's own harness takes only what it runs (`agent-runtime-models.ts`).
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
      // The catalog's own reading of the choice is written, a window the model does not offer apart dropped.
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

/** What an added repository's answer says where no place of the agent's ran to take it now. */
const ADDED_AT_NEXT_TURN =
  "It is checked out at that agent's next turn, whose instructions name it; the agent was told nothing now, so an idle one was not woken.";

/** An added repository's refusal in the model's words, naming the agent's starter where only they may add one. */
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

/**
 * `update_agent`'s `addRepository`: a repository added to an agent of the
 * caller's workspace beside the ones it works in, as its ⋯ menu adds one
 * (`agent-repository-add.ts`), answered with where it is checked out, or
 * why not. An agent adding to itself reads the line it is told as this
 * answer, since the call already stands in its conversation.
 */
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
          agentSessions: call.agentSessions,
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

/** One call of `list_tasks`: the open tasks of the caller's workspace, and the archived ones too where asked, newest first, each with the section its member keeps it in, and those sections. */
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

/** The models the member is offered, narrowed to what the agent's route runs where one is named, with the member's default and whether it is among them. */
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
        // Whether the default is among the models listed: for the agent named, one it may move to.
        offered: Result.isSuccess(validateModelChoice(listed, defaultChoice)),
      },
    };
  });

/**
 * One call of `list_models`: the models the caller's member may start an
 * agent on, each by its catalog id, the name to say it by, and its efforts,
 * and the member's default choice and whether it is still offered, read from
 * the one source a start is checked against (`accountModelChoices`), so a
 * choice listed is one `start_agent` takes. It names nothing of the call's.
 */
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
      // The agent named, whose runtime narrows the list to what it may move to.
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

/** The models a member may start an agent on, as `list_models` names them with no agent named, for a caller that names no workspace: the models are the member's own, in every workspace alike. */
export function runListMemberModels(
  userId: string,
): Effect.Effect<WireRecord, never, AgentToolServices> {
  return orStoreRefusal(modelsListed(userId, undefined));
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
      isYours: callerAgent(caller)?.id === owner.agentId,
    });
  });

/** One call of `read_page`: a version of a page of the caller's workspace, on a task or on an agent with no task, its HTML cut to the bound, or why there is none. */
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
      // A page of another workspace, even one the member is also in, is none of the caller's.
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
          // The page's mention, ready to write, wherever its owner's workspace reads for the member.
          ...(Option.isNone(mention) ? undefined : { mention: mention.value }),
          html: cut.html,
          leftOutChars: cut.leftOutChars,
        },
      };
    }),
  );
}
