/**
 * tools.ts -- the tools the member MCP server offers an outside agent acting for a member: each by its name, what it tells the agent, its input, and the effect it runs.
 *
 * A tool is declared once here and registered with the SDK by `server.ts`,
 * which runs its effect through the one promise door. Its input is a wire
 * schema: the node a model is shown is wire's own emission, recorded as a
 * golden under `fixtures/json-schema/member-mcp/`, and the SDK is handed the
 * same declaration as a Standard Schema (`standardSchemaOf`), so a call's
 * arguments are checked against what the model was shown. Its annotations
 * tell the client what the tool does to the member's world, a read touching
 * nothing. Its effect reads the admitted member from the `AdmittedMember`
 * service (`admission.ts`) and answers the tool's result, which the agent
 * reads as JSON text; a refusal is answered as the tool's own error in the
 * refusal's words; a store it could not read fails the effect, which the
 * door answers as the tool's own error in fixed words.
 *
 * The reads of the workspace's tasks, agents, pages, and models run the
 * agent tools' own implementations (`../agents/agent-tools.ts`,
 * `../agents/task-tools.ts`), the coding agents' reads, with the member as
 * the caller (`AGENT_CALLER.MEMBER`): every task, agent, and page is read on
 * the member's own standing, so what the member could not open in the
 * window, a workspace they are not in among it, is none. Each is told to
 * the agent in words of its own, for one acting for the member, on input
 * declared from the agents' own fields where their words hold for it. A
 * call is about one workspace: a list names it by its slug, or is about the
 * member's only one, and is refused, naming the member's workspaces, where
 * they have several and it names none; a read of one task, agent, or page
 * by its id is about the workspace that holds it, as the member reaches it.
 *
 * To add a tool, declare it with `memberMcpTool` and list it in
 * `MEMBER_MCP_TOOLS`; its golden is settled by `app.test.ts`.
 */

import type { ToolAnnotations } from "@modelcontextprotocol/server";
import type { DatabaseServices } from "@repo/database/core/query";
import { readPageById } from "@repo/database/models/plan-pages";
import { readTaskWorkspace } from "@repo/database/models/task-store";
import { listWorkspaces } from "@repo/database/models/workspace-store";
import { AGENT_TOOL } from "@repo/features/agent-tools";
import {
  AGENT_STATUS,
  CHANGED_FILE_STATUS,
  CHECK_SUMMARY,
  PULL_REQUEST_STATE,
} from "@repo/features/agent-wire";
import {
  INBOX_ASK,
  INBOX_BOUNDS,
  INBOX_REPLY,
  INBOX_STATUS,
  inboxAnswersSchema,
} from "@repo/features/inbox-wire";
import { PAGE_OWNER } from "@repo/features/page-wire";
import { TASK_STATUS } from "@repo/features/task-wire";
import { WORKSPACE_BOUNDS, workspaceOfSlug } from "@repo/features/workspace-wire";
import { describeWire, type StandardSchemaWithJson, standardSchemaOf } from "@repo/wire/effect";
import { Effect, Option, Result, Schema } from "effect";
import type { HttpClient } from "effect/http";
import {
  READ_AGENT_CHANGES,
  READ_AGENT_CHANGES_INPUT,
  runReadAgentChanges,
} from "../agents/agent-changes-tool.js";
import {
  AGENT_CALLER,
  AGENT_TOOL_BOUNDS,
  AGENT_TOOL_REFUSAL,
  type AgentReadCall,
  type AgentToolServices,
  agentToolRejected,
  CODER_READ_AGENT_TOOL,
  LIST_AGENTS_TOOL,
  LIST_TASKS_TOOL,
  READ_PAGE_CHARS,
  READ_PAGE_REFUSAL,
  READ_PAGE_TOOL,
  runListAgents,
  runListMemberModels,
  runListTasks,
  runReadAgent,
  runReadPage,
  TASKS_LIST_LIMIT,
} from "../agents/agent-tools.js";
import {
  PLAN_TEXT_READ_CHARS,
  READ_TASK_REFUSAL,
  READ_TASK_TOOL,
  runReadTask,
} from "../agents/task-tools.js";
import { WORKSPACE_AGENTS_LIST_LIMIT } from "../agents/workspace-agents.js";
import { type WireRecord, wireUuidSchema } from "../core.js";
import type { GitHubApp } from "../github/github-app.js";
import { agentWorkspace } from "../github/workspace-repository.js";
import type { StoreFailure } from "../http/store-failure.js";
import type { ModelCatalog } from "../providers/model-catalog.js";
import { AdmittedMember, type AdmittedMemberValues } from "./admission.js";
import {
  answerAskAsMember,
  closeThreadAsMember,
  MEMBER_INBOX_TOOL,
  readMemberInbox,
  replyAsMember,
} from "./inbox.js";

