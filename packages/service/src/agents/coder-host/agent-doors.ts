/**
 * agent-doors.ts -- the doors every runtime's call of a coding agent's Luke tools goes through: the agent the conversation is, then the tool.
 *
 * eve's tool files reach them through the coder host (`host.ts`), and a
 * native harness's runner through Luke's MCP server
 * (`../luke-mcp/tools.ts`), so both run one implementation, as the inbox's
 * own door does (`inbox-door.ts`). Nothing here imports eve's runtime,
 * because the web function that serves the MCP server bundles no sandbox:
 * a door that reads a file the agent names is handed the door to its
 * sandbox, and one that reaches eve or the store's writer is handed the
 * seams it reads (`AgentDoorSeams`).
 */

import type { DatabaseServices } from "@luke/database/core/query";
import {
  hasRepository,
  readCodingAgentHeaderOfConversation,
  readCodingAgentOfConversation,
} from "@luke/database/models/coding-agent-store";
import { CHAT_TOOL, MEMBER_KIND } from "@luke/features/chat-wire";
import { PAGE_OWNER, PAGE_SHOWER } from "@luke/features/page-wire";
import { PLAN_COMMENT_ACTOR } from "@luke/features/plan-comment-wire";
import { Effect, Option, Result, Stream } from "effect";
import type { HttpClient } from "effect/http";
import type { UnparsedWireValue, WireRecord } from "../../core.js";
import { ACTION_RESULT_STATUS } from "../../core.js";
import type { GitHubApp } from "../../github/github-app.js";
import { HOSTED_HTTP_STATUS } from "../../http/http.js";
import { logStoreFailure } from "../../http/store-failure.js";
import type { WorkspaceLinearConnect } from "../../integrations/integration-connect.js";
import type { ModelCatalog } from "../../providers/model-catalog.js";
import { runLookAtBoard } from "../../tasks/board-look.js";
import { runDrawOnBoard } from "../../tasks/board-tool.js";
import {
  COMMENT_TOOL_REFUSAL,
  type CommentToolName,
  commentToolRejected,
  runCommentTool,
} from "../../tasks/comment-tools.js";
import { runShowPage, SHOW_PAGE_REFUSAL, showPageRejected } from "../../tasks/page-tool.js";
import {
  PICTURE_LOOK_REFUSAL,
  type PictureLookResult,
  pictureNotLooked,
  runLookAtPicture,
} from "../../tasks/picture-look.js";
import { SHOW_CODE_REFUSAL, showCodeIn, showCodeRejected } from "../../tasks/show-code.js";
import type { AdmittedConversation } from "../brain-host/conversation.js";
import {
  type AgentSessions,
  EVE_CANCEL_OUTCOME,
  EVE_MOUNT,
  EVE_RESET_OUTCOME,
  EVE_SEND_OUTCOME,
  eveSessionsComposer,
} from "../brain-host/eve-sessions.js";
import {
  AGENT_CALLER,
  agentToolRejected,
  CODING_AGENT_TOOL_REFUSAL,
  runListAgents,
  runListModels,
  runListTasks,
  runReadAgent,
  runReadPage,
  runStartAgent,
  runStopAgent,
  runUpdateAgent,
  runUpdateTask,
} from "../coding-agent-tools.js";
import { runListOpenAsks } from "../operator-desk.js";
import {
  REPOSITORY_REFUSAL,
  RepositoryRefusal,
  type RepositorySandbox,
} from "../repository-shell.js";
import { isOperator, STEWARD_DELETE_REFUSAL } from "../steward.js";
import { runCreateSection, runDeleteSection } from "../task-section-tools.js";
import { runCreateTask, runReadTask } from "../task-tools.js";
import { CODER, CODER_REFUSAL } from "./bounds.js";
import {
  agentAway,
  CHAT_TOOL_REFUSAL,
  type ChatToolResult,
  chatRejected,
  editAsAgent,
  postAsAgent,
  readAsAgent,
  resolveAsAgent,
} from "./chat.js";
import { CHAT_DOORS } from "./chat-notify.js";
import type { InboxSandboxDoor } from "./inbox-image.js";
import {
  PLAN_EDIT_REFUSAL,
  type PlanEditResult,
  planEditRejected,
  recordPlanEdit,
} from "./plan-edit.js";
import type { CoderHostSeams } from "./production.js";
import {
  openPullRequest,
  PULL_REQUEST_UNAVAILABLE,
  type PullRequestToolResult,
  pullRequestRejected,
} from "./pull-request.js";
import { sessionsRouter } from "./runtime-sessions.js";
import { runShowImage } from "./show-image.js";
import { CODER_TOOL } from "./tool-set.js";

