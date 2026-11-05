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
 * A change to an agent's pull request, `agent_pull_request_action`, makes
 * what the agent's Pull request tab makes, through the operation the tab's
 * procedure runs (`../agents/agent-pull-request-procedures.ts`), on the
 * member's own GitHub sign-in as the tab does, never the App's.
 *
 * To add a tool, name it in `MEMBER_MCP_TOOL`, declare it with
 * `memberMcpTool`, and list it in `MEMBER_MCP_TOOLS`; its golden is settled
 * by `app.test.ts`, and `coverage.ts` refuses to build until it names the
 * hosted procedures that do what the tool does.
 */

import { randomUUID } from "node:crypto";
import type { ToolAnnotations } from "@modelcontextprotocol/server";
import type { DatabaseServices } from "@repo/database/core/query";
import { readAutomation } from "@repo/database/models/automation-store";
import {
  actOnPlanCommentThread,
  PLAN_COMMENT_OUTCOME,
  type PlanCommentOutcome,
  type PlanCommentWriterRef,
  readPlanCommentThread,
  startPlanCommentThread,
} from "@repo/database/models/plan-comments";
import { readPageById } from "@repo/database/models/plan-pages";
import { listTaskSections } from "@repo/database/models/task-section-store";
import { readTask, readTaskWorkspace } from "@repo/database/models/task-store";
import { listWorkspaces } from "@repo/database/models/workspace-store";
import { storeWriter } from "@repo/database/models/writer";
import { AGENT_TOOL } from "@repo/features/agent-tools";
import {
  AGENT_BOUNDS,
  AGENT_STATUS,
  CHANGED_FILE_STATUS,
  CHECK_SUMMARY,
  disabledServersSchema,
  PULL_REQUEST_STATE,
} from "@repo/features/agent-wire";
import { automationCreateRequestSchema } from "@repo/features/automation-wire";
import {
  githubPullRequestNumberSchema,
  githubRepositoryFullNameSchema,
} from "@repo/features/github-repositories-wire";
import {
  INBOX_ASK,
  INBOX_BOUNDS,
  INBOX_REPLY,
  INBOX_STATUS,
  inboxAnswersSchema,
} from "@repo/features/inbox-wire";
import { MEMORY_BOUNDS, memoryIdSchema } from "@repo/features/memory-wire";
import { agentName } from "@repo/features/model-label";
import { PAGE_OWNER } from "@repo/features/page-wire";
import {
  PLAN_COMMENT_ACTION,
  PLAN_COMMENT_ACTOR,
  PLAN_COMMENT_BOUNDS,
  PLAN_COMMENT_SCOPE,
  PLAN_COMMENT_STATUS,
  planCommentWordsSchema,
} from "@repo/features/plan-comment-wire";
import { locatedPhrase, planNotesSchema } from "@repo/features/plan-notes";
import { PRODUCT_NAME } from "@repo/features/product-name";
import {
  PULL_REQUEST_ACTION,
  PULL_REQUEST_WRITE_OUTCOME,
  type PullRequestWriteAnswer,
  pullRequestActionRequestSchema,
} from "@repo/features/pull-request-write-wire";
import { TASK_STATUS } from "@repo/features/task-wire";
import { WORKSPACE_BOUNDS, workspaceOfSlug } from "@repo/features/workspace-wire";
import { describeWire, type StandardSchemaWithJson, standardSchemaOf } from "@repo/wire/effect";
import { Effect, Option, Result, Schema } from "effect";
import type { HttpClient } from "effect/http";
import { forgetWorkspaceMemory, WORKSPACE_MEMORY } from "../accounts/workspace-memories.js";
import {
  READ_AGENT_CHANGES,
  READ_AGENT_CHANGES_INPUT,
  runReadAgentChanges,
} from "../agents/agent-changes-tool.js";
import { agentPullRequestAction } from "../agents/agent-pull-request-procedures.js";
import {
  ADDED_REPOSITORY_INPUT,
  AGENT_CALLER,
  AGENT_TOOL_BOUNDS,
  AGENT_TOOL_REFUSAL,
  type AgentCall,
  type AgentReadCall,
  agentToolRejected,
  CODER_READ_AGENT_TOOL,
  callerUserId,
  LIST_AGENTS_TOOL,
  LIST_TASKS_TOOL,
  orStoreRefusal,
  READ_PAGE_CHARS,
  READ_PAGE_REFUSAL,
  READ_PAGE_TOOL,
  runListAgents,
  runListMemberModels,
  runListTasks,
  runReadAgent,
  runReadPage,
  runStartAgent,
  runStopAgent,
  runUpdateAgent,
  runUpdateTask,
  START_AGENT_REFUSAL,
  START_AGENT_TOOL,
  TASKS_LIST_LIMIT,
  UPDATE_AGENT_TOOL,
  UPDATE_TASK_REFUSAL,
  UPDATE_TASK_TOOL,
  workspaceAgentOf,
} from "../agents/agent-tools.js";
import {
  AUTOMATION_TOOL_REFUSAL,
  CREATE_AUTOMATION_TOOL,
  DELETE_AUTOMATION_TOOL,
  RUN_AUTOMATION_TOOL,
  runCreateAutomation,
  runDeleteAutomation,
  runListAutomations,
  runRunAutomation,
  runUpdateAutomation,
  UPDATE_AUTOMATION_TOOL,
} from "../agents/automation-tools.js";
import { MESSAGE_AGENT_REFUSAL, messageRefusalWords } from "../agents/coder-host/agent-message.js";
import { PLAN_EDIT_REFUSAL, recordMemberPlanNotes } from "../agents/coder-host/plan-edit.js";
import { instancePublishedCache } from "../agents/coder-host/published.js";
import { productionSummaryModel } from "../agents/coder-host/replay-summary.js";
import { sessionsRouter } from "../agents/coder-host/runtime-sessions.js";
import { steerMemberWords } from "../agents/coder-host/steer.js";
import { CODER_TOOL_SET } from "../agents/coder-host/tool-set.js";
import {
  type MemoryCall,
  memoryOnFor,
  runRecall,
  runRemember,
  SAVE_MEMORY_TOOL,
  SEARCH_MEMORY_TOOL,
} from "../agents/memory-tools.js";
import {
  CREATE_SECTION_TOOL,
  DELETE_SECTION_TOOL,
  runCreateSection,
  runDeleteSection,
  TASK_SECTION_TOOL_REFUSAL,
} from "../agents/task-section-tools.js";
import {
  CREATE_TASK_TOOL,
  PLAN_TEXT_READ_CHARS,
  READ_TASK_REFUSAL,
  READ_TASK_TOOL,
  runCreateTask,
  runReadTask,
} from "../agents/task-tools.js";
import { WORKSPACE_AGENTS_LIST_LIMIT } from "../agents/workspace-agents.js";
import {
  ACTION_RESULT_STATUS,
  HOSTED_API_ERROR,
  type WireRecord,
  wireUuidSchema,
} from "../core.js";
import { HostedEnvironment } from "../environment.js";
import { recordServerEvent, SERVER_EVENT } from "../events/server-events.js";
import type { GitHubApp } from "../github/github-app.js";
import { agentWorkspace } from "../github/workspace-repository.js";
import type { HostedRefusal } from "../http/http-effect.js";
import type { StoreFailure } from "../http/store-failure.js";
import type { ModelCatalog } from "../providers/model-catalog.js";
import {
  COMMENT_TOOL_REFUSAL,
  commentAnswerRead,
  commentToolRejected,
  READ_COMMENTS_TOOL,
  REPLY_TO_COMMENT_TOOL,
  runCommentTool,
  UPDATE_COMMENT_TOOL,
} from "../tasks/comment-tools.js";
import { type MentioningComment, memberCommentAnswer } from "../tasks/plan-comments-procedures.js";
import type { SentryApp } from "../triggers/sentry/sentry-app-config.js";
import { AdmittedMember, type AdmittedMemberValues } from "./admission.js";
import {
  answerAskAsMember,
  closeThreadAsMember,
  MEMBER_INBOX_TOOL,
  readMemberInbox,
  replyAsMember,
} from "./inbox.js";

/** What a tool's effect runs against: the store, GitHub through the App, the model catalog, the deployment's environment a start's summary model reads, our Sentry integration an automation's trigger is checked against, and the member the call acts for. */
export type MemberMcpServices =
  | DatabaseServices
  | HttpClient.HttpClient
  | GitHubApp
  | ModelCatalog
  | HostedEnvironment
  | SentryApp
  | AdmittedMember;

/** A tool's input declaration: a wire schema the emitter can show and the reader can read. */
export type MemberMcpToolInput = Schema.Top & Schema.ConstraintDecoder<unknown>;

