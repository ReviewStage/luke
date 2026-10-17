import type { DatabaseServices } from "@luke/database/core/query";
import {
  archiveIdleCodingAgent,
  awaitingLinesOfReached,
  type CodingAgent,
  IDLE_ARCHIVE,
  latestTurnsOfReached,
  planNamesOf,
  RUNNING_TURN_STATUSES,
  readCodingAgent,
  readCodingAgentByKey,
  unarchiveCodingAgentFrom,
} from "@luke/database/models/coding-agent-store";
import { listJournals } from "@luke/database/models/message-reads";
import { readPageById } from "@luke/database/models/plan-pages";
import { listTasks } from "@luke/database/models/task-store";
import type { LineSender, StoreWriter } from "@luke/database/models/writer";
import type { StoredArchive } from "@luke/database/schemas/coding-agent";
import { MESSAGE_SENDER } from "@luke/database/storage-vocabulary";
import {
  CODING_AGENT_ARCHIVER,
  CODING_AGENT_BOUNDS,
  CODING_AGENT_STATUS,
  type CodingAgentFailure,
  type CodingAgentPullRequestAnswer,
  type CodingAgentStatus,
} from "@luke/features/coding-agent-wire";
import { MENTION_KIND } from "@luke/features/mention-link";
import { modelLabel } from "@luke/features/model-label";
import { type ModelChoice, modelChoiceSchema } from "@luke/features/models-wire";
import { describeWire } from "@luke/wire/effect";
import { isTextUIPart } from "ai";
import { Clock, Effect, Option, Result, Schema } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import {
  ACTION_RESULT_STATUS,
  HOSTED_API_ERROR,
  isRecord,
  isSettledToolPartState,
  isStoredToolPart,
  isWireString,
  type StoredToolPart,
  type StoredUIMessage,
  type UnparsedWireValue,
  type WireRecord,
  wireUuidSchema,
} from "../core.js";
import type { GitHubApp } from "../github/github-app.js";
import { agentWorkspace, taskWorkspace } from "../github/workspace-repository.js";
import type { HostedRefusal } from "../http/http-effect.js";
import { logStoreFailure, type StoreFailure } from "../http/store-failure.js";
import { ModelCatalog, ModelChoiceRefused, type OfferedModel } from "../providers/model-catalog.js";
import type { PlanDocumentBinding } from "../tasks/plan-notes.js";
import { AGENT_TOOL } from "./agent-runtime/tools.js";
import type { EveSessions } from "./brain-host/eve-sessions.js";
import { agentPublished } from "./coder-host/published.js";
import { START_NOTE_HEADING, startCodingAgent } from "./coder-host/start.js";
import { codingAgentFailureOf, codingAgentStatusOf } from "./coder-host/status.js";
import { steerCodingAgent } from "./coder-host/steer.js";
import { CODER_TOOL, CODER_TOOL_SET, RETIRED_CODER_TOOL } from "./coder-host/tool-set.js";
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
import { taskStepOf, workspaceStepOf, writtenMention } from "./written-mentions.js";

/**
 * coding-agent-tools.ts -- the tools every agent reaches the workspace's coding agents by: list them, read one's progress, message one, start one.
 *
 * Luke on a call and every coding agent are offered the same `list_agents`,
 * `read_agent`, `message_agent`, and `start_agent`, one implementation each;
 * the caller is what differs (`AgentCaller`):
 * Luke acting for the member on the call, on the call's task, or a coding
 * agent acting for its starter, on its own task, which the host read from
 * the session it admitted and never from the call. A list, a read, and a
 * message reach any agent of the caller's workspace, on any task or none
 * and by any member, read on the caller's standing on every call
 * (`workspace-agents.ts`); an agent of another workspace is none of them,
 * even one the member is also in. A list names each agent's task, narrows
 * to one task or the caller's own where asked, and marks the archived
 * ones; a coding agent's own list leaves itself out. Each tool reads the
 * same rows the agent tabs read: the agents and the newest turn each stands
 * on (`coder-host/status.ts`), the branch each row holds, and the
 * transcript's turn journals, rendered as a short tail of what the agent
 * said and did; a read of one agent also asks GitHub what that branch
 * published, as the agent's tab does (`coder-host/published.ts`), and says
 * nothing of it where GitHub could not be asked. Luke summarises a read
 * aloud, so his tail's entries are cut close and his words for the tool say
 * so; a coding agent reads its tail as text, to learn why an agent went
 * quiet, so each of its entries keeps more, and it may ask for a longer
 * tail, to a bound. A message takes the one
 * path the message box's does (`coder-host/steer.ts`), under the key eve
 * gave the tool call, so a call eve runs again after a lost answer sends
 * once, and answers as soon as the session took it, never waiting on a
 * reply; an archived agent takes none and is woken by none. Luke's line is
 * kept as Luke's; a coding agent's under its own name
 * (`MESSAGE_SENDER.AGENT`), its words opening with who sent it and the id
 * to answer it by, written here rather than by the model, so the receiving
 * agent reads it as a colleague's word and neither the developer's nor
 * Luke's. A start takes the one path the Start button's does
 * (`coder-host/start.ts`), on the caller's own task and no other, under the
 * same key, so a call run again starts no second agent: the plan as the
 * agent's brief, or the prompt in its place, and the note the call carries
 * after either, on the model and effort named or else the member's default,
 * checked against the catalog, whose choices the refusal lists. An agent a
 * coding agent starts is told in that note which agent started it and how
 * to report back, and its choice leaves the member's default as it stood.
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

const CODING_AGENT_TOOL_BOUNDS = {
  /** The newest turns a progress read walks first, the one under way included. */
  TAIL_TURNS: 3,
  /** The entries a progress read answers where it asks for no number, the newest last. */
  TAIL_ENTRIES: 20,
  /** The most entries a progress read may ask for: with a coding agent's entries, about ten thousand tokens. */
  MAX_TAIL_ENTRIES: 50,
  /** The most characters one entry of Luke's tail carries, which he summarises aloud. */
  ENTRY_CHARS: 300,
  /** The most characters one entry of a coding agent's tail carries, which it reads as text. */
  AGENT_ENTRY_CHARS: 800,
  /** The most characters an agent's latest activity carries in the list. */
  ACTIVITY_CHARS: 160,
} as const;

/**
 * The room the heading a coding agent's message opens with takes
 * (`agentLine`), which its words leave free: a message's words may run to a
 * member's bound, as Luke's do, since he passes on the developer's own, but
 * a coding agent's whole line is held to that bound as it is composed, so
 * the line the other agent receives is never longer than one a member could
 * send.
 */
const AGENT_HEADING_ROOM_CHARS = 1_000;