/** What a tool's effect runs against: the store, GitHub through the App, the model catalog, and the member the call acts for. */
export type MemberMcpServices =
  | DatabaseServices
  | HttpClient.HttpClient
  | GitHubApp
  | ModelCatalog
  | AdmittedMember;

/** A tool's input declaration: a wire schema the emitter can show and the reader can read. */
export type MemberMcpToolInput = Schema.Top & Schema.ConstraintDecoder<unknown>;

/** What a tool answers: a record the agent reads as JSON. */
export type MemberMcpToolResult = object;

export interface MemberMcpTool<Input extends MemberMcpToolInput = MemberMcpToolInput> {
  readonly name: string;
  /** What the agent is told of the tool, written for one acting for the member. */
  readonly description: string;
  readonly input: Input;
  /** What the tool does to the member's world, as MCP's annotations tell a client. */
  readonly annotations: ToolAnnotations;
  /** The input as the SDK takes it, built once from `input`. */
  readonly inputSchema: StandardSchemaWithJson<Input>;
  /** The tool's work, on the arguments the SDK checked against `input`. */
  run(input: Input["Type"]): Effect.Effect<MemberMcpToolResult, StoreFailure, MemberMcpServices>;
}

/** The tools by name, each the name a model calls it by. */
export const MEMBER_MCP_TOOL = {
  LIST_WORKSPACES: "list_workspaces",
  LIST_TASKS: AGENT_TOOL.LIST_TASKS,
  READ_TASK: AGENT_TOOL.READ_TASK,
  LIST_AGENTS: AGENT_TOOL.LIST_AGENTS,
  READ_AGENT: AGENT_TOOL.READ_AGENT,
  READ_AGENT_CHANGES,
  LIST_MODELS: AGENT_TOOL.LIST_MODELS,
  READ_PAGE: AGENT_TOOL.READ_PAGE,
  READ_INBOX: MEMBER_INBOX_TOOL.READ,
  ANSWER_ASK: MEMBER_INBOX_TOOL.ANSWER,
  REPLY_TO_THREAD: MEMBER_INBOX_TOOL.REPLY,
  CLOSE_THREAD: MEMBER_INBOX_TOOL.CLOSE,
} as const;

/** A read's annotations: it changes nothing of the member's. */
const READ_ONLY: ToolAnnotations = { readOnlyHint: true };

/** Why a call names no workspace to be about, in words the agent can act on, the member's own named where they have some. */
const MEMBER_WORKSPACE_REFUSAL = {
  NONE: "Not run: the member belongs to no workspace yet.",
  UNKNOWN: (choices: string) =>
    `Not run: the member belongs to no workspace of that slug; name one of theirs: ${choices}.`,
  SEVERAL: (choices: string) =>
    `Not run: the member belongs to several workspaces; name the one to read with workspace: ${choices}.`,
} as const;

/** A tool's declaration, its SDK input built beside it. */
function memberMcpTool<Input extends MemberMcpToolInput>(
  tool: Omit<MemberMcpTool<Input>, "inputSchema">,
): MemberMcpTool<Input> {
  return { ...tool, inputSchema: standardSchemaOf(tool.input) };
}