/** What a tool answers: a record the agent reads as JSON. */
export type MemberMcpToolResult = object;

export interface MemberMcpTool<Input extends MemberMcpToolInput = MemberMcpToolInput> {
  /** The name a model calls it by, one of `MEMBER_MCP_TOOL`'s, so every tool has its row in `coverage.ts`. */
  readonly name: MemberMcpToolName;
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
  CREATE_TASK: AGENT_TOOL.CREATE_TASK,
  UPDATE_TASK: AGENT_TOOL.UPDATE_TASK,
  EDIT_PLAN: AGENT_TOOL.EDIT_PLAN,
  CREATE_SECTION: AGENT_TOOL.CREATE_SECTION,
  DELETE_SECTION: AGENT_TOOL.DELETE_SECTION,
  START_AGENT: AGENT_TOOL.START_AGENT,
  MESSAGE_AGENT: AGENT_TOOL.MESSAGE_AGENT,
  STOP_AGENT: AGENT_TOOL.STOP_AGENT,
  UPDATE_AGENT: AGENT_TOOL.UPDATE_AGENT,
  READ_INBOX: MEMBER_INBOX_TOOL.READ,
  ANSWER_ASK: MEMBER_INBOX_TOOL.ANSWER,
  REPLY_TO_THREAD: MEMBER_INBOX_TOOL.REPLY,
  CLOSE_THREAD: MEMBER_INBOX_TOOL.CLOSE,
  AGENT_PULL_REQUEST_ACTION: "agent_pull_request_action",
  READ_COMMENTS: AGENT_TOOL.READ_COMMENTS,
  COMMENT_ON_PLAN: "comment_on_plan",
  REPLY_TO_COMMENT: AGENT_TOOL.REPLY_TO_COMMENT,
  UPDATE_COMMENT: AGENT_TOOL.UPDATE_COMMENT,
  SEARCH_MEMORY: AGENT_TOOL.SEARCH_MEMORY,
  SAVE_MEMORY: AGENT_TOOL.SAVE_MEMORY,
  FORGET_MEMORY: "forget_memory",
  LIST_AUTOMATIONS: AGENT_TOOL.LIST_AUTOMATIONS,
  CREATE_AUTOMATION: AGENT_TOOL.CREATE_AUTOMATION,
  UPDATE_AUTOMATION: AGENT_TOOL.UPDATE_AUTOMATION,
  RUN_AUTOMATION: AGENT_TOOL.RUN_AUTOMATION,
  DELETE_AUTOMATION: AGENT_TOOL.DELETE_AUTOMATION,
} as const;

export type MemberMcpToolName = (typeof MEMBER_MCP_TOOL)[keyof typeof MEMBER_MCP_TOOL];

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
const readAsMember = <R, RRead>(
  workspaceOf: (userId: string) => Effect.Effect<Option.Option<string>, StoreFailure, R>,
  refusal: string,
  read: (call: AgentReadCall) => Effect.Effect<WireRecord, never, RRead>,
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
    `(${Object.values(PULL_REQUEST_STATE).join(", ")}), the head commit it stands on (headSha), ` +
    `which a merge names, its checks ` +
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

/*
 * The writes. Each runs the agents' own door for it (`../agents/agent-tools.ts`,
 * `task-tools.ts`, `task-section-tools.ts`) with the member as the caller, on
 * a full call of the agent tools built once here (`memberWriteCall`), or,
 * where a member's act is not an agent's, the desktop's own operation for
 * it: a plan's notes are the member's own edit (`recordMemberPlanNotes`),
 * and a message is the member's own words (`steerMemberWords`), as their
 * message box sends them. A write is about the workspace that holds what it
 * names, as a read by id is, or the one its slug names, as a list is.
 */

/** A write that adds to the member's world and takes nothing away. */
const ADDITIVE: ToolAnnotations = { readOnlyHint: false, destructiveHint: false };

/** A change the same call made again leaves as it stood. */
const IDEMPOTENT_CHANGE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
};

/** A write that may take something away, such as a turn under way, an archived agent's place, or a section, which the same call made again leaves as it stood. */
const DESTRUCTIVE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
};

/** The writer the member's writes go through, over the coding agent's tool set, as the desktop's own writes are made. */
const MEMBER_WRITER = storeWriter({ tools: CODER_TOOL_SET });

/**
 * The member as the agent tools' writing caller, about the workspace a read
 * of it resolved: the sessions the deployment reaches acting for the member,
 * each agent's answered by the runtime its conversation runs on
 * (`sessionsRouter`), the writer over the coding agent's tool set, a key
 * minted fresh for this one call, so a start or a message the client sends
 * again is a second one, and the summary model a start from another agent
 * replays with, as the Start route's.
 */
const memberWriteCall = (read: AgentReadCall) =>
  Effect.gen(function* () {
    const eveAs = yield* sessionsRouter;
    const environment = yield* HostedEnvironment;
    const call: AgentCall = {
      ...read,
      eve: eveAs(callerUserId(read.caller)),
      eveAs,
      writer: MEMBER_WRITER,
      clientKey: randomUUID(),
      summaryModel: (owner, chosen, effort) =>
        productionSummaryModel(owner, chosen, effort).pipe(
          Effect.provideService(HostedEnvironment, environment),
        ),
    };
    return call;
  });

/** A write run as the member, about the workspace its slug names or their only one; refused, naming theirs, where that names none. */
const listWriteAsMember = <R>(
  slug: string | undefined,
  write: (call: AgentCall) => Effect.Effect<WireRecord, never, R>,
) => listAsMember(slug, (read) => Effect.flatMap(memberWriteCall(read), write));

/** A write by id run as the member, about the workspace that holds what it names as the member reaches it; refused in the door's own words where they reach none. */
const writeAsMember = <R, RWrite>(
  workspaceOf: (userId: string) => Effect.Effect<Option.Option<string>, StoreFailure, R>,
  refusal: string,
  write: (call: AgentCall) => Effect.Effect<WireRecord, never, RWrite>,
) => readAsMember(workspaceOf, refusal, (read) => Effect.flatMap(memberWriteCall(read), write));

/** The workspace of one of the member's sidebar sections, by its id. */
const sectionWorkspace = (userId: string, sectionId: string) =>
  Effect.map(listTaskSections(userId), ({ sections }) =>
    Option.map(
      Option.fromNullishOr(sections.find((section) => section.id === sectionId)),
      (section) => section.workspaceId,
    ),
  );

/** How a tool that sets an agent to work tells the outside agent to follow it, since nothing reports back to it. */
const FOLLOW_WORDS =
  "Nothing reports back to you, since an agent the member reaches from here has no starting " +
  `agent: follow it with ${MEMBER_MCP_TOOL.READ_AGENT}, which reads what it last said and did.`;

/** A task the member makes names the workspace it is made in, and what the agents' own make names, bar a pilot's mode, which only a pilot asks for. */
const CreateTaskInputSchema = Schema.Struct({
  workspace: WORKSPACE_INPUT,
  name: CREATE_TASK_TOOL.inputSchema.fields.name,
  repository: Schema.optionalKey(
    describeWire(
      Schema.NullOr(githubRepositoryFullNameSchema),
      "The GitHub repository its agents work in, as owner/name, which the workspace's GitHub " +
        "installation must reach; null or left out for none, or the parent's where you give a " +
        "parent.",
    ),
  ),
  brief: CREATE_TASK_TOOL.inputSchema.fields.brief,
  plan: CREATE_TASK_TOOL.inputSchema.fields.plan,
  status: CREATE_TASK_TOOL.inputSchema.fields.status,
  priority: CREATE_TASK_TOOL.inputSchema.fields.priority,
  assignee: CREATE_TASK_TOOL.inputSchema.fields.assignee,
  parentTaskId: CREATE_TASK_TOOL.inputSchema.fields.parentTaskId,
  relation: CREATE_TASK_TOOL.inputSchema.fields.relation,
});

const MEMBER_CREATE_TASK_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.CREATE_TASK,
  description:
    "Make a task in a workspace the member belongs to, as the member's own sidebar New task " +
    "would: owned by them, on the repository named or none, with their brief and a plan to " +
    "start from where given, and no agent on it; the desktop shows it as one they made. Give " +
    "it a status, a priority, and an assignee where the member said them. Give it a " +
    "parentTaskId to make it a child task of another, to any depth: a child always works in " +
    "its parent's repository, so leave repository out for one. Give it a " +
    "relation instead to make it blocked by, blocking, a sub-task of, or the parent of another " +
    `task of the workspace in the same call. ${WORKSPACE_WORDS} Then start an agent on it ` +
    `with ${MEMBER_MCP_TOOL.START_AGENT}'s taskId. Each call makes a task of its own, so call ` +
    "it once for each. Answers `accepted` with the task's id, key, name, status, priority, " +
    "assignee, repository, and mention, or `rejected` and why.",
  input: CreateTaskInputSchema,
  annotations: ADDITIVE,
  run: ({ workspace, ...asked }) =>
    listWriteAsMember(workspace, (call) => runCreateTask(call, asked)),
});