/** Why a call ran nothing, or sent nothing, in words the model can act on. */
export const CODING_AGENT_TOOL_REFUSAL = {
  UNREADABLE:
    `Not run: name the agent by the id ${AGENT_TOOL.LIST_AGENTS} answered, and a message as text of at ` +
    `most ${CODING_AGENT_BOUNDS.MAX_MESSAGE_CHARS} characters.`,
  UNREADABLE_FILTER: "Not run: narrow the list by a taskId, by thisTask, or by neither.",
  UNREADABLE_TASKS:
    "Not run: narrow the tasks by words of their name, and page them by an offset of 0 or more.",
  NO_AGENT: `Not run: no coding agent of your workspace has that id; ${AGENT_TOOL.LIST_AGENTS} names them.`,
  NO_WORKSPACE:
    "Not run: your workspace could not be read for you, so no agent is reached from here.",
  SELF: "Not sent: that id is your own; message another agent.",
  TOO_LONG:
    `Not sent: with the heading naming you, the message runs over ${CODING_AGENT_BOUNDS.MAX_MESSAGE_CHARS} ` +
    `characters; keep a message of yours under ${CODING_AGENT_BOUNDS.MAX_MESSAGE_CHARS - AGENT_HEADING_ROOM_CHARS}.`,
  STORE: "Not run: the agents could not be read just now. The call may be made again.",
  NO_SERVICE: "Not sent: this deployment cannot reach the coding agents' service.",
  NOT_REACHABLE:
    "Not sent: the GitHub installation connected to the workspace no longer reaches that agent's repository.",
  NOT_READY:
    "Not sent: that agent's session is still coming up; the same message a moment later is taken.",
  RETIRED:
    "Not sent: that agent's session has ended for good, so nothing reaches it; only a new agent goes on from here.",
  UNAVAILABLE: "Not sent: the service could not take the message just now.",
  ARCHIVED:
    "Not sent: that agent's task is archived, so its agents take no message until a member unarchives it.",
  AGENT_ARCHIVED:
    "Not sent: that agent is archived, so it takes no message and is not woken until a member unarchives it.",
} as const;

/** Why an archive or an unarchive changed nothing, in words the model can act on. */
export const ARCHIVE_AGENT_REFUSAL = {
  UNREADABLE:
    `Not run: name the agent by the id ${AGENT_TOOL.LIST_AGENTS} answered, and a reason as text of at ` +
    `most ${CODING_AGENT_BOUNDS.MAX_ARCHIVE_REASON_CHARS} characters or none.`,
  SELF: "Not archived: that id is your own, and an agent does not archive itself; say you are done, and the developer archives you.",
  WORKING:
    "Not archived: that agent is still starting or working, and archiving it would stop a turn no one gets back. " +
    "Wait until it is idle, or ask the developer, who can stop and archive it.",
  REARCHIVED:
    "Not unarchived: that agent was archived again as it was read, so the archive standing is " +
    `another's; read it again with ${AGENT_TOOL.LIST_AGENTS} and call again if it should still come back.`,
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
export const START_CODING_AGENT_REFUSAL = {
  UNREADABLE:
    "Not started: give a prompt as text of at most " +
    `${CODING_AGENT_BOUNDS.MAX_START_WORDS_CHARS} characters, or none to start on the plan, a note ` +
    "bounded the same or none, and a model with its effort, both or neither.",
  NO_TASK: `Not started: you work on no task; name one by its taskId, as ${AGENT_TOOL.LIST_TASKS} answered it.`,
  NO_SUCH_TASK: `Not started: no task of your workspace has that id; ${AGENT_TOOL.LIST_TASKS} names them.`,
  NO_SERVICE: "Not started: this deployment cannot reach the coding agents' service.",
  NO_REPOSITORY: "Not started: this task names no GitHub repository yet.",
  NOT_REACHABLE:
    "Not started: the GitHub installation connected to the task's workspace does not reach the task's repository.",
  UNAVAILABLE:
    "Not started: the service could not start an agent just now. The call may be made again.",
  ARCHIVED: "Not started: this task is archived; a member unarchives it first.",
} as const;

/** The start refusal's sentence for each hosted refusal a start may answer; any other is the service down. */
const START_REFUSAL_WORDS: ReadonlyMap<string, string> = new Map([
  [HOSTED_API_ERROR.NO_REPOSITORY, START_CODING_AGENT_REFUSAL.NO_REPOSITORY],
  [HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE, START_CODING_AGENT_REFUSAL.NOT_REACHABLE],
  [HOSTED_API_ERROR.TASK_ARCHIVED, START_CODING_AGENT_REFUSAL.ARCHIVED],
]);

/** The refusal's sentence for each hosted refusal a steer may answer; any other is the service down. */
const REFUSAL_WORDS: ReadonlyMap<string, string> = new Map([
  [HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE, CODING_AGENT_TOOL_REFUSAL.NOT_REACHABLE],
  [HOSTED_API_ERROR.AGENT_NOT_READY, CODING_AGENT_TOOL_REFUSAL.NOT_READY],
  [HOSTED_API_ERROR.AGENT_RETIRED, CODING_AGENT_TOOL_REFUSAL.RETIRED],
  [HOSTED_API_ERROR.NOT_FOUND, CODING_AGENT_TOOL_REFUSAL.NO_AGENT],
  [HOSTED_API_ERROR.TASK_ARCHIVED, CODING_AGENT_TOOL_REFUSAL.ARCHIVED],
]);

/** Who calls an agent tool: Luke on a call, or a coding agent from its own session. */
export const AGENT_CALLER = {
  LUKE: "luke",
  AGENT: "agent",
} as const;

/**
 * Who a call is made by, as the host established it and never as the call
 * said: Luke on the call's task, acting for the member on the call; or a
 * coding agent, acting for the member who started it, on its own task.
 */
type AgentCaller =
  | { readonly kind: typeof AGENT_CALLER.LUKE; readonly plan: PlanDocumentBinding }
  | { readonly kind: typeof AGENT_CALLER.AGENT; readonly agent: CodingAgent };

/** What a call of the agent tools runs under: who calls, eve as the deployment acting for the caller's member, the writer, and the key the one message or start is made under. */
export interface CodingAgentCall {
  readonly caller: AgentCaller;
  /** eve's coding-agent service as the deployment acting for the caller's member; nothing where the deployment names no secret or no origin for eve, which sends and starts nothing. */
  readonly eve: EveSessions | undefined;
  readonly writer: Effect.Effect<StoreWriter>;
  /** The key a message or a start is made under: eve's own id for the tool call, so a call run again sends or starts once. */
  readonly clientKey: string;
}

/** What a message or a start reaches: the store, GitHub through the App on the member's standing, the network to eve, and the catalog a start's choice is checked against. */
type CodingAgentToolServices = DatabaseServices | HttpClient.HttpClient | GitHubApp | ModelCatalog;

const AGENT_ID = describeWire(
  wireUuidSchema,
  `The agent's id, as ${AGENT_TOOL.LIST_AGENTS} answered it or a message from it named it.`,
);

const READ_AGENT_INPUT = Schema.Struct({ agentId: AGENT_ID });

/** A coding agent's read names the agent and, at most, how long a tail it wants. */
const CODER_READ_AGENT_INPUT = Schema.Struct({
  agentId: AGENT_ID,
  entries: Schema.optionalKey(
    describeWire(
      Schema.Int.check(
        Schema.isBetween({ minimum: 1, maximum: CODING_AGENT_TOOL_BOUNDS.MAX_TAIL_ENTRIES }),
      ),
      "How many entries of its transcript to read, the newest last; " +
        `${CODING_AGENT_TOOL_BOUNDS.TAIL_ENTRIES} when left out, at most ` +
        `${CODING_AGENT_TOOL_BOUNDS.MAX_TAIL_ENTRIES}.`,
    ),
  ),
});

const MESSAGE_AGENT_INPUT = Schema.Struct({
  agentId: AGENT_ID,
  text: describeWire(
    Schema.Trim.check(
      Schema.isNonEmpty(),
      Schema.isMaxLength(CODING_AGENT_BOUNDS.MAX_MESSAGE_CHARS),
    ),
    "What to tell the agent, as a message it reads in its own conversation; the developer's " +
      `words where you pass on theirs. A coding agent's message opens with a heading naming it, so ` +
      `keep one of yours under ${CODING_AGENT_BOUNDS.MAX_MESSAGE_CHARS - AGENT_HEADING_ROOM_CHARS} characters.`,
  ),
});

/** A prompt or a note a start may name: bounded apart from a message, since a brief to a worker on a long plan is quoted whole. */
const START_PROMPT = Schema.Trim.check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(CODING_AGENT_BOUNDS.MAX_START_WORDS_CHARS),
);