/** What the doors that reach eve or the store's writer read of the deployment: a part of the coder host's own seams, which a web function builds without eve (`../luke-mcp/door-seams.ts`). */
export type AgentDoorSeams = Pick<
  CoderHostSeams,
  "writer" | "deploymentSecret" | "eveOrigin" | "summaryModel"
>;

/** One call of the agent's tools about the workspace's coding agents, by the tool's name, the input its runtime held to its schema, and the call's own id. */
export interface AgentToolCall {
  readonly tool:
    | typeof CODER_TOOL.LIST_AGENTS
    | typeof CODER_TOOL.LIST_OPEN_ASKS
    | typeof CODER_TOOL.READ_AGENT
    | typeof CODER_TOOL.START_AGENT
    | typeof CODER_TOOL.STOP_AGENT
    | typeof CODER_TOOL.UPDATE_AGENT
    | typeof CODER_TOOL.READ_PAGE
    | typeof CODER_TOOL.LIST_TASKS
    | typeof CODER_TOOL.READ_TASK
    | typeof CODER_TOOL.CREATE_TASK
    | typeof CODER_TOOL.CREATE_SECTION
    | typeof CODER_TOOL.DELETE_SECTION
    | typeof CODER_TOOL.UPDATE_TASK
    | typeof CODER_TOOL.LIST_MODELS;
  readonly input: UnparsedWireValue;
  readonly callId: string;
}

/** Each of the agent tools a coding agent is offered, run under the call it makes. */
const AGENT_TOOL_RUN = {
  [CODER_TOOL.LIST_AGENTS]: runListAgents,
  [CODER_TOOL.READ_AGENT]: runReadAgent,
  [CODER_TOOL.START_AGENT]: runStartAgent,
  [CODER_TOOL.STOP_AGENT]: runStopAgent,
  [CODER_TOOL.UPDATE_AGENT]: runUpdateAgent,
  [CODER_TOOL.READ_PAGE]: runReadPage,
  [CODER_TOOL.LIST_TASKS]: runListTasks,
  [CODER_TOOL.READ_TASK]: runReadTask,
  [CODER_TOOL.CREATE_TASK]: runCreateTask,
  [CODER_TOOL.CREATE_SECTION]: runCreateSection,
  [CODER_TOOL.DELETE_SECTION]: runDeleteSection,
  [CODER_TOOL.UPDATE_TASK]: runUpdateTask,
  [CODER_TOOL.LIST_MODELS]: runListModels,
  [CODER_TOOL.LIST_OPEN_ASKS]: runListOpenAsks,
} as const;

/** One call of the agent's chat tools, by the tool's name and the input its runtime held to its schema; a post carries its call's id, its key, how many posts its turn has made, and the door to the session's sandbox, where its pictures are read. */
export type ChatCall =
  | {
      readonly tool: typeof CHAT_TOOL.POST;
      readonly input: UnparsedWireValue;
      readonly clientKey: string;
      readonly postsInTurn: number;
      readonly sandbox: InboxSandboxDoor;
    }
  | { readonly tool: typeof CHAT_TOOL.READ; readonly input: UnparsedWireValue }
  | { readonly tool: typeof CHAT_TOOL.RESOLVE; readonly input: UnparsedWireValue }
  | { readonly tool: typeof CHAT_TOOL.EDIT_CHANNEL; readonly input: UnparsedWireValue };