/** A task's change names what the agents' own does, the sidebar's words the member's own. */
const UpdateTaskInputSchema = Schema.Struct({
  ...UPDATE_TASK_TOOL.inputSchema.fields,
  pinned: Schema.optionalKey(
    describeWire(
      Schema.Boolean,
      "true to pin it in the member's sidebar, false to unpin it; their pin alone, no other " +
        "member's.",
    ),
  ),
  sectionId: Schema.optionalKey(
    describeWire(
      Schema.NullOr(wireUuidSchema),
      "The sidebar section the member keeps it in, by the id " +
        `${MEMBER_MCP_TOOL.LIST_TASKS} or ${MEMBER_MCP_TOOL.CREATE_SECTION} answered; it leaves ` +
        "the section it stood in and lands at the top of this one. null takes it out of its " +
        "section, back under Tasks.",
    ),
  ),
});

const MEMBER_UPDATE_TASK_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.UPDATE_TASK,
  description:
    "Change a task the member can open, by its id, a teammate's included, as the member's own " +
    "task menu would: rename it, set or clear its repository, set where it stands (its status) " +
    "or how much it matters (its priority), assign it to a member of its workspace or to no " +
    "one, pin or unpin it in the member's sidebar, move it into one of their sidebar sections " +
    "or back out of it (sectionId), put it under a parent task or take it out from under one, " +
    "or add and take away the tasks it is blocked by and the tasks it blocks; name at least " +
    "one change, and several go in one call. Mark a task whose work is done Done, with status " +
    "done, as the menu's Mark done does; that withdraws every ask still open on its threads. " +
    "A block is Linear's: the blocker's work comes first and the task it blocks waits on it. " +
    "Both tasks must be in one workspace, a task never blocks itself, and a block that would " +
    "close a cycle is refused. A child task works in its parent's repository, so a parent " +
    "working in another is refused, as is one under which the task would descend from " +
    "itself. Answers `accepted` with the task as it now stands, its parentTaskId, blockedBy, " +
    "and blocks among it where the call changed them, `already` true where every change " +
    "named already stood, or `rejected` and why.",
  input: UpdateTaskInputSchema,
  annotations: IDEMPOTENT_CHANGE,
  run: (asked) =>
    writeAsMember(
      (userId) => readTaskWorkspace(userId, asked.taskId),
      UPDATE_TASK_REFUSAL.NO_TASK,
      (call) => runUpdateTask(call, asked),
    ),
});

/** A plan's notes name the task and the notetaker's own notes. */
const EditPlanInputSchema = Schema.Struct({
  taskId: describeWire(
    wireUuidSchema,
    `The task whose plan to edit, by the id ${MEMBER_MCP_TOOL.LIST_TASKS} answered.`,
  ),
  ...planNotesSchema.fields,
});

const MEMBER_EDIT_PLAN_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.EDIT_PLAN,
  description:
    "Take notes on the plan of a task the member can open, by its taskId, as the member's own " +
    `edit, which ${MEMBER_MCP_TOOL.READ_TASK} reads first: add a point under one of its ` +
    "headings, or replace text copied exactly from the saved plan, as much as names one place, " +
    "headings and whole sections included, with what it becomes, or with nothing to delete " +
    "it. A note's text may open headings of its own, so you can rename, split, merge, move, and " +
    "drop sections. Write a file, a pull request, or an issue a note names as a mention, a " +
    "Markdown link to its page whose words start with @, such as " +
    "[@store.ts](https://github.com/<owner>/<name>/blob/HEAD/<path>), so the plan draws it as " +
    "a chip. Every save is kept in the plan's history as the member's own. A call's notes land " +
    "together or not at all: where one names text or a heading the plan does not hold exactly " +
    "once, nothing is saved and the call answers the plan as it stands, to retry from. Answers " +
    "`accepted` with how many notes it took, or `rejected` and why.",
  input: EditPlanInputSchema,
  annotations: { readOnlyHint: false, destructiveHint: false },
  run: (asked) =>
    readAsMember(
      (userId) => readTaskWorkspace(userId, asked.taskId),
      PLAN_EDIT_REFUSAL.NO_TASK,
      ({ caller }) =>
        recordMemberPlanNotes({ userId: callerUserId(caller), taskId: asked.taskId }, asked),
    ),
});

/** A section the member makes names the workspace it is made in, its title, and its emoji. */
const CreateSectionInputSchema = Schema.Struct({
  workspace: WORKSPACE_INPUT,
  ...CREATE_SECTION_TOOL.inputSchema.fields,
});

const MEMBER_CREATE_SECTION_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.CREATE_SECTION,
  description:
    "Make a section in the member's sidebar of a workspace they belong to, to keep tasks in: " +
    "it stands in their sidebar alone, as one they made from the sidebar would, with the " +
    `title and the emoji given, and holds no task until ${MEMBER_MCP_TOOL.UPDATE_TASK}'s ` +
    `sectionId moves one in. ${WORKSPACE_WORDS} Answers \`accepted\` with the section's ` +
    "id and title, or `rejected` and why.",
  input: CreateSectionInputSchema,
  annotations: ADDITIVE,
  run: ({ workspace, ...asked }) =>
    listWriteAsMember(workspace, (call) => runCreateSection(call, asked)),
});

const MEMBER_DELETE_SECTION_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.DELETE_SECTION,
  description:
    "Delete one of the member's sidebar sections, by its id as " +
    `${MEMBER_MCP_TOOL.LIST_TASKS} answered it, as their Delete section would: the tasks in it ` +
    "go back under Tasks, and none of them is deleted. Answers `accepted` with the section's " +
    "id and title and how many tasks went back under Tasks, or `rejected` and why.",
  input: DELETE_SECTION_TOOL.inputSchema,
  annotations: DESTRUCTIVE,
  run: (asked) =>
    writeAsMember(
      (userId) => sectionWorkspace(userId, asked.sectionId),
      TASK_SECTION_TOOL_REFUSAL.NO_SECTION,
      (call) => runDeleteSection(call, asked),
    ),
});

/** A start names the task or the agent it starts from, or else the workspace of the task made for it, and what the agents' own start names, bar pictures, since the member keeps no conversation here to hand them from. */
const StartAgentInputSchema = Schema.Struct({
  workspace: Schema.optionalKey(
    describeWire(
      Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(WORKSPACE_BOUNDS.MAX_SLUG_CHARS)),
      "Where you name no taskId and no from, the workspace of the task made for the agent, by " +
        `the slug ${MEMBER_MCP_TOOL.LIST_WORKSPACES} answered; leave it out where the member ` +
        "belongs to one workspace alone.",
    ),
  ),
  taskId: Schema.optionalKey(
    describeWire(
      wireUuidSchema,
      `The task to start the agent on, by the id ${MEMBER_MCP_TOOL.LIST_TASKS} answered; leave ` +
        "it out to start it on a new task made for it.",
    ),
  ),
  repository: Schema.optionalKey(
    describeWire(
      Schema.NullOr(githubRepositoryFullNameSchema),
      "Where you name no taskId and no from, the GitHub repository of the task made for the " +
        "agent, as owner/name, which the workspace's GitHub installation must reach; null or " +
        "left out for none. A task's agent works in the task's own.",
    ),
  ),
  prompt: START_AGENT_TOOL.inputSchema.fields.prompt,
  note: START_AGENT_TOOL.inputSchema.fields.note,
  title: START_AGENT_TOOL.inputSchema.fields.title,
  branch: START_AGENT_TOOL.inputSchema.fields.branch,
  model: START_AGENT_TOOL.inputSchema.fields.model,
  effort: START_AGENT_TOOL.inputSchema.fields.effort,
  runsOn: START_AGENT_TOOL.inputSchema.fields.runsOn,
  from: START_AGENT_TOOL.inputSchema.fields.from,
});

type StartAgentInput = typeof StartAgentInputSchema.Type;