/**
 * A start names a prompt at most, a note at most, and a model with its
 * effort or neither; the catalog decides whether the two name anything.
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
});

const readAgentRef = Schema.decodeUnknownResult(READ_AGENT_INPUT);
const readAgentAsked = Schema.decodeUnknownResult(CODER_READ_AGENT_INPUT);

const ARCHIVE_AGENT_INPUT = Schema.Struct({
  agentId: AGENT_ID,
  reason: Schema.optionalKey(
    describeWire(
      Schema.Trim.check(
        Schema.isNonEmpty(),
        Schema.isMaxLength(CODING_AGENT_BOUNDS.MAX_ARCHIVE_REASON_CHARS),
      ),
      "Why it is archived, in a short sentence the developer reads on the archived agent's " +
        "banner beside your name, such as its pull request having merged; leave it out where " +
        "there is nothing to say.",
    ),
  ),
});

const readArchive = Schema.decodeUnknownResult(ARCHIVE_AGENT_INPUT);
const readMessage = Schema.decodeUnknownResult(MESSAGE_AGENT_INPUT);
/** A start as a call carries it: one Luke made under the tool's earlier words names its prompt `task`. */
const START_AGENT_CALL = Schema.Struct({
  ...START_AGENT_INPUT.fields,
  task: Schema.optionalKey(START_PROMPT),
});

const readStart = Schema.decodeUnknownResult(START_AGENT_CALL);

/** The tools as Luke and every coding agent are offered them: each its name, its words, and its input schema. */
export const LIST_AGENTS_TOOL = {
  name: AGENT_TOOL.LIST_AGENTS,
  description:
    "List the coding agents of your workspace, on any task or none and started by any member, " +
    "yourself left out: each with its id, its title (how the developer sees it named), the model " +
    "and effort it runs on with the model's name to say it by, its status (starting, running, " +
    "completed, failed, cancelled), its repository and the branch its sandbox is on if a turn " +
    "has ended, one line of what it last did, its task (id, name, and whether archived; null for " +
    "an agent on no task) and whether that is the task you work on, and whether the agent is " +
    "archived, and its mention, the `[@title](link)` to name it by in your words, " +
    `the newest started first and at most ${WORKSPACE_AGENTS_LIST_LIMIT}. Pass thisTask ` +
    "for only your task's agents, or a taskId for another task's. Call it to find the agent you " +
    "or the developer mean.",
  inputSchema: AGENT_LIST_INPUT,
} as const;

/** `read_agent` as Luke on a call is offered it, who says what he read aloud. */
export const READ_AGENT_TOOL = {
  name: AGENT_TOOL.READ_AGENT,
  description:
    "Read one coding agent's recent progress: its status, the branch it pushed and the pull " +
    "request from it as GitHub holds them, and a short tail of what it last said and did, " +
    "newest last. Summarise it in a sentence or two; never read it out.",
  inputSchema: READ_AGENT_INPUT,
} as const;

/** `read_agent` as a coding agent is offered it, which reads the tail as text and may ask for more of it. */
export const CODER_READ_AGENT_TOOL = {
  name: AGENT_TOOL.READ_AGENT,
  description:
    "Read one coding agent of your workspace by its id, on any task and started by any member: " +
    `what ${AGENT_TOOL.LIST_AGENTS} says of it, the branch it pushed and the pull request from it ` +
    "as GitHub holds them, and the tail of its transcript, what it last said and which tools it " +
    "called on what, newest last, each entry cut to " +
    `${CODING_AGENT_TOOL_BOUNDS.AGENT_ENTRY_CHARS} characters. Read one to learn why an agent ` +
    "went quiet, what it is stuck on, or what it did, before you message it or decide what " +
    "comes next. It only reads: the agent is not told. Answers `accepted` with the reading, or " +
    "`rejected` and why.",
  inputSchema: CODER_READ_AGENT_INPUT,
} as const;

export const MESSAGE_AGENT_TOOL = {
  name: AGENT_TOOL.MESSAGE_AGENT,
  description:
    "Send a coding agent of your workspace a message, by its id. It lands in that agent's " +
    "conversation under your name: a running agent sees it at its next step, and an idle one " +
    "starts a turn on it. Answers `accepted` once that agent's session has taken it, without " +
    "waiting for it to act or reply, or `rejected` and why nothing was sent; an archived agent " +
    "takes nothing.",
  inputSchema: MESSAGE_AGENT_INPUT,
} as const;

export const START_AGENT_TOOL = {
  name: AGENT_TOOL.START_AGENT,
  description:
    "Start a new coding agent on the task you work on, or on another task of your workspace by " +
    `its taskId as ${AGENT_TOOL.LIST_TASKS} answered it, exactly as the developer's Start button ` +
    "would: on the task's plan itself with no prompt, or on the prompt given in the plan's " +
    "place, with the note after either. This one call carries everything the agent is told as " +
    "it starts, and the agent sets to work on it at once, so never follow it with a message to " +
    "the agent it started; message it only when there is something new to say. It runs on the " +
    "model and effort named, or on the member's default with neither. Answers `accepted` with " +
    "the agent's id, model, the model's name to say it by, effort, status, and mention once its session " +
    "is open, or `rejected` and why nothing was started; a rejected model or effort lists the " +
    "choices.",
  inputSchema: START_AGENT_INPUT,
} as const;