/** The member as the agent tools' caller, about the workspace given. */
function memberCaller(member: AdmittedMemberValues, workspaceId: string): AgentReadCall {
  return {
    caller: {
      kind: AGENT_CALLER.MEMBER,
      userId: member.userId,
      workspaceId,
      clientId: member.clientId,
    },
  };
}

/**
 * The workspace a list is about: the one of the member's its slug names,
 * read as a link's step is (`workspaceOfSlug`), or the member's only one
 * where it names none; or why there is none, naming the member's own.
 */
const listedWorkspace = (userId: string, slug: string | undefined) =>
  Effect.map(listWorkspaces(userId), (workspaces): Result.Result<string, string> => {
    const choices = workspaces.map((one) => `${one.slug ?? one.id} (${one.name})`).join(", ");
    if (slug !== undefined) {
      const named = workspaceOfSlug(workspaces, slug);
      return named === undefined
        ? Result.fail(MEMBER_WORKSPACE_REFUSAL.UNKNOWN(choices))
        : Result.succeed(named.id);
    }
    const [only, ...others] = workspaces;
    if (only === undefined) return Result.fail(MEMBER_WORKSPACE_REFUSAL.NONE);
    return others.length === 0
      ? Result.succeed(only.id)
      : Result.fail(MEMBER_WORKSPACE_REFUSAL.SEVERAL(choices));
  });

/** A list run as the member, about the workspace its slug names or their only one; refused, naming theirs, where that names none. */
const listAsMember = <R>(
  slug: string | undefined,
  read: (call: AgentReadCall) => Effect.Effect<WireRecord, never, R>,
) =>
  Effect.gen(function* () {
    const member = yield* AdmittedMember;
    const workspace = yield* listedWorkspace(member.userId, slug);
    if (Result.isFailure(workspace)) return agentToolRejected(workspace.failure);
    return yield* read(memberCaller(member, workspace.success));
  });

/** A read by id run as the member, about the workspace that holds what it names as the member reaches it; refused in the read's own words where they reach none. */
const readAsMember = <R>(
  workspaceOf: (userId: string) => Effect.Effect<Option.Option<string>, StoreFailure, R>,
  refusal: string,
  read: (call: AgentReadCall) => Effect.Effect<WireRecord, never, AgentToolServices>,
) =>
  Effect.gen(function* () {
    const member = yield* AdmittedMember;
    const workspace = yield* workspaceOf(member.userId);
    if (Option.isNone(workspace)) return agentToolRejected(refusal);
    return yield* read(memberCaller(member, workspace.value));
  });

/** The workspace of the task, the agent, or the agent with no task a page stands on, as the member reaches it. */
const pageWorkspace = (userId: string, pageId: string) =>
  Effect.flatMap(readPageById(userId, pageId, undefined), (found) => {
    if (Option.isNone(found)) return Effect.succeed(Option.none<string>());
    const { owner } = found.value;
    return owner.kind === PAGE_OWNER.TASK
      ? readTaskWorkspace(userId, owner.taskId)
      : agentWorkspace(userId, { id: owner.agentId });
  });

/** A list's input: the workspace it is about, by its slug, where the member has more than one. */
const WORKSPACE_INPUT = Schema.optionalKey(
  describeWire(
    Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(WORKSPACE_BOUNDS.MAX_SLUG_CHARS)),
    `The workspace to list, by the slug ${MEMBER_MCP_TOOL.LIST_WORKSPACES} answered; leave it ` +
      "out where the member belongs to one workspace alone.",
  ),
);

/** How a list tells the agent to name its workspace. */
const WORKSPACE_WORDS =
  "Name the workspace by its slug where the member belongs to more than one; " +
  `${MEMBER_MCP_TOOL.LIST_WORKSPACES} names them.`;

/** `list_workspaces` takes nothing: the member's workspaces are the member's. */
const NoInputSchema = Schema.Struct({});