/**
 * eve as a deployment that names no secret or no origin for it reaches it:
 * every call answered as failed, so a chat post still lands and a member it
 * addresses, whose notice could not be handed over, reads it when it next
 * reads, as one whose steer eve refused does (`chat-notify.ts`).
 */
const EVE_UNREACHED: AgentSessions = {
  open: () =>
    Effect.succeed({
      outcome: EVE_SEND_OUTCOME.FAILED,
      status: HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE,
    }),
  send: () =>
    Effect.succeed({
      outcome: EVE_SEND_OUTCOME.FAILED,
      status: HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE,
    }),
  cancel: () =>
    Effect.succeed({
      outcome: EVE_CANCEL_OUTCOME.FAILED,
      status: HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE,
    }),
  reset: () =>
    Effect.succeed({
      outcome: EVE_RESET_OUTCOME.FAILED,
      status: HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE,
    }),
  stream: () => Stream.empty,
};

/** The whiteboard's tools, by the name a call of one is made under. */
export type BoardTool = typeof CODER_TOOL.DRAW_ON_BOARD | typeof CODER_TOOL.LOOK_AT_BOARD;

/** Why a call of the whiteboard's tools drew or looked at nothing, in words the model can act on. */
const BOARD_REFUSAL = {
  TASKLESS: "Not run: you work on no task, so there is no whiteboard to draw on or look at.",
  UNAVAILABLE: "Not run: the whiteboard could not be reached just now. The call may be made again.",
} as const;

/** A call of the whiteboard's tools that ran nothing, and why. */
function boardRejected(reason: string): WireRecord {
  return { status: ACTION_RESULT_STATUS.REJECTED, reason };
}

/** The agent a read found, or the refusal that the conversation is none. */
function foundOrRefused<A>(found: Option.Option<A>) {
  return Option.match(found, {
    onNone: () => Result.fail(CODER_REFUSAL.NO_AGENT),
    onSome: (agent) => Result.succeed(agent),
  });
}

/** The coding agent the admitted conversation is, whole, or the refusal that it is none. */
function agentOfConversation(admitted: AdmittedConversation) {
  return Effect.map(
    readCodingAgentOfConversation(admitted.target.userId, admitted.target.conversationId),
    foundOrRefused,
  );
}

/** The header of the coding agent the admitted conversation is, for a tool that needs no more of it, or the refusal that it is none. */
function agentHeaderOfConversation(admitted: AdmittedConversation) {
  return Effect.map(
    readCodingAgentHeaderOfConversation(admitted.target.userId, admitted.target.conversationId),
    foundOrRefused,
  );
}

/** Takes one `edit_plan` call's notes into the agent's plan, given how many notes the turn has taken already, its pictures read through the sandbox door given. */
export function runAgentEditPlan(
  admitted: AdmittedConversation,
  input: UnparsedWireValue,
  takenInTurn: number,
  sandbox: InboxSandboxDoor,
): Effect.Effect<PlanEditResult, never, DatabaseServices> {
  return Effect.gen(function* () {
    const found = yield* agentHeaderOfConversation(admitted);
    if (Result.isFailure(found)) return planEditRejected(found.failure);
    const { id: agentId, taskId } = found.success;
    if (taskId === null) return planEditRejected(PLAN_EDIT_REFUSAL.NO_TASK);
    // The plan is written as the member whose turn this is, whoever started the agent.
    const binding = { userId: admitted.caller, taskId };
    return yield* recordPlanEdit(binding, { agentId }, input, takenInTurn, sandbox);
  }).pipe(
    Effect.tapError(logStoreFailure),
    Effect.catch(() => Effect.succeed(planEditRejected(PLAN_EDIT_REFUSAL.UNAVAILABLE))),
  );
}