export const ARCHIVE_AGENT_TOOL = {
  name: AGENT_TOOL.ARCHIVE_AGENT,
  description:
    "Archive a coding agent of your workspace by its id, as the developer's Archive agent " +
    "would, on behalf of the developer you work for: it leaves the sidebar, its task's tabs, " +
    "and every list but the archived ones, takes no message, and is not woken, while its " +
    "transcript, branch, and pull request are kept, and any member can unarchive it. Archive " +
    "a helper or worker agent whose work is done, such as one whose pull request merged, or " +
    "one the developer asked you to clean up; never a teammate's agent still in use unless " +
    "the developer asked for it. Only an idle agent is archived: one still starting or " +
    "running is refused, and no agent archives itself. Give a short reason, which the " +
    "archived agent's banner shows with your name. Answers `accepted`, also for an agent " +
    "already archived, or `rejected` and why. Then say which agent you archived and why.",
  inputSchema: ARCHIVE_AGENT_INPUT,
} as const;

export const UNARCHIVE_AGENT_TOOL = {
  name: AGENT_TOOL.UNARCHIVE_AGENT,
  description:
    "Bring an archived coding agent of your workspace back by its id, as the developer's " +
    "Unarchive would: it stands in its task and the lists again and takes messages, its " +
    "transcript and pull request as they were. Unarchive one archived by mistake, or one the " +
    "developer asks for. Answers `accepted`, also for an agent not archived, or `rejected` " +
    "and why.",
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
    "Read a page an agent showed on a task of your workspace, by its id: its title, the " +
    "version read (the newest unless you name one) and the newest there is, its task and " +
    "whether that is the task you work on, its mention ready to write, and its HTML as it " +
    "stands, cut on a line at " +
    `${READ_PAGE_CHARS} characters with how many were left out. Read a page the developer ` +
    "pointed you at, or one another agent showed, before you build on it or revise it; to " +
    `revise a page of your own task, show it again with ${AGENT_TOOL.SHOW_PAGE} and its id.`,
  inputSchema: READ_PAGE_INPUT,
} as const;