/** The workspace a start is about: its task's, the agent's it starts from, or else the one its slug names or the member's only one. */
const startedAsMember = ({ workspace, ...asked }: StartAgentInput) => {
  const start = (call: AgentCall) => runStartAgent(call, asked);
  if (asked.taskId !== undefined) {
    const { taskId } = asked;
    return writeAsMember(
      (userId) => readTaskWorkspace(userId, taskId),
      START_AGENT_REFUSAL.NO_SUCH_TASK,
      start,
    );
  }
  if (asked.from !== undefined) {
    const { agentId } = asked.from;
    return writeAsMember(
      (userId) => agentWorkspace(userId, { id: agentId }),
      START_AGENT_REFUSAL.NO_SOURCE,
      start,
    );
  }
  return listWriteAsMember(workspace, start);
};

const MEMBER_START_AGENT_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.START_AGENT,
  description:
    "Start a new coding agent as the member, exactly as their own Start would: on a task " +
    "they can open by its taskId, on the task's plan itself with no prompt, or on the prompt " +
    "given in the plan's place, with the note after either; or on a new task made for it in " +
    "the workspace named, named as its agent is, assigned to the member, in the repository " +
    "named or none, and done by itself once its agents finish well, where it needs a prompt, " +
    "since that task has no plan to hand it. This one call carries everything the agent is told as it starts, and the " +
    "agent sets to work on it at once. Its checkout is the repository's default branch, or " +
    "the branch named, which must already be on GitHub. It runs on the model and effort " +
    "named, as the member is offered them, or on the member's default with neither; " +
    `${MEMBER_MCP_TOOL.LIST_MODELS} lists them. With from, it starts from another agent ` +
    "instead: continue an agent that failed, ended, or ran out of context, which is handed " +
    "over and stopped, or fork one at a messageId to try another direction while it goes on. " +
    "Each call starts an agent of its own, so call it once for each. Answers `accepted` with " +
    "the agent's id, model, the model's name to say it by, effort, status, and mention once " +
    "its session is open, which may take a minute or two, or `rejected` and why nothing was " +
    `started; a rejected model or effort lists the choices. ${FOLLOW_WORDS}`,
  input: StartAgentInputSchema,
  annotations: ADDITIVE,
  run: startedAsMember,
});

/** A stop names the agent alone. */
const AgentIdInputSchema = Schema.Struct({ agentId: ReadAgentInputSchema.fields.agentId });

/** A message names the agent and the member's words. */
const MessageAgentInputSchema = Schema.Struct({
  agentId: AgentIdInputSchema.fields.agentId,
  text: describeWire(
    Schema.Trim.check(Schema.isNonEmpty(), Schema.isMaxLength(AGENT_BOUNDS.MAX_MESSAGE_CHARS)),
    "What to tell the agent, as the member's own words: it reads them as a message the member " +
      "typed in its composer.",
  ),
});

type MessageAgentInput = typeof MessageAgentInputSchema.Type;

/**
 * One message as the member, to an agent of the workspace the call is about:
 * refused for an agent that is none of it or is archived, and otherwise the
 * member's own send, which refuses an agent it may not write to, in the words
 * the agents' own message is refused in.
 */
const memberMessage = (call: AgentCall, { agentId, text }: MessageAgentInput) =>
  orStoreRefusal(
    Effect.gen(function* () {
      const found = yield* workspaceAgentOf(call.caller, agentId);
      if (Option.isNone(found)) return agentToolRejected(MESSAGE_AGENT_REFUSAL.NO_AGENT);
      const { agent } = found.value;
      if (agent.archivedAt !== null) return agentToolRejected(MESSAGE_AGENT_REFUSAL.ARCHIVED);
      const userId = callerUserId(call.caller);
      const sent = yield* Effect.result(
        steerMemberWords(call.writer, userId, agent, { text, clientKey: call.clientKey }),
      );
      if (Result.isFailure(sent)) return agentToolRejected(messageRefusalWords(sent.failure));
      return {
        status: ACTION_RESULT_STATUS.ACCEPTED,
        delivery: sent.success.outcome,
        agent: { id: agent.id, title: agentName(agent), model: agent.model },
      };
    }),
  );

const MEMBER_MESSAGE_AGENT_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.MESSAGE_AGENT,
  description:
    "Send a coding agent the member can see a message, by its id, as the member's own words, " +
    "as their composer would: it lands in the agent's conversation under the member's name, " +
    "and a teammate's agent reads it under the member's label. A running agent reads it at " +
    "its next step, and an idle one starts a turn on it; an archived agent takes nothing. Each " +
    "call sends a message of its own, so call it once for each. Answers `accepted` once the " +
    "agent's session has taken it, without waiting for it to act or reply, or `rejected` and " +
    `why nothing was sent. ${FOLLOW_WORDS}`,
  input: MessageAgentInputSchema,
  annotations: ADDITIVE,
  run: (asked) =>
    writeAsMember(
      (userId) => agentWorkspace(userId, { id: asked.agentId }),
      MESSAGE_AGENT_REFUSAL.NO_AGENT,
      (call) => memberMessage(call, asked),
    ),
});

const MEMBER_STOP_AGENT_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.STOP_AGENT,
  description:
    "Stop a coding agent the member can see, by its id, as their Stop button would: its turn " +
    "under way is canceled and its status reads canceled, while the agent stays available, its " +
    "transcript and branch kept, and a later message starts a new turn. An archived one is " +
    "refused. Answers `accepted` with the agent's status now and whether it was stopped, " +
    "`stopped` false for an agent already idle, which changes nothing, or `rejected` and why. " +
    `${MEMBER_MCP_TOOL.READ_AGENT} reads where it stopped.`,
  input: AgentIdInputSchema,
  annotations: DESTRUCTIVE,
  run: (asked) =>
    writeAsMember(
      (userId) => agentWorkspace(userId, { id: asked.agentId }),
      AGENT_TOOL_REFUSAL.NO_AGENT,
      (call) => runStopAgent(call, asked),
    ),
});

/** A change to an agent names what the agents' own does, the sidebar's and the archive's words the member's own. */
const UpdateAgentInputSchema = Schema.Struct({
  ...UPDATE_AGENT_TOOL.inputSchema.fields,
  agentId: AgentIdInputSchema.fields.agentId,
  pinned: Schema.optionalKey(
    describeWire(
      Schema.Boolean,
      "Whether the member keeps it pinned in their sidebar, the pin theirs alone; an agent on " +
        "a task or on none alike.",
    ),
  ),
  archived: Schema.optionalKey(
    describeWire(
      Schema.Boolean,
      "true to archive it, as the member's Archive agent would: it leaves the sidebar, its " +
        "task's tabs, and every list but the archived ones, takes no message, and is not woken, " +
        "its transcript, branch, and pull request kept; only an idle agent is archived. false to " +
        "bring an archived one back.",
    ),
  ),
  reason: Schema.optionalKey(
    describeWire(
      Schema.Trim.check(
        Schema.isNonEmpty(),
        Schema.isMaxLength(AGENT_BOUNDS.MAX_ARCHIVE_REASON_CHARS),
      ),
      "Why it is archived, in a short sentence its archived banner shows beside the member's " +
        "name, such as its pull request having merged; only with archived true.",
    ),
  ),
  addRepository: Schema.optionalKey(
    describeWire(
      ADDED_REPOSITORY_INPUT,
      "A repository the agent works in beside its own from now on, added after the others and " +
        "checked out in a folder of its own, which its token then reaches and it is told of; " +
        "named alone, with no other change. Only for an agent the member started, in the cloud, " +
        "in a repository of its own, its repositories all reached through one GitHub App " +
        "installation, and the member with the Several repositories experiment on. Nothing " +
        "removes one.",
    ),
  ),
});

const MEMBER_UPDATE_AGENT_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.UPDATE_AGENT,
  description:
    "Change a coding agent the member can see, by its id, as the member's own menu, model " +
    "chip, and composer would: rename it (empty clears the title), move it to another model " +
    `and effort, and context window, from its next step, as ${MEMBER_MCP_TOOL.LIST_MODELS} ` +
    "lists them, pin or unpin it in the member's sidebar, replace the list of MCP servers " +
    "switched off for it, archive it or bring it back, the archive recorded as the " +
    "member's own, or add a repository it works in beside its own, alone. Name at least one " +
    "change, a model only with its effort, a contextWindow only with them, and a reason only " +
    "with archived true; an archive is checked first, and " +
    "the rest land together or not at all. One still starting or working is not archived: " +
    `stop it with ${MEMBER_MCP_TOOL.STOP_AGENT} first. Answers \`accepted\` with the agent ` +
    "as it then stands, whether archived among it, or `rejected` and why; a rejected model " +
    "or effort lists the choices.",
  input: UpdateAgentInputSchema,
  annotations: DESTRUCTIVE,
  run: (asked) =>
    writeAsMember(
      (userId) => agentWorkspace(userId, { id: asked.agentId }),
      AGENT_TOOL_REFUSAL.NO_AGENT,
      (call) => runUpdateAgent(call, asked),
    ),
});

