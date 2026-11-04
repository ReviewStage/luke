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
 * The one change, `agent_pull_request_action`, makes what an agent's Pull
 * request tab makes, through the operation the tab's procedure runs
 * (`../agents/agent-pull-request-procedures.ts`), on the member's own
 * GitHub sign-in as the tab does, never the App's.
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
import { githubPullRequestNumberSchema } from "@repo/features/github-repositories-wire";
import { PAGE_OWNER } from "@repo/features/page-wire";
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
import {
  READ_AGENT_CHANGES,
  READ_AGENT_CHANGES_INPUT,
  runReadAgentChanges,
} from "../agents/agent-changes-tool.js";
import { agentPullRequestAction } from "../agents/agent-pull-request-procedures.js";
import {
  AGENT_CALLER,
  AGENT_TOOL_BOUNDS,
  AGENT_TOOL_REFUSAL,
  type AgentReadCall,
  type AgentToolServices,
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
  TASKS_LIST_LIMIT,
  workspaceAgentOf,
} from "../agents/agent-tools.js";
import { instancePublishedCache } from "../agents/coder-host/published.js";
import {
  PLAN_TEXT_READ_CHARS,
  READ_TASK_REFUSAL,
  READ_TASK_TOOL,
  runReadTask,
} from "../agents/task-tools.js";
import { WORKSPACE_AGENTS_LIST_LIMIT } from "../agents/workspace-agents.js";
import {
  ACTION_RESULT_STATUS,
  HOSTED_API_ERROR,
  type WireRecord,
  wireUuidSchema,
} from "../core.js";
import type { GitHubApp } from "../github/github-app.js";
import { agentWorkspace } from "../github/workspace-repository.js";
import type { HostedRefusal } from "../http/http-effect.js";
import type { StoreFailure } from "../http/store-failure.js";
import type { ModelCatalog } from "../providers/model-catalog.js";
import { AdmittedMember, type AdmittedMemberValues } from "./admission.js";

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
  AGENT_PULL_REQUEST_ACTION: "agent_pull_request_action",
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
  annotations: { destructiveHint: true },
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
  AGENT_PULL_REQUEST_ACTION_TOOL,
];