export const LIST_WORKSPACES_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.LIST_WORKSPACES,
  description:
    "List the workspaces the member you act for belongs to: each with its id, which every task and agent of it names, its slug, the first step of its links, its name, and the member's role in it (owner, admin, or member). Call it first to learn which workspace to work in.",
  input: NoInputSchema,
  annotations: READ_ONLY,
  run: () =>
    Effect.gen(function* () {
      const member = yield* AdmittedMember;
      const workspaces = yield* listWorkspaces(member.userId);
      return {
        workspaces: workspaces.map(({ id, slug, name, role }) => ({ id, slug, name, role })),
      };
    }),
});

/** A list of tasks narrows as the agents' own does, in the workspace named. */
const ListTasksInputSchema = Schema.Struct({
  workspace: WORKSPACE_INPUT,
  ...LIST_TASKS_TOOL.inputSchema.fields,
});

const MEMBER_LIST_TASKS_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.LIST_TASKS,
  description:
    "List the tasks of a workspace the member belongs to, started by any member, the Done and " +
    "Canceled ones among them: each with its id, its key (such as ACME-42), its name, where it " +
    `stands (its status: ${Object.values(TASK_STATUS).join(", ")}) and how much it matters (its ` +
    "priority), who it is assigned to (its assignee's mention link, null for no one), the " +
    "repository its agents work in (null for none yet), who started it, the sectionId of the " +
    "sidebar section the member keeps it in (null for none), and its mention, the " +
    "`[@name](link)` to name it by in your words, the newest first and at most " +
    `${TASKS_LIST_LIMIT} a page, with nextOffset where more stand; and beside them every ` +
    "section the member keeps in that workspace's sidebar, each with its id and title. Narrow " +
    "it by words of a task's name with nameContains, by where it stands with status, and by " +
    `who it is assigned to with assignee. ${WORKSPACE_WORDS} Call it to find a task to read ` +
    `with ${MEMBER_MCP_TOOL.READ_TASK}, or to narrow ${MEMBER_MCP_TOOL.LIST_AGENTS} to one.`,
  input: ListTasksInputSchema,
  annotations: READ_ONLY,
  run: ({ workspace, ...asked }) => listAsMember(workspace, (call) => runListTasks(call, asked)),
});

const MEMBER_READ_TASK_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.READ_TASK,
  description:
    "Read one task the member can open, by its id, a teammate's included, in whichever of the " +
    "member's workspaces it stands: its key (such as ACME-42), name, where it stands (its " +
    "status) and how much it matters (its priority), repository, who started it, its mention, " +
    "the brief it was started with (null for none), the tasks it is blocked by and the tasks it " +
    "blocks (each with its id, name, status, and mention), and its plan as last saved, cut on a " +
    `line at ${PLAN_TEXT_READ_CHARS} characters with how many were left out. ` +
    `${MEMBER_MCP_TOOL.LIST_AGENTS} with its taskId names the agents on it.`,
  input: READ_TASK_TOOL.inputSchema,
  annotations: READ_ONLY,
  run: (asked) =>
    readAsMember(
      (userId) => readTaskWorkspace(userId, asked.taskId),
      READ_TASK_REFUSAL.NO_TASK,
      (call) => runReadTask(call, asked),
    ),
});

/** A list of agents narrows as the agents' own does, in the workspace named, bar to a task of the caller's own, since the member works on none. */
const ListAgentsInputSchema = Schema.Struct({
  workspace: WORKSPACE_INPUT,
  taskId: LIST_AGENTS_TOOL.inputSchema.fields.taskId,
  words: LIST_AGENTS_TOOL.inputSchema.fields.words,
  offset: LIST_AGENTS_TOOL.inputSchema.fields.offset,
});