/** A list of tasks names its words to look for at most, and how many of the matching tasks to pass over. */
const LIST_TASKS_INPUT = Schema.Struct({
  nameContains: Schema.optionalKey(
    describeWire(
      Schema.Trim.check(Schema.isNonEmpty(), Schema.isMaxLength(200)),
      "Only the tasks whose name holds these words, whatever their case; leave it out for all.",
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
    "List the open tasks of your workspace, started by any member: each with its id, its name, " +
    "the repository its agents work in (null for none yet), who started it, whether it is " +
    "the task you work on, and its mention, the `[@name](link)` to name it by in your words, " +
    `the newest first and at most ${TASKS_LIST_LIMIT} a page, with ` +
    "nextOffset where more stand. Narrow it by words of a task's name with nameContains. Call it " +
    `to find the task to start an agent on with ${AGENT_TOOL.START_AGENT}'s taskId, or to ` +
    `narrow ${AGENT_TOOL.LIST_AGENTS} to one.`,
  inputSchema: LIST_TASKS_INPUT,
} as const;

/** How a call of one coding tool is said: its verb, and the one input field that names its subject. */
interface CallWords {
  readonly verb: string;
  readonly key: string;
}

/** Each coding tool's words; a patch names its files in its own headers and stands apart. */
const CALL_WORDS: ReadonlyMap<string, CallWords> = new Map([
  [CODER_TOOL.BASH, { verb: "Ran", key: "command" }],
  [CODER_TOOL.READ_FILE, { verb: "Read", key: "filePath" }],
  [CODER_TOOL.WRITE_FILE, { verb: "Wrote", key: "filePath" }],
  [CODER_TOOL.GLOB, { verb: "Searched", key: "pattern" }],
  [CODER_TOOL.GREP, { verb: "Searched", key: "pattern" }],
  [CODER_TOOL.READ_WEB_PAGE, { verb: "Fetched", key: "url" }],
  [CODER_TOOL.SEARCH_WEB, { verb: "Searched the web for", key: "query" }],
  [RETIRED_CODER_TOOL.WEB_FETCH, { verb: "Fetched", key: "url" }],
  [RETIRED_CODER_TOOL.WEB_SEARCH, { verb: "Searched the web for", key: "query" }],
]);

/** A patch header naming a file, as `apply_patch` spells one. */
const PATCH_FILE_HEADER = /^\*\*\* (?:Add|Update|Delete|Move to) File: (.+)$/u;

const ENTRY_WORDS = {
  SAID: "Said",
  EDITED: "Edited",
  USED: "Used",
  RUNNING: "(running)",
} as const;

function cut(text: string, maximumChars: number): string {
  const line = text.replace(/\s+/gu, " ").trim();
  return line.length > maximumChars ? `${line.slice(0, maximumChars - 1)}…` : line;
}

/** What a call was done to, read from its input alone. */
function subjectOf(name: string, input: UnparsedWireValue): string {
  if (name === CODER_TOOL.APPLY_PATCH) {
    const patch = isRecord(input) && isWireString(input.patchText) ? input.patchText : "";
    return patch
      .split("\n")
      .flatMap((line) => PATCH_FILE_HEADER.exec(line.trimEnd())?.[1] ?? [])
      .join(", ");
  }
  const words = CALL_WORDS.get(name);
  if (words === undefined || !isRecord(input)) return "";
  const subject = input[words.key];
  return isWireString(subject) ? subject : "";
}

/** One call as a line of the tail: its verb, its subject, and whether it still runs. */
function callEntry(part: StoredToolPart): string {
  const name = part.type.slice("tool-".length);
  const verb =
    name === CODER_TOOL.APPLY_PATCH
      ? ENTRY_WORDS.EDITED
      : (CALL_WORDS.get(name)?.verb ?? ENTRY_WORDS.USED);
  // SAFETY: a stored part's input is the JSON the row carried; the read names one field of it and trusts no other.
  const subject = subjectOf(name, part.input as UnparsedWireValue) || name;
  const running = isSettledToolPartState(part.state) ? "" : ` ${ENTRY_WORDS.RUNNING}`;
  return `${verb}: ${subject}${running}`;
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
  /** The agent's title as its tab shows it; the model's id where it has none yet, which is what the tab falls back to. */
  readonly title: string;
  readonly model: string;
  /** The model as Luke says it and the screen shows it, without the maker's word (`modelLabel`). */
  readonly modelName: string;
  readonly effort: string;
  readonly status: CodingAgentStatus;
  readonly failureReason?: CodingAgentFailure;
  readonly repository: string;
  readonly branch: string | null;
  readonly activity: string | null;
  /** The agent's mention, `[@title](link)`, as the caller writes it to name the agent in its words. */
  readonly mention: string;
}

/** The newest journals of an agent's conversation, read under the member who started it, oldest first; none where the page does not read. */
const journalsOf = (agent: CodingAgent, limit: number) =>
  Effect.map(listJournals(agent.userId, agent.conversationId, CODER_TOOL_SET, limit), (read) =>
    read.ok ? read.value.map((record) => record.message) : [],
  );

/** The agents' standings, read once for the lot: each one's newest turn, and whether a line of the developer's awaits one. The agents were read through their workspace's gate, so their conversations are read by id. */
const standingsOf = (agents: readonly CodingAgent[]) =>
  Effect.gen(function* () {
    const ids = agents.map((agent) => agent.conversationId);
    const turns = yield* latestTurnsOfReached(ids);
    const awaiting = yield* awaitingLinesOfReached(ids);
    const now = yield* Clock.currentTimeMillis;
    return (agent: CodingAgent) => {
      const turn = turns.get(agent.conversationId);
      const status = codingAgentStatusOf(turn, {
        createdAt: agent.createdAt,
        now,
        lineAwaits: awaiting.has(agent.conversationId),
      });
      // Why the newest turn failed is said only while the agent reads as failed: a line awaiting the next turn makes it running again.
      return {
        status,
        failureReason:
          status === CODING_AGENT_STATUS.FAILED ? codingAgentFailureOf(turn) : undefined,
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

const readAgent = (
  agent: CodingAgent,
  task: AgentTaskReading,
  standing: {
    readonly status: CodingAgentStatus;
    readonly failureReason: CodingAgentFailure | undefined;
  },
  offered: readonly OfferedModel[],
  workspace: string,
): Effect.Effect<AgentReading, StoreFailure, DatabaseServices> =>
  Effect.gen(function* () {
    const [newest] = yield* journalsOf(agent, 1);
    const activity =
      newest === undefined
        ? undefined
        : entriesOf(newest, CODING_AGENT_TOOL_BOUNDS.ACTIVITY_CHARS).at(-1);
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
  });

/** What the agent published as GitHub holds it, or nothing where GitHub could not be asked, which is said as no publication rather than none. */
const publishedOf = (
  userId: string,
  agent: CodingAgent,
): Effect.Effect<
  CodingAgentPullRequestAnswer | undefined,
  never,
  DatabaseServices | HttpClient.HttpClient | GitHubApp
> =>
  Effect.map(Effect.result(agentPublished(userId, agent)), (read) =>
    Result.isSuccess(read) ? read.success : undefined,
  );

/** The member a call acts for: the one on Luke's call, or the starter of the coding agent calling. */
function callerUserId(caller: AgentCaller): string {
  return caller.kind === AGENT_CALLER.LUKE ? caller.plan.userId : caller.agent.userId;
}

/** The task the caller works on: the call's, or the coding agent's own, which may be none. */
function callerTask(caller: AgentCaller): string | null {
  return caller.kind === AGENT_CALLER.LUKE ? caller.plan.taskId : caller.agent.taskId;
}

/** The workspace the caller reaches agents in, read on its member's standing now; nothing where they no longer reach it. */
const callerWorkspace = (caller: AgentCaller) =>
  caller.kind === AGENT_CALLER.LUKE
    ? taskWorkspace(caller.plan.userId, caller.plan.taskId)
    : agentWorkspace(caller.agent.userId, caller.agent);

/** An agent of the caller's workspace under the id, with its task, or nothing: one of another workspace, the member's other ones included, or none. */
const workspaceAgentOf = (caller: AgentCaller, agentId: string) =>
  Effect.gen(function* () {
    const workspace = yield* callerWorkspace(caller);
    if (Option.isNone(workspace)) return Option.none();
    const userId = callerUserId(caller);
    const found = yield* workspaceAgent(userId, workspace.value, agentId);
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

/** A steer's refusal in the model's words. */
function refusalWords(refusal: HostedRefusal): string {
  return REFUSAL_WORDS.get(refusal.error) ?? CODING_AGENT_TOOL_REFUSAL.UNAVAILABLE;
}

/** A start's refusal in the model's words. */
function startRefusalWords(refusal: HostedRefusal): string {
  return START_REFUSAL_WORDS.get(refusal.error) ?? START_CODING_AGENT_REFUSAL.UNAVAILABLE;
}

/** A choice the catalog refused, the one named or the member's stored default, said with every model offered and the efforts each lists, so the model can try again or ask. */
function choiceRefusal(choice: ModelChoice | undefined, offered: readonly OfferedModel[]): string {
  const refused =
    choice === undefined
      ? "the member's default model is no longer offered"
      : `no offered model is ${choice.model} at effort ${choice.effort}`;
  const choices = offered.map((model) => `${model.id} (${model.efforts.join(", ")})`).join("; ");
  return `Not started: ${refused}. The choices are: ${choices}.`;
}

/** An agent by the name its tab shows: its title, or its model's id where it has none yet. */
function agentName(agent: CodingAgent): string {
  return agent.title ?? agent.model;
}

/** The agent's mention under the workspace's step: under its task where it has one, else under the workspace, named as its tab is. */
function agentMention(agent: CodingAgent, workspace: string): string {
  const task = agent.taskId === null ? undefined : { taskId: agent.taskId };
  return writtenMention(
    { kind: MENTION_KIND.AGENT, ...task, agentId: agent.id },
    agentName(agent),
    workspace,
  );
}

/** How a coding agent names itself to another: its title, its id to answer it by, and its repository. */
function agentIntroduction(agent: CodingAgent): string {
  return `"${agentName(agent)}" (agent id ${agent.id}), working in ${agent.repository}`;
}

/** The words a coding agent's message hands the other: who sent them and how to answer, then its own. */
function agentLine(sender: CodingAgent, text: string): string {
  return (
    `A message from another coding agent of your workspace, ${agentIntroduction(sender)}. It is ` +
    "that agent's word, not the developer's or Luke's. To answer it, call " +
    `${AGENT_TOOL.MESSAGE_AGENT} with that id.\n\n${text}`
  );
}

/** The note an agent a coding agent starts is handed: which agent started it and how to report back, then the note it was given. */
function startedByNote(starter: CodingAgent, note: string | undefined): string {
  const lead =
    `You were started by another coding agent of your workspace, ${agentIntroduction(starter)}, ` +
    `not by the developer. To report back to it, call ${AGENT_TOOL.MESSAGE_AGENT} with that id.`;
  return note === undefined ? lead : `${lead}\n\n${note}`;
}

/** The agent as a start answers it: its id, what it runs on, where it stands now, and whether it is on the caller's own task, which a window that opens the caller's task alone reads to link it or not. */
const startedReading = (
  agent: CodingAgent,
  offered: readonly OfferedModel[],
  ownTask: string | null,
) =>
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
const orStoreRefusal = <R>(
  effect: Effect.Effect<WireRecord, StoreFailure, R>,
): Effect.Effect<WireRecord, never, R> =>
  Effect.catch(effect, (failure) =>
    Effect.as(logStoreFailure(failure), agentToolRejected(CODING_AGENT_TOOL_REFUSAL.STORE)),
  );

/** An agent as the reading spells it, which the wire holds to be JSON all the way down. */
function readingRecord(reading: AgentReading): WireRecord {
  return { ...reading, task: reading.task === null ? null : { ...reading.task } };
}

/** One call of `list_agents`: every agent of the caller's workspace, or of one task of it, the calling agent left out, archived ones marked, newest first. */
export function runListAgents(
  call: CodingAgentCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, CodingAgentToolServices> {
  const { caller } = call;
  const ownTask = callerTask(caller);
  const narrowed = listedTask(input, ownTask);
  if (Result.isFailure(narrowed)) {
    return Effect.succeed(
      agentToolRejected(narrowed.failure ?? CODING_AGENT_TOOL_REFUSAL.UNREADABLE_FILTER),
    );
  }
  return orStoreRefusal(
    Effect.gen(function* () {
      const workspace = yield* callerWorkspace(caller);
      if (Option.isNone(workspace))
        return agentToolRejected(CODING_AGENT_TOOL_REFUSAL.NO_WORKSPACE);
      const { agents, taskOf } = yield* workspaceAgentsOf(callerUserId(caller), workspace.value, {
        taskId: narrowed.success,
        except: caller.kind === AGENT_CALLER.AGENT ? caller.agent.id : undefined,
      });
      const standing = yield* standingsOf(agents);
      const offered = yield* offeredModels;
      const step = yield* workspaceStepOf(callerUserId(caller), workspace.value);
      const readings = yield* Effect.forEach(agents, (agent) =>
        readAgent(agent, taskReading(taskOf(agent), ownTask), standing(agent), offered, step),
      );
      return { status: ACTION_RESULT_STATUS.ACCEPTED, agents: readings.map(readingRecord) };
    }),
  );
}

/**
 * The newest entries of an agent's transcript, as many as asked where it
 * has them. Note that the newest turns are read first and older ones only
 * where those fall short, because a coding agent's one turn is often its
 * whole run, long enough on its own; and that the second read takes as many
 * turns as entries asked, since a turn that ended carries at least one.
 */
const tailOf = (agent: CodingAgent, entries: number, entryChars: number) =>
  Effect.gen(function* () {
    const entriesIn = (journals: readonly StoredUIMessage[]) =>
      journals.flatMap((journal) => entriesOf(journal, entryChars));
    const newest = yield* journalsOf(agent, CODING_AGENT_TOOL_BOUNDS.TAIL_TURNS);
    const read = entriesIn(newest);
    const more =
      read.length < entries &&
      newest.length === CODING_AGENT_TOOL_BOUNDS.TAIL_TURNS &&
      entries > CODING_AGENT_TOOL_BOUNDS.TAIL_TURNS;
    const all = more ? entriesIn(yield* journalsOf(agent, entries)) : read;
    return all.slice(-entries);
  });

/** One call of `read_agent`: the agent as the list reads it, and the tail of its newest turns, as long as asked and each entry cut for the caller. */
export function runReadAgent(
  call: CodingAgentCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, CodingAgentToolServices> {
  const asked = readAgentAsked(input);
  if (Result.isFailure(asked)) {
    return Effect.succeed(agentToolRejected(CODING_AGENT_TOOL_REFUSAL.UNREADABLE));
  }
  const entries = asked.success.entries ?? CODING_AGENT_TOOL_BOUNDS.TAIL_ENTRIES;
  const entryChars =
    call.caller.kind === AGENT_CALLER.AGENT
      ? CODING_AGENT_TOOL_BOUNDS.AGENT_ENTRY_CHARS
      : CODING_AGENT_TOOL_BOUNDS.ENTRY_CHARS;
  return orStoreRefusal(
    Effect.gen(function* () {
      const found = yield* workspaceAgentOf(call.caller, asked.success.agentId);
      if (Option.isNone(found)) return agentToolRejected(CODING_AGENT_TOOL_REFUSAL.NO_AGENT);
      const { agent, task, workspaceId } = found.value;
      const standing = yield* standingsOf([agent]);
      const step = yield* workspaceStepOf(callerUserId(call.caller), workspaceId);
      const reading = yield* readAgent(agent, task, standing(agent), yield* offeredModels, step);
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

/** The line a message makes, and what sent it: Luke's words as they are, or a coding agent's opening with who sent them; nothing where a coding agent's line runs over the bound. */
function messageLine(
  caller: AgentCaller,
  text: string,
): { readonly text: string; readonly sender: LineSender } | undefined {
  if (caller.kind === AGENT_CALLER.LUKE) return { text, sender: { kind: MESSAGE_SENDER.LUKE } };
  const line = agentLine(caller.agent, text);
  if (line.length > CODING_AGENT_BOUNDS.MAX_MESSAGE_CHARS) return undefined;
  return { text: line, sender: { kind: MESSAGE_SENDER.AGENT, name: agentName(caller.agent) } };
}

/** One call of `message_agent`: the words handed to an agent of the caller's workspace, or why nothing was sent. */
export function runMessageAgent(
  call: CodingAgentCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, CodingAgentToolServices> {
  const asked = readMessage(input);
  if (Result.isFailure(asked)) {
    return Effect.succeed(agentToolRejected(CODING_AGENT_TOOL_REFUSAL.UNREADABLE));
  }
  const { agentId, text } = asked.success;
  const { caller, eve } = call;
  if (caller.kind === AGENT_CALLER.AGENT && agentId === caller.agent.id) {
    return Effect.succeed(agentToolRejected(CODING_AGENT_TOOL_REFUSAL.SELF));
  }
  const line = messageLine(caller, text);
  if (line === undefined)
    return Effect.succeed(agentToolRejected(CODING_AGENT_TOOL_REFUSAL.TOO_LONG));
  if (eve === undefined)
    return Effect.succeed(agentToolRejected(CODING_AGENT_TOOL_REFUSAL.NO_SERVICE));
  return orStoreRefusal(
    Effect.gen(function* () {
      const found = yield* workspaceAgentOf(caller, agentId);
      if (Option.isNone(found)) return agentToolRejected(CODING_AGENT_TOOL_REFUSAL.NO_AGENT);
      const { agent } = found.value;
      if (agent.archivedAt !== null)
        return agentToolRejected(CODING_AGENT_TOOL_REFUSAL.AGENT_ARCHIVED);
      const sent = yield* steerCodingAgent(eve, call.writer, callerUserId(caller), agent, {
        ...line,
        clientKey: call.clientKey,
      }).pipe(Effect.result);
      if (Result.isFailure(sent)) return agentToolRejected(refusalWords(sent.failure));
      return {
        status: ACTION_RESULT_STATUS.ACCEPTED,
        delivery: sent.success,
        agent: {
          id: agent.id,
          title: agentName(agent),
          status: CODING_AGENT_STATUS.RUNNING,
          onYourTask: agent.taskId !== null && agent.taskId === callerTask(caller),
        },
      };
    }),
  );
}

/** One call of `start_agent`: an agent started on the caller's own task under the call's own key, or why nothing was started. */
export function runStartAgent(
  call: CodingAgentCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, CodingAgentToolServices> {
  const asked = readStart(input);
  // A choice is one thing: a model without its effort, or the reverse, names nothing to run on.
  if (
    Result.isFailure(asked) ||
    (asked.success.model === undefined) !== (asked.success.effort === undefined)
  ) {
    return Effect.succeed(agentToolRejected(START_CODING_AGENT_REFUSAL.UNREADABLE));
  }
  const { model, effort } = asked.success;
  const prompt = asked.success.prompt ?? asked.success.task;
  const choice = model !== undefined && effort !== undefined ? { model, effort } : undefined;
  const { caller, eve } = call;
  const named = asked.success.taskId;
  const planId = named ?? callerTask(caller);
  if (planId === null) return Effect.succeed(agentToolRejected(START_CODING_AGENT_REFUSAL.NO_TASK));
  if (eve === undefined)
    return Effect.succeed(agentToolRejected(START_CODING_AGENT_REFUSAL.NO_SERVICE));
  // An agent a coding agent starts hears who started it, and its choice is no member's new default.
  const byAgent = caller.kind === AGENT_CALLER.AGENT;
  const note = byAgent ? startedByNote(caller.agent, asked.success.note) : asked.success.note;
  return orStoreRefusal(
    Effect.gen(function* () {
      // Another task is started on only where it is one of the caller's own workspace. A call run
      // again after its start landed answers the agent it made while that agent is still of the
      // caller's workspace, and is refused as naming none once its task has moved out of it, so a
      // retry neither starts a second agent nor tells of one in a workspace the caller left behind.
      if (named !== undefined && named !== callerTask(caller)) {
        const made = yield* readCodingAgentByKey(callerUserId(caller), call.clientKey);
        if (Option.isSome(made)) {
          const workspace = yield* callerWorkspace(caller);
          const ours = Option.isSome(workspace) && made.value.organizationId === workspace.value;
          if (!ours) return agentToolRejected(START_CODING_AGENT_REFUSAL.NO_SUCH_TASK);
          return {
            status: ACTION_RESULT_STATUS.ACCEPTED,
            agent: yield* startedReading(made.value, yield* offeredModels, callerTask(caller)),
          };
        }
        const reached = yield* taskOfCallerWorkspace(caller, named);
        if (!reached) return agentToolRejected(START_CODING_AGENT_REFUSAL.NO_SUCH_TASK);
      }
      const started = yield* startCodingAgent(Effect.succeed(eve), callerUserId(caller), {
        taskId: planId,
        idempotencyKey: call.clientKey,
        choice,
        prompt,
        note,
        ...(byAgent ? { rememberChoice: false, noteHeading: START_NOTE_HEADING.AGENT } : undefined),
      }).pipe(Effect.result);
      if (Result.isFailure(started)) {
        const refusal = started.failure;
        if (refusal instanceof ModelChoiceRefused) {
          return agentToolRejected(choiceRefusal(choice, yield* offeredModels));
        }
        return agentToolRejected(startRefusalWords(refusal));
      }
      return {
        status: ACTION_RESULT_STATUS.ACCEPTED,
        agent: yield* startedReading(
          started.success.agent,
          yield* offeredModels,
          callerTask(caller),
        ),
      };
    }),
  );
}

/** Who an archive is by: Luke, or the calling coding agent by its id and name, for the member the caller acts for, with the reason given. */
function archiverOf(caller: AgentCaller, reason: string | undefined): StoredArchive {
  const why = reason === undefined ? undefined : { reason };
  if (caller.kind === AGENT_CALLER.LUKE) {
    return { by: CODING_AGENT_ARCHIVER.LUKE, userId: caller.plan.userId, ...why };
  }
  return {
    by: CODING_AGENT_ARCHIVER.AGENT,
    userId: caller.agent.userId,
    agentId: caller.agent.id,
    agentName: agentName(caller.agent),
    ...why,
  };
}

/** An archive or an unarchive as the model reads it: the agent, whether it now stands archived, and whether it already stood so before the call. */
function archiveAnswer(
  agent: CodingAgent,
  task: AgentTaskReading,
  archived: boolean,
  already: boolean,
): WireRecord {
  return {
    status: ACTION_RESULT_STATUS.ACCEPTED,
    agent: {
      id: agent.id,
      title: agentName(agent),
      task: task.task === null ? null : { ...task.task },
      onYourTask: task.onYourTask,
    },
    archived,
    already,
  };
}

/**
 * Whether an agent stands idle for an archive: no line awaits its turn, its
 * newest turn is neither queued nor running, a Stop requested of it or not,
 * since a stopped turn still runs until eve ends it, and it is past its
 * start where it has no turn yet.
 */
const idleForArchive = (agent: CodingAgent) =>
  Effect.gen(function* () {
    const turns = yield* latestTurnsOfReached([agent.conversationId]);
    const awaiting = yield* awaitingLinesOfReached([agent.conversationId]);
    if (awaiting.has(agent.conversationId)) return false;
    const turn = turns.get(agent.conversationId);
    if (turn !== undefined) return !RUNNING_TURN_STATUSES.has(turn.status);
    const now = yield* Clock.currentTimeMillis;
    return (
      codingAgentStatusOf(undefined, { createdAt: agent.createdAt, now }) !==
      CODING_AGENT_STATUS.STARTING
    );
  });

/** One call of `archive_agent`: an idle agent of the caller's workspace archived for the caller's member, by the caller and for the reason given, or why it was not. */
export function runArchiveAgent(
  call: CodingAgentCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, CodingAgentToolServices> {
  const asked = readArchive(input);
  if (Result.isFailure(asked)) {
    return Effect.succeed(agentToolRejected(ARCHIVE_AGENT_REFUSAL.UNREADABLE));
  }
  const { agentId, reason } = asked.success;
  const { caller } = call;
  if (caller.kind === AGENT_CALLER.AGENT && agentId === caller.agent.id) {
    return Effect.succeed(agentToolRejected(ARCHIVE_AGENT_REFUSAL.SELF));
  }
  return orStoreRefusal(
    Effect.gen(function* () {
      const found = yield* workspaceAgentOf(caller, agentId);
      if (Option.isNone(found)) return agentToolRejected(CODING_AGENT_TOOL_REFUSAL.NO_AGENT);
      const { agent, task } = found.value;
      // Whether it is idle is read under its conversation's lock, so a turn queued or a message
      // handed over meanwhile waits on the archive and is seen by it, never left running unseen.
      const archived = yield* archiveIdleCodingAgent(
        callerUserId(caller),
        agent.id,
        archiverOf(caller, reason),
        idleForArchive,
      );
      if (archived === IDLE_ARCHIVE.NOT_FOUND) {
        return agentToolRejected(CODING_AGENT_TOOL_REFUSAL.NO_AGENT);
      }
      if (archived === IDLE_ARCHIVE.WORKING)
        return agentToolRejected(ARCHIVE_AGENT_REFUSAL.WORKING);
      return archiveAnswer(agent, task, true, archived === IDLE_ARCHIVE.ALREADY);
    }),
  );
}

/** One call of `unarchive_agent`: an archived agent of the caller's workspace brought back, as a member's Unarchive brings it. */
export function runUnarchiveAgent(
  call: CodingAgentCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, CodingAgentToolServices> {
  const asked = readAgentRef(input);
  if (Result.isFailure(asked)) {
    return Effect.succeed(agentToolRejected(ARCHIVE_AGENT_REFUSAL.UNREADABLE));
  }
  const { caller } = call;
  return orStoreRefusal(
    Effect.gen(function* () {
      const found = yield* workspaceAgentOf(caller, asked.success.agentId);
      if (Option.isNone(found)) return agentToolRejected(CODING_AGENT_TOOL_REFUSAL.NO_AGENT);
      const { agent, task } = found.value;
      if (agent.archivedAt === null) return archiveAnswer(agent, task, false, true);
      const userId = callerUserId(caller);
      // Note that only the archive read is cleared, so one made again since stands as its maker left it.
      if (yield* unarchiveCodingAgentFrom(userId, agent.id, agent.archivedAt)) {
        return archiveAnswer(agent, task, false, false);
      }
      const now = yield* readCodingAgent(userId, agent.id);
      if (Option.isSome(now) && now.value.archivedAt === null) {
        return archiveAnswer(agent, task, false, true);
      }
      return agentToolRejected(ARCHIVE_AGENT_REFUSAL.REARCHIVED);
    }),
  );
}

/** One call of `list_tasks`: the open tasks of the caller's workspace, newest first. */
export function runListTasks(
  call: CodingAgentCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, CodingAgentToolServices> {
  const { caller } = call;
  const asked = readTasksAsked(input);
  if (Result.isFailure(asked)) {
    return Effect.succeed(agentToolRejected(CODING_AGENT_TOOL_REFUSAL.UNREADABLE_TASKS));
  }
  const words = asked.success.nameContains?.toLowerCase();
  const offset = asked.success.offset ?? 0;
  return orStoreRefusal(
    Effect.gen(function* () {
      const workspace = yield* callerWorkspace(caller);
      if (Option.isNone(workspace)) {
        return agentToolRejected(CODING_AGENT_TOOL_REFUSAL.NO_WORKSPACE);
      }
      const ownTask = callerTask(caller);
      const plans = yield* listTasks(callerUserId(caller));
      const matching = plans.filter(
        (plan) =>
          plan.workspaceId === workspace.value &&
          (words === undefined || plan.name.toLowerCase().includes(words)),
      );
      const step = yield* workspaceStepOf(callerUserId(caller), workspace.value);
      const tasks = matching.slice(offset, offset + TASKS_LIST_LIMIT).map((plan) => ({
        id: plan.id,
        name: plan.name,
        repository: plan.repository ?? null,
        startedBy: plan.createdBy?.name ?? null,
        isYourTask: plan.id === ownTask,
        mention: writtenMention({ kind: MENTION_KIND.TASK, taskId: plan.id }, plan.name, step),
      }));
      const next = offset + TASKS_LIST_LIMIT;
      return {
        status: ACTION_RESULT_STATUS.ACCEPTED,
        tasks,
        nextOffset: next < matching.length ? next : null,
      };
    }),
  );
}

/** A page's HTML as a read answers it, and how many characters of it were left out. */
interface PageCut {
  readonly html: string;
  readonly leftOutChars: number;
}

/** A page's HTML cut on a line to the read's bound, and how many characters were left out; whole where it fits. */
function pageCut(html: string): PageCut {
  if (html.length <= READ_PAGE_CHARS) return { html, leftOutChars: 0 };
  const lineEnd = html.lastIndexOf("\n", READ_PAGE_CHARS);
  const kept = html.slice(0, lineEnd > 0 ? lineEnd : READ_PAGE_CHARS);
  return { html: kept, leftOutChars: html.length - kept.length };
}

/** One call of `read_page`: a version of a page of a task of the caller's workspace, its HTML cut to the bound, or why there is none. */
export function runReadPage(
  call: CodingAgentCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, CodingAgentToolServices> {
  const asked = readPageAsked(input);
  if (Result.isFailure(asked)) {
    return Effect.succeed(agentToolRejected(READ_PAGE_REFUSAL.UNREADABLE));
  }
  const { caller } = call;
  return orStoreRefusal(
    Effect.gen(function* () {
      const workspace = yield* callerWorkspace(caller);
      if (Option.isNone(workspace)) {
        return agentToolRejected(CODING_AGENT_TOOL_REFUSAL.NO_WORKSPACE);
      }
      const userId = callerUserId(caller);
      const found = yield* readPageById(userId, asked.success.pageId, asked.success.version);
      // A page of a task of another workspace, even one the member is also in, is none of the caller's.
      if (Option.isNone(found) || !(yield* taskOfCallerWorkspace(caller, found.value.taskId))) {
        return agentToolRejected(READ_PAGE_REFUSAL.NO_PAGE);
      }
      const { taskId, page, newestVersion } = found.value;
      const names = yield* planNamesOf(userId, [taskId]);
      const step = yield* taskStepOf(userId, taskId);
      const cut = pageCut(page.html);
      return {
        status: ACTION_RESULT_STATUS.ACCEPTED,
        page: {
          id: page.id,
          title: page.title,
          version: page.version,
          newestVersion,
          task: { id: taskId, name: names.get(taskId)?.name ?? null },
          isYourTask: taskId === callerTask(caller),
          // The page's mention, ready to write, wherever its task's workspace reads for the member.
          ...(Option.isNone(step)
            ? undefined
            : {
                mention: writtenMention(
                  { kind: MENTION_KIND.PAGE, taskId, pageId: page.id },
                  page.title,
                  step.value,
                ),
              }),
          html: cut.html,
          leftOutChars: cut.leftOutChars,
        },
      };
    }),
  );
}