// The member's inbox (`inbox.ts`): the threads their agents ask them things on, read and worked as theirs.

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
  annotations: IDEMPOTENT_CHANGE,
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
  annotations: ADDITIVE,
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
  annotations: DESTRUCTIVE,
  run: (asked) =>
    Effect.flatMap(AdmittedMember, (member) => closeThreadAsMember(member.userId, asked)),
});

/**
 * The kept published answers of this function's instance, made on its first
 * change: the server is a function of its own, so a change lets go of what
 * this instance and the agent's row kept, and the hosted router's instances
 * let go of theirs within `CODER.PUBLISHED_TTL`, as after a change made on
 * any other instance (`asked-pull-request.ts`'s `forgetPublished`).
 */
const KEPT_PUBLISHED = instancePublishedCache();

/** Why a change was not made, in words the agent can act on: the desktop's own where its tab says one. */
const AGENT_PULL_REQUEST_ACTION_REFUSAL = {
  SIGN_IN:
    "Not made: sign in with GitHub to make this change as the member. They hold no GitHub " +
    `sign-in GitHub takes, which signing in with GitHub again in ${PRODUCT_NAME} mends.`,
  REFUSED: (words: string) => `Not made: GitHub refused this change, saying: ${words}`,
  NO_PULL_REQUEST:
    "Not made: that agent has opened no pull request yet, or its repository holds none of " +
    "that number.",
  NOT_REACHABLE:
    "Not made: the GitHub installation connected to the workspace no longer reaches that " +
    "agent's repository.",
  UNANSWERED: "Not made: GitHub could not be reached just now. The call may be made again.",
} as const;

/** A change names the agent, at most another pull request of its repository, and the change as the agent's Pull request tab asks for it. */
const AgentPullRequestActionInputSchema = Schema.Struct({
  agentId: describeWire(
    wireUuidSchema,
    `The agent's id, as ${MEMBER_MCP_TOOL.LIST_AGENTS} answered it.`,
  ),
  number: Schema.optionalKey(
    describeWire(
      githubPullRequestNumberSchema,
      "Another pull request of the agent's repository, by its number, such as one stacked on " +
        "its own; leave it out for the agent's own pull request.",
    ),
  ),
  change: describeWire(
    pullRequestActionRequestSchema,
    "The change, named by its action, with the fields that action takes.",
  ),
});

/** How GitHub took the change, as the agent reads it: accepted where GitHub made it, else the refusal the desktop shows, as the tool's error. */
function actionAnswerOf(answer: PullRequestWriteAnswer): WireRecord {
  switch (answer.outcome) {
    case PULL_REQUEST_WRITE_OUTCOME.DONE:
      return { status: ACTION_RESULT_STATUS.ACCEPTED };
    case PULL_REQUEST_WRITE_OUTCOME.SIGN_IN_REQUIRED:
      return agentToolRejected(AGENT_PULL_REQUEST_ACTION_REFUSAL.SIGN_IN);
    case PULL_REQUEST_WRITE_OUTCOME.REFUSED:
      return agentToolRejected(AGENT_PULL_REQUEST_ACTION_REFUSAL.REFUSED(answer.words));
  }
}

/** A change that never reached GitHub, in the agent's words: no pull request, a repository out of reach, or GitHub or the store not answering. */
function unmadeWords(refusal: HostedRefusal): string {
  switch (refusal.error) {
    case HOSTED_API_ERROR.NOT_FOUND:
      return AGENT_PULL_REQUEST_ACTION_REFUSAL.NO_PULL_REQUEST;
    case HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE:
      return AGENT_PULL_REQUEST_ACTION_REFUSAL.NOT_REACHABLE;
    default:
      return AGENT_PULL_REQUEST_ACTION_REFUSAL.UNANSWERED;
  }
}

/**
 * `agent_pull_request_action`: the change the agent's Pull request tab
 * makes, through the operation its procedure runs
 * (`agentPullRequestAction`), on the member's own GitHub sign-in, the
 * agent's kept published answers let go after it. A merge is one of its
 * changes and cannot be taken back, so the tool says it may destroy.
 */
const AGENT_PULL_REQUEST_ACTION_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.AGENT_PULL_REQUEST_ACTION,
  description:
    "Make one change to the pull request of a coding agent the member can see, by the agent's " +
    "id, in whichever of the member's workspaces it stands, as the agent's Pull request tab " +
    "makes it: on GitHub as the member, on their own GitHub sign-in, so GitHub allows what " +
    "their own account may and nothing more. Name the change by its action " +
    `(${Object.values(PULL_REQUEST_ACTION).join(", ")}) with the fields that action takes. A ` +
    "merge and turning auto-merge on name the head commit you saw, as headSha, which " +
    `${MEMBER_MCP_TOOL.READ_AGENT_CHANGES} answers, so GitHub refuses one against a head pushed ` +
    "since; an edit of the description names the words it began from, as expectedBody, and " +
    "writes nothing where GitHub's changed since; a review thread, a comment, and what a " +
    "reaction is on are named by GitHub's own node ids. The change is made on the agent's own " +
    "pull request unless number names another of its repository. Answers `accepted` once " +
    "GitHub made it, or `rejected` and why not: GitHub's own words where it refused, or that " +
    "the member must sign in with GitHub again.",
  input: AgentPullRequestActionInputSchema,
  annotations: { readOnlyHint: false, destructiveHint: true },
  run: ({ agentId, number, change }) =>
    readAsMember(
      (userId) => agentWorkspace(userId, { id: agentId }),
      AGENT_TOOL_REFUSAL.NO_AGENT,
      (call) =>
        orStoreRefusal(
          Effect.gen(function* () {
            const found = yield* workspaceAgentOf(call.caller, agentId);
            if (Option.isNone(found)) return agentToolRejected(AGENT_TOOL_REFUSAL.NO_AGENT);
            return yield* agentPullRequestAction(
              KEPT_PUBLISHED,
              callerUserId(call.caller),
              found.value.agent,
              number,
              change,
            ).pipe(
              Effect.map(actionAnswerOf),
              Effect.catch((refusal) => Effect.succeed(agentToolRejected(unmadeWords(refusal)))),
            );
          }),
        ),
    ),
});

/*
 * The comments and the memory. A plan's comment threads, and its task's
 * pages', are read, answered, resolved, and reopened as the member, on a task
 * they can open, as their window's own threads are: a read and a settle run
 * the agents' own door (`../tasks/comment-tools.ts`), written under the
 * member rather than an agent, and a comment, a reply or a thread started on
 * the plan's words, is answered as the desktop answers one
 * (`memberCommentAnswer`), so it hands its thread to the agents in it, and to
 * each one its words mention, as one typed in the window does. The
 * workspace's shared memory is searched, kept, and forgotten as the member,
 * in the workspace a slug names or their only one, only while they have
 * Memory on (`memoryOnFor`), as Settings › Memory stands only then, and is
 * held to what the desktop holds the member to: the workspace's bound of
 * memories, and a forget of another member's words only for one who owns or
 * administers the workspace.
 */

/** Why a comment or a memory call took nothing, in words for one acting for the member. */
const MEMBER_NOTE_REFUSAL = {
  NO_WORDS:
    "Not posted: the plan does not hold those words exactly once; copy them, or more of them, " +
    `from the plan as ${MEMBER_MCP_TOOL.READ_TASK} reads it.`,
  MEMORY_OFF:
    "Not run: the member you act for has Memory off; they turn it on in Settings › " +
    "Experimental. Carry on without it.",
  NOT_MEMBER: "Not forgotten: the member no longer belongs to that workspace.",
  NOT_FORGETTABLE:
    "Not forgotten: the member may forget a memory in their own words alone, unless they own " +
    "or administer the workspace.",
} as const;

/** Who writes a member's comment: the member, never an agent. */
type MemberCommentWriter = Extract<
  PlanCommentWriterRef,
  { readonly actor: typeof PLAN_COMMENT_ACTOR.MEMBER }
>;

/** A comment call run as the member, on the task it names as the member reaches it; refused where they reach none. */
const commentAsMember = <R>(
  taskId: string,
  act: (writer: MemberCommentWriter) => Effect.Effect<WireRecord, never, R>,
) =>
  readAsMember(
    (userId) => readTaskWorkspace(userId, taskId),
    COMMENT_TOOL_REFUSAL.NO_TASK,
    ({ caller }) => act({ actor: PLAN_COMMENT_ACTOR.MEMBER, userId: callerUserId(caller) }),
  );

