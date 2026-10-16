import type { DatabaseServices } from "@luke/database/core/query";
import {
  awaitingLinesOfReached,
  type CodingAgent,
  latestTurnsOfReached,
} from "@luke/database/models/coding-agent-store";
import { listJournals } from "@luke/database/models/message-reads";
import { listPlans } from "@luke/database/models/plan-store";
import type { LineSender, StoreWriter } from "@luke/database/models/writer";
import { MESSAGE_SENDER } from "@luke/database/storage-vocabulary";
import {
  CODING_AGENT_BOUNDS,
  CODING_AGENT_STATUS,
  type CodingAgentFailure,
  type CodingAgentPullRequestAnswer,
  type CodingAgentStatus,
} from "@luke/features/coding-agent-wire";
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
import { agentWorkspace, planWorkspace } from "../github/workspace-repository.js";
import type { HostedRefusal } from "../http/http-effect.js";
import { logStoreFailure, type StoreFailure } from "../http/store-failure.js";
import type { PlanDocumentBinding } from "../plans/plan-notes.js";
import { ModelCatalog, ModelChoiceRefused, type OfferedModel } from "../providers/model-catalog.js";
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

/**
 * coding-agent-tools.ts -- the tools every agent reaches the workspace's coding agents by: list them, message one, start one, and for Luke on a call read one's progress.
 *
 * Luke on a call and every coding agent are offered the same `list_agents`,
 * `message_agent`, and `start_agent`, one implementation each, and Luke
 * `read_agent` beside them; the caller is what differs (`AgentCaller`):
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
 * nothing of it where GitHub could not be asked. A message takes the one
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
 * Each tool reaches eve as the deployment acting for the caller's member,
 * which the coder channel's table admits for exactly this
 * (`coder-host/channel.ts`). Every answer is data the model reads, never a
 * credential.
 */

/** The most tasks a list of them answers, the newest started first. */
const TASKS_LIST_LIMIT = 50;

const CODING_AGENT_TOOL_BOUNDS = {
  /** The newest turns a progress read walks, the one under way included. */
  TAIL_TURNS: 3,
  /** The most entries a progress read answers, the newest last. */
  TAIL_ENTRIES: 20,
  /** The most characters one entry of the tail carries. */
  ENTRY_CHARS: 300,
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

/** Why a start made nothing, in words the model can act on; a choice the catalog refused is said with the choices (`choiceRefusal`). */
export const START_CODING_AGENT_REFUSAL = {
  UNREADABLE:
    "Not started: give a prompt as text of at most " +
    `${CODING_AGENT_BOUNDS.MAX_MESSAGE_CHARS} characters, or none to start on the plan, a note ` +
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
  [HOSTED_API_ERROR.PLAN_ARCHIVED, START_CODING_AGENT_REFUSAL.ARCHIVED],
]);

/** The refusal's sentence for each hosted refusal a steer may answer; any other is the service down. */
const REFUSAL_WORDS: ReadonlyMap<string, string> = new Map([
  [HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE, CODING_AGENT_TOOL_REFUSAL.NOT_REACHABLE],
  [HOSTED_API_ERROR.AGENT_NOT_READY, CODING_AGENT_TOOL_REFUSAL.NOT_READY],
  [HOSTED_API_ERROR.AGENT_RETIRED, CODING_AGENT_TOOL_REFUSAL.RETIRED],
  [HOSTED_API_ERROR.NOT_FOUND, CODING_AGENT_TOOL_REFUSAL.NO_AGENT],
  [HOSTED_API_ERROR.PLAN_ARCHIVED, CODING_AGENT_TOOL_REFUSAL.ARCHIVED],
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

/** A prompt a start may name: bounded as a message to an agent is. */
const START_PROMPT = Schema.Trim.check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(CODING_AGENT_BOUNDS.MAX_MESSAGE_CHARS),
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
    `archived, the newest started first and at most ${WORKSPACE_AGENTS_LIST_LIMIT}. Pass thisTask ` +
    "for only your task's agents, or a taskId for another task's. Call it to find the agent you " +
    "or the developer mean.",
  inputSchema: AGENT_LIST_INPUT,
} as const;

export const READ_AGENT_TOOL = {
  name: AGENT_TOOL.READ_AGENT,
  description:
    "Read one coding agent's recent progress: its status, the branch it pushed and the pull " +
    "request from it as GitHub holds them, and a short tail of what it last said and did, " +
    "newest last. Summarise it in a sentence or two; never read it out.",
  inputSchema: READ_AGENT_INPUT,
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
    "the agent's id, model, the model's name to say it by, effort, and status once its session " +
    "is open, or `rejected` and why nothing was started; a rejected model or effort lists the " +
    "choices.",
  inputSchema: START_AGENT_INPUT,
} as const;

export const LIST_TASKS_TOOL = {
  name: AGENT_TOOL.LIST_TASKS,
  description:
    "List the open tasks of your workspace, started by any member: each with its id, its name, " +
    "the repository its agents work in (null for none yet), who started it, and whether it is " +
    `the task you work on, the newest first and at most ${TASKS_LIST_LIMIT}. Call it to find ` +
    `the task to start an agent on with ${AGENT_TOOL.START_AGENT}'s taskId, or to narrow ` +
    `${AGENT_TOOL.LIST_AGENTS} to one.`,
  inputSchema: Schema.Struct({}),
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
  return caller.kind === AGENT_CALLER.LUKE ? caller.plan.planId : caller.agent.planId;
}

/** The workspace the caller reaches agents in, read on its member's standing now; nothing where they no longer reach it. */
const callerWorkspace = (caller: AgentCaller) =>
  caller.kind === AGENT_CALLER.LUKE
    ? planWorkspace(caller.plan.userId, caller.plan.planId)
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
    return Option.some({ agent, task: taskReading(task, callerTask(caller)) });
  });