/** Runs one `look_at_picture` call: one of the pictures of the agent's plan, read as the member whose turn this is. */
export function runAgentLookAtPicture(
  admitted: AdmittedConversation,
  input: UnparsedWireValue,
): Effect.Effect<PictureLookResult, never, DatabaseServices> {
  return Effect.gen(function* () {
    const found = yield* agentHeaderOfConversation(admitted);
    if (Result.isFailure(found)) return pictureNotLooked(found.failure);
    const { taskId } = found.success;
    if (taskId === null) return pictureNotLooked(PICTURE_LOOK_REFUSAL.TASKLESS);
    // The plan is read as the member whose turn this is, as `editPlan` writes it.
    return yield* runLookAtPicture({ userId: admitted.caller, taskId }, input);
  }).pipe(
    Effect.tapError(logStoreFailure),
    Effect.catch(() => Effect.succeed(pictureNotLooked(PICTURE_LOOK_REFUSAL.UNAVAILABLE))),
  );
}

/** Opens the agent's pull request (`pull-request.ts`): as its developer where it writes as them, as the App otherwise. */
export function runAgentOpenPullRequest(
  admitted: AdmittedConversation,
  input: UnparsedWireValue,
): Effect.Effect<
  PullRequestToolResult,
  never,
  DatabaseServices | HttpClient.HttpClient | GitHubApp
> {
  return Effect.gen(function* () {
    const found = yield* agentOfConversation(admitted);
    if (Result.isFailure(found)) return pullRequestRejected(found.failure);
    // Note that eve offers the tool to no agent with no repository (`repositoryToolsOf`); a harness is offered it always, and this refuses it.
    if (!hasRepository(found.success)) return pullRequestRejected(CODER_REFUSAL.NO_REPOSITORY);
    return yield* openPullRequest(admitted.target, found.success, input);
  }).pipe(
    Effect.tapError(logStoreFailure),
    Effect.catch(() => Effect.succeed(pullRequestRejected(PULL_REQUEST_UNAVAILABLE))),
  );
}