const MEMBER_LIST_AGENTS_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.LIST_AGENTS,
  description:
    "List the coding agents of a workspace the member belongs to, on any task or none and " +
    "started by any member: each with its id, its title (how the member sees it named), the " +
    "model and effort it runs on with the model's name to say it by, its status " +
    `(${Object.values(AGENT_STATUS).join(", ")}) and why where it failed, its repository and the ` +
    "branch its sandbox is on if a turn has ended, one line of what it last did, its task (id " +
    "and name; null for an agent on no task), whether it is archived, and its mention, the " +
    "`[@title](link)` to name it by in your words; the newest started first, at most " +
    `${WORKSPACE_AGENTS_LIST_LIMIT} a page, with nextOffset where more stand, which offset ` +
    "reads the next page by. Pass words to search by words of an agent's title or its task's " +
    `name, or a taskId for one task's agents. ${WORKSPACE_WORDS} Failed covers a session that ` +
    "ended for good, which no message reaches again; an agent still running long after its " +
    "last activity may have lost its session.",
  input: ListAgentsInputSchema,
  annotations: READ_ONLY,
  run: ({ workspace, ...asked }) => listAsMember(workspace, (call) => runListAgents(call, asked)),
});

/** A read of one agent names it and, at most, how long a tail to read. */
const ReadAgentInputSchema = Schema.Struct({
  agentId: describeWire(
    wireUuidSchema,
    `The agent's id, as ${MEMBER_MCP_TOOL.LIST_AGENTS} answered it.`,
  ),
  entries: CODER_READ_AGENT_TOOL.inputSchema.fields.entries,
});

const MEMBER_READ_AGENT_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.READ_AGENT,
  description:
    "Read one coding agent the member can see, by its id, on any task and started by any " +
    "member, in whichever of the member's workspaces it stands: what " +
    `${MEMBER_MCP_TOOL.LIST_AGENTS} says of it, the branch it pushed and the pull request from ` +
    "it as GitHub holds them, its state and checks among it, and the tail of its transcript, " +
    "what it last said and which tools it called on what, newest last, each entry cut to " +
    `${AGENT_TOOL_BOUNDS.AGENT_ENTRY_CHARS} characters and with the messageId of the message ` +
    "it stands in. Read one to learn why an agent went quiet, what it is stuck on, or what it " +
    `did; ${MEMBER_MCP_TOOL.READ_AGENT_CHANGES} reads the files its pull request changes. It ` +
    "only reads: the agent is not told. Answers `accepted` with the reading, or `rejected` and why.",
  input: ReadAgentInputSchema,
  annotations: READ_ONLY,
  run: (asked) =>
    readAsMember(
      (userId) => agentWorkspace(userId, { id: asked.agentId }),
      AGENT_TOOL_REFUSAL.NO_AGENT,
      (call) => runReadAgent(call, asked),
    ),
});

const READ_AGENT_CHANGES_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.READ_AGENT_CHANGES,
  description:
    "Read what a coding agent the member can see published, by its id, as its Pull request and " +
    "Changes tabs show it: the repository it works in, the branch it pushed, and the pull " +
    "request from it as GitHub holds it now, with its number, title, link, state " +
    `(${Object.values(PULL_REQUEST_STATE).join(", ")}), its checks ` +
    `(${Object.values(CHECK_SUMMARY).join(", ")}), the lines it adds and removes, who opened it, ` +
    "its reviewers and where each stands, its reviews that said something, and every file it " +
    `changes in the order GitHub lists them, each with what became of it ` +
    `(${Object.values(CHANGED_FILE_STATUS).join(", ")}) and the lines it adds and removes, ` +
    "truncated true where the list was cut short; the pull request is null where the agent " +
    "opened none yet. Name a path among its files to read that file's patch as well, cut on a " +
    `line at ${READ_PAGE_CHARS} characters with how many were left out, or why GitHub carried ` +
    "none. It only reads: the agent is not told.",
  input: READ_AGENT_CHANGES_INPUT,
  annotations: READ_ONLY,
  run: (asked) =>
    readAsMember(
      (userId) => agentWorkspace(userId, { id: asked.agentId }),
      AGENT_TOOL_REFUSAL.NO_AGENT,
      (call) => runReadAgentChanges(call, asked),
    ),
});