/** A member's comment as the store came to it, answered as the window's own is, its thread handed to the agents it reaches; a task or thread not reached refused. */
const memberCommented = (outcome: PlanCommentOutcome, comment: MentioningComment) => {
  if (outcome.status === PLAN_COMMENT_OUTCOME.DONE) {
    return Effect.map(memberCommentAnswer(outcome, comment), commentAnswerRead);
  }
  return Effect.succeed(
    commentToolRejected(
      outcome.status === PLAN_COMMENT_OUTCOME.NO_TASK
        ? COMMENT_TOOL_REFUSAL.NO_TASK
        : COMMENT_TOOL_REFUSAL.NO_THREAD,
    ),
  );
};

/** The task a comment tool acts on, by its id. */
const COMMENTED_TASK_INPUT = describeWire(
  wireUuidSchema,
  `The task whose plan's comments to act on, by the id ${MEMBER_MCP_TOOL.LIST_TASKS} answered.`,
);

/** A comment's words, as the member's own. */
const COMMENT_WORDS_INPUT = describeWire(
  planCommentWordsSchema,
  "The comment, in plain words, as the member's own: every member of the workspace reads it " +
    "under the member's name.",
);

/** A read of comments names the task, and the page to read in the plan's place, and which threads. */
const ReadCommentsInputSchema = Schema.Struct({
  taskId: COMMENTED_TASK_INPUT,
  page: Schema.optionalKey(
    describeWire(
      wireUuidSchema,
      "One of the task's pages, by the id a mention of it or a link to it names, to read its " +
        "threads instead of the plan's.",
    ),
  ),
  status: READ_COMMENTS_TOOL.inputSchema.fields.status,
});

const MEMBER_READ_COMMENTS_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.READ_COMMENTS,
  description:
    "Read the comment threads on the plan of a task the member can open, by its taskId, a " +
    "teammate's included, in whichever of the member's workspaces it stands, or on one of its " +
    "pages where you name the page: each thread's id, the words of the plan it is on and their " +
    "section, whether those words were since deleted, every comment with who wrote it, when, " +
    "and the names of the files it carries, and the agents it was sent to. A page's thread " +
    "names the version it was left on and the element it is on, by its words and its path, or " +
    "none for the whole page. Open threads unless you ask for resolved ones. It only reads: " +
    "nobody is told.",
  input: ReadCommentsInputSchema,
  annotations: READ_ONLY,
  run: (asked) =>
    commentAsMember(asked.taskId, (writer) =>
      runCommentTool(READ_COMMENTS_TOOL.name, { taskId: asked.taskId, writer }, asked),
    ),
});

/** A thread started on the plan names the task, the words it stands on, and its first comment. */
const CommentOnPlanInputSchema = Schema.Struct({
  taskId: COMMENTED_TASK_INPUT,
  quote: describeWire(
    Schema.String.check(
      Schema.isNonEmpty(),
      Schema.isMaxLength(PLAN_COMMENT_BOUNDS.MAX_QUOTE_CHARS),
    ),
    "The words of the plan the thread stands on, copied exactly from the plan as " +
      `${MEMBER_MCP_TOOL.READ_TASK} reads it, as much as stands there exactly once.`,
  ),
  words: COMMENT_WORDS_INPUT,
});

type CommentOnPlanInput = typeof CommentOnPlanInputSchema.Type;

/**
 * A thread started on the words of the plan as saved, the one place they
 * stand there, found as a note's replacement finds its words, with the
 * member's first comment, handed to the agents its words mention.
 */
const memberPlanComment = (writer: MemberCommentWriter, asked: CommentOnPlanInput) =>
  orStoreRefusal(
    Effect.gen(function* () {
      const task = yield* readTask(writer.userId, asked.taskId);
      if (Option.isNone(task)) return commentToolRejected(COMMENT_TOOL_REFUSAL.NO_TASK);
      const { text } = task.value;
      const anchor = locatedPhrase(text, asked.quote);
      if (anchor === undefined) return commentToolRejected(MEMBER_NOTE_REFUSAL.NO_WORDS);
      const clientKey = randomUUID();
      const outcome = yield* startPlanCommentThread(writer, asked.taskId, {
        clientKey,
        scope: PLAN_COMMENT_SCOPE.WORDS,
        quote: text.slice(anchor.from, anchor.to),
        anchor,
        text,
        words: asked.words,
      });
      return yield* memberCommented(outcome, {
        userId: writer.userId,
        taskId: asked.taskId,
        words: asked.words,
        clientKey,
        isReply: false,
      });
    }),
  );

/** How a comment tool tells the outside agent whom a comment reaches. */
const MENTION_WORDS =
  "Each agent of the task the words mention by its mention link, the `[@title](link)` " +
  `${MEMBER_MCP_TOOL.LIST_AGENTS} answers, joins the thread and is sent it, as a mention typed ` +
  "in the window does.";

const MEMBER_COMMENT_ON_PLAN_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.COMMENT_ON_PLAN,
  description:
    "Start a comment thread on words of the plan of a task the member can open, by its taskId, " +
    "as the member's own comment in the plan's margin: name the words by copying them from " +
    `the plan as ${MEMBER_MCP_TOOL.READ_TASK} reads it, as much as stands there exactly once, ` +
    "and give the first comment. Every member of the workspace sees it beside those words. " +
    `${MENTION_WORDS} Each call starts a thread of its own, so call it once for each. Answers ` +
    "`accepted` with the thread as it stands, or `rejected` and why nothing was posted.",
  input: CommentOnPlanInputSchema,
  annotations: ADDITIVE,
  run: (asked) => commentAsMember(asked.taskId, (writer) => memberPlanComment(writer, asked)),
});

/** A reply names the task, the thread, and the member's words. */
const ReplyToCommentInputSchema = Schema.Struct({
  taskId: COMMENTED_TASK_INPUT,
  thread: REPLY_TO_COMMENT_TOOL.inputSchema.fields.thread,
  words: COMMENT_WORDS_INPUT,
});

type ReplyToCommentInput = typeof ReplyToCommentInputSchema.Type;

/**
 * A reply in the thread as the member's own words, refused on a resolved
 * thread, which the window offers no reply on, and handed to every agent in
 * the thread and each one its words mention.
 */
const memberReply = (writer: MemberCommentWriter, asked: ReplyToCommentInput) =>
  orStoreRefusal(
    Effect.gen(function* () {
      const standing = yield* readPlanCommentThread(writer.userId, asked.taskId, asked.thread);
      if (Option.getOrUndefined(standing)?.status === PLAN_COMMENT_STATUS.RESOLVED) {
        return commentToolRejected(COMMENT_TOOL_REFUSAL.RESOLVED);
      }
      const clientKey = randomUUID();
      const outcome = yield* actOnPlanCommentThread(writer, asked.taskId, asked.thread, {
        action: PLAN_COMMENT_ACTION.REPLY,
        clientKey,
        words: asked.words,
      });
      return yield* memberCommented(outcome, {
        userId: writer.userId,
        taskId: asked.taskId,
        words: asked.words,
        clientKey,
        isReply: true,
      });
    }),
  );

const MEMBER_REPLY_TO_COMMENT_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.REPLY_TO_COMMENT,
  description:
    "Reply in one comment thread on the plan of a task the member can open, or on one of its " +
    "pages, by the thread's id, as the member's own reply in the window would: every member " +
    "of the workspace sees it, and the thread is sent to every agent in it, each one sent it " +
    "before or that answered in it, and, on a page, the agent that showed the page; each reads " +
    `it as a message from the member and answers in the thread. ${MENTION_WORDS} A resolved ` +
    `thread takes no reply until ${MEMBER_MCP_TOOL.UPDATE_COMMENT} reopens it. Each call posts ` +
    "a reply of its own, so call it once for each. Answers `accepted` with the thread as it " +
    "now stands and, in unsent, the agents in it it could not reach, an archived one say, the " +
    "reply posted all the same; or `rejected` and why nothing was posted.",
  input: ReplyToCommentInputSchema,
  annotations: ADDITIVE,
  run: (asked) => commentAsMember(asked.taskId, (writer) => memberReply(writer, asked)),
});

/** A thread settled or brought back names the task, the thread, and which. */
const UpdateCommentInputSchema = Schema.Struct({
  taskId: COMMENTED_TASK_INPUT,
  thread: UPDATE_COMMENT_TOOL.inputSchema.fields.thread,
  resolved: UPDATE_COMMENT_TOOL.inputSchema.fields.resolved,
});