/** Runs one call of a comment tool (`tasks/comment-tools.ts`) on the agent's plan, as the member whose turn it is, written under the agent. */
export function runAgentComment(
  admitted: AdmittedConversation,
  name: CommentToolName,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, DatabaseServices> {
  return Effect.gen(function* () {
    const found = yield* agentHeaderOfConversation(admitted);
    if (Result.isFailure(found)) return commentToolRejected(found.failure);
    const { id: agentId, taskId } = found.success;
    if (taskId === null) return commentToolRejected(COMMENT_TOOL_REFUSAL.TASKLESS);
    // The comments are read and written as the member whose turn this is, as `editPlan` writes the plan.
    const writer = {
      actor: PLAN_COMMENT_ACTOR.AGENT,
      userId: admitted.caller,
      agentId,
    } as const;
    return yield* runCommentTool(name, { taskId, writer }, input);
  }).pipe(
    Effect.tapError(logStoreFailure),
    Effect.catch(() => Effect.succeed(commentToolRejected(COMMENT_TOOL_REFUSAL.UNAVAILABLE))),
  );
}

/** Runs one `show_page` call on the agent's task, or on the agent itself where it works on none, a page's path read from its sandbox through the door given. */
export function runAgentShowPage(
  admitted: AdmittedConversation,
  input: UnparsedWireValue,
  sandbox: InboxSandboxDoor,
): Effect.Effect<WireRecord, never, DatabaseServices> {
  return Effect.gen(function* () {
    const found = yield* agentHeaderOfConversation(admitted);
    if (Result.isFailure(found)) return showPageRejected(found.failure);
    const { id: agentId, taskId } = found.success;
    const binding = {
      userId: admitted.target.userId,
      owner:
        taskId === null
          ? ({ kind: PAGE_OWNER.AGENT, agentId } as const)
          : ({ kind: PAGE_OWNER.TASK, taskId } as const),
      sandbox: { door: sandbox, checkout: CODER.CHECKOUT_PATH },
    };
    return yield* runShowPage(binding, input, {
      kind: PAGE_SHOWER.AGENT,
      agentId,
    });
  }).pipe(
    Effect.tapError(logStoreFailure),
    Effect.catch(() => Effect.succeed(showPageRejected(SHOW_PAGE_REFUSAL.UNAVAILABLE))),
  );
}

/** Runs one `show_image` call: the pictures read from the agent's sandbox through the door given and kept beside its transcript. */
export function runAgentShowImage(
  admitted: AdmittedConversation,
  input: UnparsedWireValue,
  sandbox: InboxSandboxDoor,
): Effect.Effect<WireRecord, never, DatabaseServices> {
  return runShowImage({ target: admitted.target, sandbox, checkout: CODER.CHECKOUT_PATH }, input);
}

/**
 * Runs one of the agent's chat tools (`chat.ts`): a post, told to each
 * agent it addresses through eve as the deployment acting for that agent's
 * starter, and held for its next read where the deployment names no secret
 * or no origin for eve; a read; or a resolve. Refused where Chat is off for
 * the agent's starter.
 */
export function runAgentChat(
  seams: AgentDoorSeams,
  admitted: AdmittedConversation,
  call: ChatCall,
): Effect.Effect<ChatToolResult, never, DatabaseServices | HttpClient.HttpClient | GitHubApp> {
  return Effect.gen(function* () {
    const found = yield* agentHeaderOfConversation(admitted);
    if (Result.isFailure(found)) return chatRejected(CHAT_TOOL_REFUSAL.NO_AGENT);
    const { id: agentId, taskId, repository } = found.success;
    const self = { kind: MEMBER_KIND.AGENT, agentId };
    const reader = { userId: admitted.target.userId, taskId, self };
    if (call.tool === CHAT_TOOL.READ) return yield* readAsAgent(reader, call.input);
    if (call.tool === CHAT_TOOL.RESOLVE) return yield* resolveAsAgent(reader, call.input);
    // An archived agent, or one on an archived task, posts nothing until it is brought back.
    if (yield* agentAway(admitted.target.userId, found.success)) {
      return chatRejected(CHAT_TOOL_REFUSAL.LEFT);
    }
    if (call.tool === CHAT_TOOL.EDIT_CHANNEL) return yield* editAsAgent(reader, call.input);
    // A notice reaches the receiving agent's session as the deployment acting for that agent's
    // starter, whose principal its turn runs under, as the planning model's message to an
    // agent does: no bearer stands here.
    const secret = seams.deploymentSecret();
    const origin = seams.eveOrigin();
    const compose = yield* eveSessionsComposer;
    // Each agent's session is answered by the runtime its conversation runs on (`runtime-sessions.ts`).
    const route = yield* sessionsRouter;
    const eveFor = (starter: string) =>
      secret === undefined || origin === undefined
        ? EVE_UNREACHED
        : route(
            compose({ origin, caller: { secret, account: starter }, mount: EVE_MOUNT.CODER }),
            starter,
          );
    const telling = { eveFor, writer: seams.writer(), doors: CHAT_DOORS };
    const { clientKey, postsInTurn, sandbox } = call;
    const { conversationId } = admitted.target;
    return yield* postAsAgent({ ...reader, conversationId, repository, telling }, call.input, {
      clientKey,
      postsInTurn,
      sandbox,
    });
  }).pipe(
    Effect.tapError(logStoreFailure),
    Effect.catch(() => Effect.succeed(chatRejected(CHAT_TOOL_REFUSAL.UNAVAILABLE))),
  );
}

/**
 * Runs one of the agent's tools about the workspace's coding agents
 * (`../coding-agent-tools.ts`), the agent the conversation is as the
 * caller: a list of agents or of tasks, a message sent under the call's own
 * key, or a start on a task of its workspace under the same key, which reach
 * eve as the deployment acting for this agent's starter, and reach nothing
 * where the deployment names no secret or no origin for eve.
 */
export function runAgentTools(
  seams: AgentDoorSeams,
  admitted: AdmittedConversation,
  call: AgentToolCall,
): Effect.Effect<
  WireRecord,
  never,
  DatabaseServices | HttpClient.HttpClient | GitHubApp | ModelCatalog | WorkspaceLinearConnect
> {
  return Effect.gen(function* () {
    const found = yield* agentOfConversation(admitted);
    if (Result.isFailure(found)) return agentToolRejected(found.failure);
    // The agent asking is the one the conversation is, and eve is reached as its starter.
    const sender = found.success;
    // An operator deletes nothing: it is not offered the delete, and a native harness's call of it is refused.
    if (call.tool === CODER_TOOL.DELETE_SECTION && isOperator(sender)) {
      return agentToolRejected(STEWARD_DELETE_REFUSAL);
    }
    const secret = seams.deploymentSecret();
    const origin = seams.eveOrigin();
    const compose = yield* eveSessionsComposer;
    // Each agent the tools reach is answered by the runtime its conversation runs on (`runtime-sessions.ts`).
    const route = yield* sessionsRouter;
    const eve =
      secret === undefined || origin === undefined
        ? undefined
        : route(
            compose({
              origin,
              caller: { secret, account: sender.userId },
              mount: EVE_MOUNT.CODER,
            }),
            sender.userId,
          );
    const caller = { kind: AGENT_CALLER.AGENT, agent: sender } as const;
    const toolCall = {
      caller,
      eve,
      writer: seams.writer(),
      clientKey: call.callId,
      summaryModel: seams.summaryModel,
    };
    return yield* AGENT_TOOL_RUN[call.tool](toolCall, call.input);
  }).pipe(
    Effect.tapError(logStoreFailure),
    Effect.catch(() => Effect.succeed(agentToolRejected(CODING_AGENT_TOOL_REFUSAL.STORE))),
  );
}

/**
 * Runs one `show_code` call (`../../tasks/show-code.ts`): lines of the
 * checkout the agent's sandbox holds, read through the door given, and
 * journaled with the call on the agent's own conversation.
 */
export function runAgentShowCode(
  admitted: AdmittedConversation,
  input: UnparsedWireValue,
  sandbox: () => Promise<RepositorySandbox>,
): Effect.Effect<WireRecord, never, DatabaseServices> {
  return Effect.gen(function* () {
    const found = yield* agentHeaderOfConversation(admitted);
    if (Result.isFailure(found)) return showCodeRejected(found.failure);
    const { repository } = found.success;
    // Note that eve offers the tool to no agent with no repository (`repositoryToolsOf`); a harness is offered it always, and this refuses it.
    // The sandbox opened with the checkout standing (`checkOut`), so the lines are read where it stands.
    const checkout =
      repository === null
        ? Effect.fail(new RepositoryRefusal({ reason: REPOSITORY_REFUSAL.NO_REPOSITORY }))
        : Effect.tryPromise({
            try: sandbox,
            catch: () => new RepositoryRefusal({ reason: REPOSITORY_REFUSAL.SANDBOX_UNAVAILABLE }),
          }).pipe(Effect.map((opened) => ({ sandbox: opened, repository })));
    return yield* showCodeIn(checkout, input);
  }).pipe(
    Effect.tapError(logStoreFailure),
    Effect.catch(() => Effect.succeed(showCodeRejected(SHOW_CODE_REFUSAL.READ_FAILED))),
  );
}

/** Runs one call of the whiteboard's tools (`../../tasks/board-tool.ts`, `../../tasks/board-look.ts`) on the agent's task, as the member whose turn it is. */
export function runAgentBoard(
  admitted: AdmittedConversation,
  tool: BoardTool,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, DatabaseServices> {
  return Effect.gen(function* () {
    const found = yield* agentHeaderOfConversation(admitted);
    if (Result.isFailure(found)) return boardRejected(found.failure);
    const { taskId } = found.success;
    if (taskId === null) return boardRejected(BOARD_REFUSAL.TASKLESS);
    // The board is drawn and read as the member whose turn this is, as `editPlan` writes the plan.
    const binding = { userId: admitted.caller, taskId };
    const ran =
      tool === CODER_TOOL.DRAW_ON_BOARD
        ? runDrawOnBoard(binding, input)
        : runLookAtBoard(binding, input);
    return { ...(yield* ran) };
  }).pipe(
    Effect.tapError(logStoreFailure),
    Effect.catch(() => Effect.succeed(boardRejected(BOARD_REFUSAL.UNAVAILABLE))),
  );
}