const MEMBER_LIST_MODELS_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.LIST_MODELS,
  description:
    "List the models the member may start an agent on, as they are offered them: each with its " +
    "catalog id, the model's name to say it by, and the efforts it lists; and the member's " +
    "default model and effort, which a start naming neither runs on, and whether it is still " +
    "offered. The models are the member's own, the same in every workspace.",
  input: NoInputSchema,
  annotations: READ_ONLY,
  run: () => Effect.flatMap(AdmittedMember, (member) => runListMemberModels(member.userId)),
});

/** A read of a page names it by its id and, at most, the version to read. */
const ReadPageInputSchema = Schema.Struct({
  pageId: describeWire(wireUuidSchema, "The page's id, as a mention of it or a link to it names."),
  version: READ_PAGE_TOOL.inputSchema.fields.version,
});

const MEMBER_READ_PAGE_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.READ_PAGE,
  description:
    "Read a page an agent showed, by the page's id, on a task the member can open or on an " +
    "agent of theirs with no task, in whichever of the member's workspaces it stands: its " +
    "title, the version read (the newest unless you name one) and the newest there is, its " +
    "task, or, for a page an agent on no task showed on itself, that agent, its mention ready " +
    `to write, and its HTML as it stands, cut on a line at ${READ_PAGE_CHARS} characters with ` +
    "how many were left out.",
  input: ReadPageInputSchema,
  annotations: READ_ONLY,
  run: (asked) =>
    readAsMember(
      (userId) => pageWorkspace(userId, asked.pageId),
      READ_PAGE_REFUSAL.NO_PAGE,
      (call) => runReadPage(call, asked),
    ),
});

// The member's inbox (`inbox.ts`): the threads their agents ask them things on, read and worked as theirs.

/** A write's annotations: it adds the member's words to a thread and takes nothing away, and the same call twice writes twice. */
const ADDS: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
};

/** An answer's annotations: it settles an ask for good, and the same answer again finds it settled and writes nothing. */
const SETTLES: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
};

/** A close's annotations: it withdraws an ask unanswered, which nothing undoes, and the same close again finds it closed. */
const WITHDRAWS: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
};

/** How an answer or a message tells the agent what the thread's agent hears. */
const HANDED_WORDS =
  "It is written on the thread as the member's own and handed at once to the thread's agent, " +
  "which takes it up in its next turn, starting one where it was idle.";

/** A thread by its id, as the inbox read names it. */
const THREAD_ID = describeWire(
  wireUuidSchema,
  `The thread's id, as ${MEMBER_MCP_TOOL.READ_INBOX} answered it.`,
);

/** A read of the inbox names its workspace, as a list does. */
const ReadInboxInputSchema = Schema.Struct({ workspace: WORKSPACE_INPUT });

const READ_INBOX_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.READ_INBOX,
  description:
    "Read what waits on the member you act for in a workspace's inbox, where its coding agents " +
    "ask them things in threads: every thread they may read, whichever member's agent posted " +
    "it, those whose ask waits on the member first, then every other open ask, then the notices " +
    `still open, then the latest ${INBOX_BOUNDS.MAX_SETTLED_TOLD} settled, each the latest ` +
    "changed first. Each thread has its id, which the other inbox tools take, its title, where " +
    `it stands (${Object.values(INBOX_STATUS).join(", ")}) and its revision, the agent that ` +
    "posted it (agentId), who it waits on by name and whether that is the member " +
    "(waitsOnMember), whether it is unread for them, its mention, the `[@title](link)` to name " +
    "it by in your words, and its messages in order: who wrote each (agent, `you` for the " +
    "member, or another member by name), its words, its files by name, the ask it ends with " +
    "and where that stands, and the answer a member's message carries. An open ask reads " +
    `whole: a ${INBOX_ASK.DECIDE}'s options, those recommended, and whether several may be ` +
    `picked; a ${INBOX_ASK.DO}'s steps, which the member does by hand; or an ` +
    `${INBOX_ASK.ANSWER}'s fields, or none where words are the answer; and the thread's askId ` +
    `names the message it stands on, which ${MEMBER_MCP_TOOL.ANSWER_ASK} takes. A thread ` +
    `longer than ${INBOX_BOUNDS.MAX_MESSAGES_READ} messages reads its first, its open ask, and ` +
    "its latest; a settled one reads its latest messages and its latest ask and answer, with " +
    `how many earlier it leaves out. ${WORKSPACE_WORDS}`,
  input: ReadInboxInputSchema,
  annotations: READ_ONLY,
  run: ({ workspace }) =>
    Effect.gen(function* () {
      const member = yield* AdmittedMember;
      const listed = yield* listedWorkspace(member.userId, workspace);
      if (Result.isFailure(listed)) return agentToolRejected(listed.failure);
      return yield* readMemberInbox(member.userId, listed.success);
    }),
});