const MEMBER_UPDATE_COMMENT_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.UPDATE_COMMENT,
  description:
    "Resolve or reopen one comment thread on the plan of a task the member can open, or on one " +
    "of its pages, by the thread's id, as the member's own Resolve or Reopen would: a resolved " +
    "thread leaves the plan's margin and stays in its history, under the member's name. " +
    "Answers `accepted` with the thread as it now stands, or `rejected` and why.",
  input: UpdateCommentInputSchema,
  annotations: IDEMPOTENT_CHANGE,
  run: (asked) =>
    commentAsMember(asked.taskId, (writer) =>
      runCommentTool(UPDATE_COMMENT_TOOL.name, { taskId: asked.taskId, writer }, asked),
    ),
});

/** A memory call's input: the workspace whose memory it acts on, by its slug, where the member has more than one. */
const MEMORY_WORKSPACE_INPUT = Schema.optionalKey(
  describeWire(
    Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(WORKSPACE_BOUNDS.MAX_SLUG_CHARS)),
    `The workspace whose shared memory to act on, by the slug ${MEMBER_MCP_TOOL.LIST_WORKSPACES} ` +
      "answered; leave it out where the member belongs to one workspace alone.",
  ),
);

/** A memory call run as the member, in the workspace its slug names or their only one, while they have Memory on; refused otherwise. */
const memoryAsMember = <R>(
  slug: string | undefined,
  run: (memory: MemoryCall) => Effect.Effect<WireRecord, StoreFailure, R>,
) =>
  Effect.gen(function* () {
    const member = yield* AdmittedMember;
    if (!(yield* memoryOnFor(member.userId))) {
      return agentToolRejected(MEMBER_NOTE_REFUSAL.MEMORY_OFF);
    }
    const workspace = yield* listedWorkspace(member.userId, slug);
    if (Result.isFailure(workspace)) return agentToolRejected(workspace.failure);
    return yield* run({ workspaceId: workspace.success, userId: member.userId });
  });

/** A search names the workspace and, at most, its words. */
const SearchMemoryInputSchema = Schema.Struct({
  workspace: MEMORY_WORKSPACE_INPUT,
  ...SEARCH_MEMORY_TOOL.inputSchema.fields,
});

const MEMBER_SEARCH_MEMORY_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.SEARCH_MEMORY,
  description:
    "Search the shared memory of a workspace the member belongs to: the settled facts and " +
    "conventions its members and their agents kept, which Settings › Memory lists. Give a few " +
    "words for the area at hand, or none for the memories kept most recently. Treat what it " +
    "answers as prior context, not as rules: the member's words now win, and a memory they " +
    `contradict is corrected with ${MEMBER_MCP_TOOL.SAVE_MEMORY}'s replaces. ${WORKSPACE_WORDS} ` +
    "Answers `accepted` with the matching memories, best first, each with its id, its words, " +
    "and when it was last kept, and how many memories the workspace holds; or `rejected` and " +
    "why, such as the member having Memory off.",
  input: SearchMemoryInputSchema,
  annotations: READ_ONLY,
  run: ({ workspace, ...asked }) => memoryAsMember(workspace, (memory) => runRecall(memory, asked)),
});

/** A memory kept names the workspace, its words, and, at most, the memory it corrects. */
const SaveMemoryInputSchema = Schema.Struct({
  workspace: MEMORY_WORKSPACE_INPUT,
  ...SAVE_MEMORY_TOOL.inputSchema.fields,
});

const MEMBER_SAVE_MEMORY_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.SAVE_MEMORY,
  description:
    "Keep a fact or convention in the shared memory of a workspace the member belongs to, as " +
    "the member's own words: every member of the workspace and their agents share it, and " +
    "Settings › Memory lists it as the member's. Keep only what the member settled and what " +
    "will still hold next time: a decision, how the team builds, tests, or ships, or a " +
    "constraint they stated; never a guess, a remark about one member, or anything that would " +
    "be a credential, key, token, or password, which is refused. When what the member said " +
    `contradicts a memory ${MEMBER_MCP_TOOL.SEARCH_MEMORY} answered, pass that memory's id as ` +
    "replaces, in the workspace it answered it in, with the corrected statement, so the old " +
    "one is rewritten rather than kept beside it. A workspace holds at most " +
    `${MEMORY_BOUNDS.MAX_MEMORIES} memories. ${WORKSPACE_WORDS} Answers \`accepted\` with the ` +
    "outcome (kept, already_kept, corrected) and the memory, or `rejected` and why.",
  input: SaveMemoryInputSchema,
  annotations: IDEMPOTENT_CHANGE,
  run: ({ workspace, ...asked }) =>
    memoryAsMember(workspace, (memory) => runRemember(memory, asked)),
});

/** A forget names the workspace and the memory. */
const ForgetMemoryInputSchema = Schema.Struct({
  workspace: MEMORY_WORKSPACE_INPUT,
  memoryId: describeWire(
    memoryIdSchema,
    `The memory to forget, by the id ${MEMBER_MCP_TOOL.SEARCH_MEMORY} answered it.`,
  ),
});

/**
 * One of the workspace's memories forgotten as the member, as their Forget
 * in Settings › Memory does: refused where its words are another member's
 * and the member does not manage the workspace, and counted as theirs.
 */
const memberForget = (memory: MemoryCall, memoryId: string) =>
  Effect.gen(function* () {
    const { userId, workspaceId } = memory;
    const answer = yield* forgetWorkspaceMemory(userId, workspaceId, memoryId);
    switch (answer.kind) {
      case WORKSPACE_MEMORY.NOT_MEMBER:
        return agentToolRejected(MEMBER_NOTE_REFUSAL.NOT_MEMBER);
      case WORKSPACE_MEMORY.NOT_PERMITTED:
        return agentToolRejected(MEMBER_NOTE_REFUSAL.NOT_FORGETTABLE);
      case WORKSPACE_MEMORY.READ:
        yield* recordServerEvent(SERVER_EVENT.MEMORY_FORGET, { userId, workspaceId }, {});
        return {
          status: ACTION_RESULT_STATUS.ACCEPTED,
          forgotten: memoryId,
          total: answer.memories.length,
        };
    }
  });

const MEMBER_FORGET_MEMORY_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.FORGET_MEMORY,
  description:
    "Forget one memory of a workspace the member belongs to, by its id, as their Forget in " +
    "Settings › Memory would: it is deleted for good, and no later search finds it. The member " +
    "may forget a memory in their own words, and one in any member's where they own or " +
    `administer the workspace. ${WORKSPACE_WORDS} Answers \`accepted\` with the memory's id and ` +
    "how many memories the workspace then holds, a memory already gone among it, or " +
    "`rejected` and why.",
  input: ForgetMemoryInputSchema,
  annotations: DESTRUCTIVE,
  run: ({ workspace, memoryId }) =>
    memoryAsMember(workspace, (memory) => memberForget(memory, memoryId)),
});

/*
 * The automations. Each runs the agents' own door for it
 * (`../agents/automation-tools.ts`) with the member as the caller, on the
 * member's write call: an automation is made in the workspace its slug
 * names, in the repositories named or none, since the member works in none,
 * as the member's own, and one named by its id is about the workspace that
 * holds it, as the member reads it. A webhook trigger is never made or set
 * here, so no answer carries a webhook secret: its secret is shown once, in
 * the window that minted it (`AGENTS.md`).
 */

/** The workspace of an automation the member may read, by its id. */
const automationWorkspace = (userId: string, automationId: string) =>
  Effect.map(
    readAutomation(userId, automationId),
    Option.map((automation) => automation.organizationId),
  );

/** How an automation tool tells the agent the trigger it never makes. */
const WEBHOOK_WORDS =
  `A webhook trigger is made only on the automations page in ${PRODUCT_NAME}, which shows ` +
  "its secret once, so no answer here carries one.";

/** The fields whose agents' words name the coding agent's own world, in the member's: no repository is theirs by default, and their connections are named by what they connect. */
const MEMBER_AUTOMATION_FIELDS = {
  repositories: Schema.optionalKey(
    describeWire(
      automationCreateRequestSchema.fields.repositories.schema,
      "owner/name, reached by the workspace's GitHub installation; runs start in the first. [] " +
        "for none, which a GitHub trigger cannot take. Create defaults to none.",
    ),
  ),
  disabledServers: Schema.optionalKey(
    describeWire(
      disabledServersSchema,
      "The member's connections each run's agent is not handed, by what they connect, such as " +
        "neon, sentry, or notion-2 for a second Notion account; the whole list.",
    ),
  ),
  slackDelivery: Schema.optionalKey(
    describeWire(
      Schema.Boolean,
      `Send each run's result to the member on Slack from ${PRODUCT_NAME}'s bot, so the run's ` +
        "agent needs no Slack of its own; the workspace must have the bot connected.",
    ),
  ),
};