/** Whether the task named is one of the caller's workspace, as its member reads both now. */
const taskOfCallerWorkspace = (caller: AgentCaller, taskId: string) =>
  Effect.gen(function* () {
    const workspace = yield* callerWorkspace(caller);
    if (Option.isNone(workspace)) return false;
    const taskWorkspace = yield* planWorkspace(callerUserId(caller), taskId);
    return Option.isSome(taskWorkspace) && taskWorkspace.value === workspace.value;
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

/** The agent as a start answers it: its id, what it runs on, and where it stands now. */
const startedReading = (agent: CodingAgent, offered: readonly OfferedModel[]) =>
  Effect.map(standingsOf([agent]), (standing) => ({
    id: agent.id,
    model: agent.model,
    modelName: modelLabel(agent.model, offered),
    effort: agent.effort,
    status: standing(agent).status,
  }));

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
      const readings = yield* Effect.forEach(agents, (agent) =>
        readAgent(agent, taskReading(taskOf(agent), ownTask), standing(agent), offered),
      );
      return { status: ACTION_RESULT_STATUS.ACCEPTED, agents: readings.map(readingRecord) };
    }),
  );
}

/** One call of `read_agent`: the agent as the list reads it, and the tail of its newest turns. */
export function runReadAgent(
  call: CodingAgentCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, CodingAgentToolServices> {
  const asked = readAgentRef(input);
  if (Result.isFailure(asked)) {
    return Effect.succeed(agentToolRejected(CODING_AGENT_TOOL_REFUSAL.UNREADABLE));
  }
  return orStoreRefusal(
    Effect.gen(function* () {
      const found = yield* workspaceAgentOf(call.caller, asked.success.agentId);
      if (Option.isNone(found)) return agentToolRejected(CODING_AGENT_TOOL_REFUSAL.NO_AGENT);
      const { agent, task } = found.value;
      const standing = yield* standingsOf([agent]);
      const reading = yield* readAgent(agent, task, standing(agent), yield* offeredModels);
      const published = yield* publishedOf(callerUserId(call.caller), agent);
      const journals = yield* journalsOf(agent, CODING_AGENT_TOOL_BOUNDS.TAIL_TURNS);
      const tail = journals
        .flatMap((journal) => entriesOf(journal, CODING_AGENT_TOOL_BOUNDS.ENTRY_CHARS))
        .slice(-CODING_AGENT_TOOL_BOUNDS.TAIL_ENTRIES);
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
        agent: { id: agent.id, title: agentName(agent), status: CODING_AGENT_STATUS.RUNNING },
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
      // Another task is started on only where it is one of the caller's own workspace.
      if (named !== undefined && named !== callerTask(caller)) {
        const reached = yield* taskOfCallerWorkspace(caller, named);
        if (!reached) return agentToolRejected(START_CODING_AGENT_REFUSAL.NO_SUCH_TASK);
      }
      const started = yield* startCodingAgent(Effect.succeed(eve), callerUserId(caller), {
        planId,
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
        agent: yield* startedReading(started.success.agent, yield* offeredModels),
      };
    }),
  );
}

/** One call of `list_tasks`: the open tasks of the caller's workspace, newest first. */
export function runListTasks(
  call: CodingAgentCall,
  _input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, CodingAgentToolServices> {
  const { caller } = call;
  return orStoreRefusal(
    Effect.gen(function* () {
      const workspace = yield* callerWorkspace(caller);
      if (Option.isNone(workspace)) {
        return agentToolRejected(CODING_AGENT_TOOL_REFUSAL.NO_WORKSPACE);
      }
      const ownTask = callerTask(caller);
      const plans = yield* listPlans(callerUserId(caller));
      const tasks = plans
        .filter((plan) => plan.workspaceId === workspace.value)
        .slice(0, TASKS_LIST_LIMIT)
        .map((plan) => ({
          id: plan.id,
          name: plan.name,
          repository: plan.repository ?? null,
          startedBy: plan.createdBy?.name ?? null,
          isYourTask: plan.id === ownTask,
        }));
      return { status: ACTION_RESULT_STATUS.ACCEPTED, tasks };
    }),
  );
}