/** The answers an ask takes: a pick or words for a decide, done or not for a do, and fields or words for an answer. */
const ANSWER_REPLIES = [
  INBOX_REPLY.CHOSE,
  INBOX_REPLY.ANSWERED,
  INBOX_REPLY.SUBMITTED,
  INBOX_REPLY.DONE,
  INBOX_REPLY.NOT_DONE,
] as const;

/** An answer names its thread and the ask it answers, how the member answers, and what goes with it, as the window's answer carries them. */
const AnswerAskInputSchema = Schema.Struct({
  threadId: THREAD_ID,
  askId: describeWire(
    wireUuidSchema,
    `The id of the message whose ask you answer: the thread's askId, as ` +
      `${MEMBER_MCP_TOOL.READ_INBOX} answered it.`,
  ),
  reply: describeWire(
    Schema.Literals(ANSWER_REPLIES),
    `How the member answers: ${INBOX_REPLY.CHOSE}, with choices, for a ${INBOX_ASK.DECIDE}; ` +
      `${INBOX_REPLY.ANSWERED}, with their words in note, where no option of a ` +
      `${INBOX_ASK.DECIDE} fits or an ${INBOX_ASK.ANSWER} asks no fields; ` +
      `${INBOX_REPLY.SUBMITTED}, with values, for an ${INBOX_ASK.ANSWER}'s fields; and ` +
      `${INBOX_REPLY.DONE} or ${INBOX_REPLY.NOT_DONE} for a ${INBOX_ASK.DO}.`,
  ),
  choices: Schema.optionalKey(
    describeWire(
      inboxAnswersSchema.fields.choices.schema,
      `The labels of the options the member picks, for ${INBOX_REPLY.CHOSE}: one, or several ` +
        "where the ask lets several be picked.",
    ),
  ),
  values: Schema.optionalKey(
    describeWire(
      inboxAnswersSchema.fields.values.schema,
      `The fields the member fills, for ${INBOX_REPLY.SUBMITTED}: each by its field's label, ` +
        "with words, a number, one of a select's options, or true or false, as its type asks; " +
        "every required field filled.",
    ),
  ),
  steps: Schema.optionalKey(
    describeWire(
      inboxAnswersSchema.fields.steps.schema,
      `The steps of a ${INBOX_ASK.DO} the member did, by their places from 0: every one for ` +
        `${INBOX_REPLY.DONE}.`,
    ),
  ),
  note: Schema.optionalKey(
    describeWire(
      Schema.Trim.check(Schema.isMaxLength(INBOX_BOUNDS.MAX_MESSAGE_CHARS)),
      `The member's words with the answer, in Markdown: the answer itself for ` +
        `${INBOX_REPLY.ANSWERED}, and otherwise anything they add.`,
    ),
  ),
});