/** A list of automations names the workspace it lists, or one automation to read whole. */
const ListAutomationsInputSchema = Schema.Struct({
  workspace: WORKSPACE_INPUT,
  automationId: Schema.optionalKey(
    describeWire(
      wireUuidSchema,
      "One automation to read whole, its prompt in full and its newest runs, by the id this " +
        "tool answered; leave it out to list them all.",
    ),
  ),
});

const MEMBER_LIST_AUTOMATIONS_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.LIST_AUTOMATIONS,
  description:
    "List the automations of a workspace the member belongs to that the member may read, " +
    "newest first: each with its id, name, whether it is on, its trigger, the start of its " +
    "prompt, the model and effort its runs take, its repositories, where its runs land, its " +
    "guards, scope, when it is next due, its newest run, and whether the member made it " +
    "(madeByYourDeveloper). Name an automationId to read that one whole, in whichever of the " +
    "member's workspaces it stands, its prompt in full and its newest runs, each with why it " +
    "was skipped or failed and the agent it started. An automation fires on a schedule, a " +
    "GitHub event, a webhook, or a Sentry event, and starts an agent on its prompt, as its " +
    `creator. ${WORKSPACE_WORDS} Answers \`accepted\` with them, or \`rejected\` and why.`,
  input: ListAutomationsInputSchema,
  annotations: READ_ONLY,
  run: ({ workspace, ...asked }) => {
    const { automationId } = asked;
    const list = (call: AgentReadCall) => runListAutomations(call, asked);
    return automationId === undefined
      ? listAsMember(workspace, list)
      : readAsMember(
          (userId) => automationWorkspace(userId, automationId),
          AUTOMATION_TOOL_REFUSAL.NO_AUTOMATION,
          list,
        );
  },
});

/** An automation the member makes names the workspace it is made in, and what the agents' own make names, in the member's words. */
const CreateAutomationInputSchema = Schema.Struct({
  workspace: WORKSPACE_INPUT,
  ...CREATE_AUTOMATION_TOOL.inputSchema.fields,
  ...MEMBER_AUTOMATION_FIELDS,
});

const MEMBER_CREATE_AUTOMATION_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.CREATE_AUTOMATION,
  description:
    "Make an automation in a workspace the member belongs to, as their own automations page " +
    `would: each time its trigger fires, ${PRODUCT_NAME} starts an agent on its prompt, in its ` +
    "repositories or in none, on the member's keys and connections, with no task and no one " +
    "watching, or hands the run to the one agent named. It is on as it is made, runs as the " +
    "member, and the desktop shows it as one they made. It works in the repositories named, " +
    `or in none where you name none. One fired by Sentry needs ${PRODUCT_NAME}'s Sentry ` +
    `integration installed on the workspace first. ${WEBHOOK_WORDS} ${WORKSPACE_WORDS} Make ` +
    `one when the member asks for it, and read ${MEMBER_MCP_TOOL.LIST_AUTOMATIONS} first so ` +
    "you make none they already have. Each call makes an automation of its own, so call it " +
    "once for each. Answers `accepted` with the automation as it stands, or `rejected` and why.",
  input: CreateAutomationInputSchema,
  annotations: ADDITIVE,
  run: ({ workspace, ...asked }) =>
    listWriteAsMember(workspace, (call) => runCreateAutomation(call, asked)),
});

/** A change to an automation names what the agents' own does, in the member's words. */
const UpdateAutomationInputSchema = Schema.Struct({
  ...UPDATE_AUTOMATION_TOOL.inputSchema.fields,
  ...MEMBER_AUTOMATION_FIELDS,
});

const MEMBER_UPDATE_AUTOMATION_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.UPDATE_AUTOMATION,
  description:
    "Change an automation the member may change, by its id as " +
    `${MEMBER_MCP_TOOL.LIST_AUTOMATIONS} answered it, in whichever of the member's workspaces ` +
    "it stands, as its editor on the automations page would: what you leave out stands, and a " +
    "trigger given replaces the one standing whole, a switch to Sentry needing " +
    `${PRODUCT_NAME}'s Sentry integration installed on the workspace. A personal automation ` +
    "is its creator's alone to change, and a workspace's its creator's, owners', and admins'; " +
    "enabled alone, which pauses or resumes it, is open to more of the workspace. " +
    `${WEBHOOK_WORDS} Change one only where the member asked for it. Answers \`accepted\` ` +
    "with the automation as it now stands, or `rejected` and why.",
  input: UpdateAutomationInputSchema,
  annotations: IDEMPOTENT_CHANGE,
  run: (asked) =>
    writeAsMember(
      (userId) => automationWorkspace(userId, asked.automationId),
      AUTOMATION_TOOL_REFUSAL.NO_AUTOMATION,
      (call) => runUpdateAutomation(call, asked),
    ),
});

const MEMBER_RUN_AUTOMATION_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.RUN_AUTOMATION,
  description:
    `Run an automation the member may run now, by its id as ${MEMBER_MCP_TOOL.LIST_AUTOMATIONS} ` +
    "answered it, in whichever of the member's workspaces it stands, as its Run now on the " +
    "automations page would: one run, whatever its trigger, through the same guards a firing " +
    "takes, starting its agent on its prompt as its creator, as a scheduled run would, or " +
    "handing it to the one agent it names. A personal automation is its creator's to run, and " +
    "a workspace's every member's. Run one when the member asks for it, such as to try an " +
    "automation just made. Each call is a run of its own, so call it once for each. Answers " +
    "`accepted` with the run, started with its agent or skipped or failed and why, or " +
    `\`rejected\` and why. ${FOLLOW_WORDS}`,
  input: RUN_AUTOMATION_TOOL.inputSchema,
  annotations: ADDITIVE,
  run: (asked) =>
    writeAsMember(
      (userId) => automationWorkspace(userId, asked.automationId),
      AUTOMATION_TOOL_REFUSAL.NO_AUTOMATION,
      (call) => runRunAutomation(call, asked),
    ),
});

const MEMBER_DELETE_AUTOMATION_TOOL = memberMcpTool({
  name: MEMBER_MCP_TOOL.DELETE_AUTOMATION,
  description:
    "Delete an automation the member may delete, with its history of runs, by its id as " +
    `${MEMBER_MCP_TOOL.LIST_AUTOMATIONS} answered it, in whichever of the member's workspaces ` +
    "it stands, as its Delete on the automations page would; the agents its runs started " +
    "stay. A personal automation is its creator's alone, and a workspace's its creator's, " +
    "owners', and admins'. Delete one only when the member asks for it, and pause one with " +
    `${MEMBER_MCP_TOOL.UPDATE_AUTOMATION}'s enabled false where they only want it to stop. ` +
    "Answers `accepted` with the automation's id and name, or `rejected` and why.",
  input: DELETE_AUTOMATION_TOOL.inputSchema,
  annotations: DESTRUCTIVE,
  run: (asked) =>
    writeAsMember(
      (userId) => automationWorkspace(userId, asked.automationId),
      AUTOMATION_TOOL_REFUSAL.NO_AUTOMATION,
      (call) => runDeleteAutomation(call, asked),
    ),
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
  MEMBER_CREATE_TASK_TOOL,
  MEMBER_UPDATE_TASK_TOOL,
  MEMBER_EDIT_PLAN_TOOL,
  MEMBER_CREATE_SECTION_TOOL,
  MEMBER_DELETE_SECTION_TOOL,
  MEMBER_START_AGENT_TOOL,
  MEMBER_MESSAGE_AGENT_TOOL,
  MEMBER_STOP_AGENT_TOOL,
  MEMBER_UPDATE_AGENT_TOOL,
  READ_INBOX_TOOL,
  ANSWER_ASK_TOOL,
  REPLY_TO_THREAD_TOOL,
  CLOSE_THREAD_TOOL,
  AGENT_PULL_REQUEST_ACTION_TOOL,
  MEMBER_READ_COMMENTS_TOOL,
  MEMBER_COMMENT_ON_PLAN_TOOL,
  MEMBER_REPLY_TO_COMMENT_TOOL,
  MEMBER_UPDATE_COMMENT_TOOL,
  MEMBER_SEARCH_MEMORY_TOOL,
  MEMBER_SAVE_MEMORY_TOOL,
  MEMBER_FORGET_MEMORY_TOOL,
  MEMBER_LIST_AUTOMATIONS_TOOL,
  MEMBER_CREATE_AUTOMATION_TOOL,
  MEMBER_UPDATE_AUTOMATION_TOOL,
  MEMBER_RUN_AUTOMATION_TOOL,
  MEMBER_DELETE_AUTOMATION_TOOL,
];