const ANSWER_ASK_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.ANSWER_ASK,
  description:
    "Answer the open ask of a thread in the member's inbox as the member, as they would in the " +
    `window. ${HANDED_WORDS} Name the thread and its askId as ` +
    `${MEMBER_MCP_TOOL.READ_INBOX} answered them, and the member's answer. A ` +
    `${INBOX_ASK.DO}'s steps are things the member does by hand, such as a setting on GitHub ` +
    `or a secret: answer ${INBOX_REPLY.DONE}, with every step's place, only once every step is ` +
    `really done, and ${INBOX_REPLY.NOT_DONE} where they could not or would not; never mark one ` +
    "done to clear it away. Answer only what the member decided or told you to, and ask them " +
    "where you do not know their answer. Answers `accepted` with the thread as it then stands, " +
    "or `rejected` and why nothing was written, such as an ask no longer open or an answer " +
    "that does not fit it.",
  input: AnswerAskInputSchema,
  annotations: SETTLES,
  run: ({ threadId, askId, reply, choices, values, steps, note }) =>
    Effect.flatMap(AdmittedMember, (member) =>
      answerAskAsMember(member.userId, {
        threadId,
        note: note ?? "",
        answers: {
          ask: askId,
          reply,
          ...(choices === undefined ? undefined : { choices }),
          ...(values === undefined ? undefined : { values }),
          ...(steps === undefined ? undefined : { steps }),
        },
      }),
    ),
});

/** A message names its thread and its words. */
const ReplyToThreadInputSchema = Schema.Struct({
  threadId: THREAD_ID,
  text: describeWire(
    Schema.Trim.check(Schema.isNonEmpty(), Schema.isMaxLength(INBOX_BOUNDS.MAX_MESSAGE_CHARS)),
    "The member's message, in Markdown, short and complete.",
  ),
});

const REPLY_TO_THREAD_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.REPLY_TO_THREAD,
  description:
    "Write a message on a thread in the member's inbox as the member, open or settled. " +
    `${HANDED_WORDS} It answers no ask, even one standing open: answer that with ` +
    `${MEMBER_MCP_TOOL.ANSWER_ASK}. Answers \`accepted\` with the thread as it then stands, ` +
    "or `rejected` and why nothing was written.",
  input: ReplyToThreadInputSchema,
  annotations: ADDS,
  run: (asked) => Effect.flatMap(AdmittedMember, (member) => replyAsMember(member.userId, asked)),
});

/** A close names its thread and the revision it was read at. */
const CloseThreadInputSchema = Schema.Struct({
  threadId: THREAD_ID,
  revision: describeWire(
    Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    `The thread's revision, as ${MEMBER_MCP_TOOL.READ_INBOX} answered it.`,
  ),
});

const CLOSE_THREAD_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.CLOSE_THREAD,
  description:
    "Close an open thread in the member's inbox without answering it, as the member, at the " +
    `revision ${MEMBER_MCP_TOOL.READ_INBOX} answered, so a thread its agent changed since is ` +
    "not closed unseen. An agent waiting on its answer is told at once that the member closed " +
    "it, which it takes as their not wanting what it asked; any other reads the close in its " +
    "own time. Close only what the member does not want. Answers `accepted` with the thread as " +
    "it then stands, or `rejected` and why it was not closed.",
  input: CloseThreadInputSchema,
  annotations: WITHDRAWS,
  run: (asked) =>
    Effect.flatMap(AdmittedMember, (member) => closeThreadAsMember(member.userId, asked)),
});

/** Every tool the server offers, listed in the order an agent reads them. */
export const MEMBER_MCP_TOOLS: readonly MemberMcpTool[] = [
  LIST_WORKSPACES_TOOL,
  MEMBER_LIST_TASKS_TOOL,
  MEMBER_READ_TASK_TOOL,
  MEMBER_LIST_AGENTS_TOOL,
  MEMBER_READ_AGENT_TOOL,
  READ_AGENT_CHANGES_TOOL,
  MEMBER_READ_PAGE_TOOL,
  MEMBER_LIST_MODELS_TOOL,
  READ_INBOX_TOOL,
  ANSWER_ASK_TOOL,
  REPLY_TO_THREAD_TOOL,
  CLOSE_THREAD_TOOL,
];
