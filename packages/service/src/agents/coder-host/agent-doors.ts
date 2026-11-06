/**
 * agent-doors.ts -- the doors every runtime's call of one of our tools by a coding agent goes through: the agent the conversation is, then the tool.
 *
 * eve's tool files reach them through the coder host (`host.ts`), and a
 * native harness's runner through our MCP server
 * (`../workspace-mcp/tools.ts`), so both run one implementation, as the inbox's
 * own door does (`inbox-door.ts`). Nothing here imports eve's runtime,
 * because the web function that serves the MCP server bundles no sandbox:
 * a door that reads a file the agent names is handed the door to its
 * sandbox, and one that reaches eve or the store's writer is handed the
 * seams it reads (`AgentDoorSeams`).
 */

import type { DatabaseServices } from "@repo/database/core/query";
import {
  type Agent,
  hasRepository,
  readAgentHeaderOfConversation,
  readAgentOfConversation,
} from "@repo/database/models/agent-store";
import { readTaskHeader } from "@repo/database/models/task-store";
import type { StoreWriter } from "@repo/database/models/writer";
import { DESCRIPTION_COMMENT_ACTOR } from "@repo/features/description-comment-wire";
import { PAGE_OWNER, PAGE_SHOWER } from "@repo/features/page-wire";
import { EXPERIMENT } from "@repo/settings";
import { Effect, Option, Result } from "effect";
import type { HttpClient } from "effect/http";
import type { UnparsedWireValue, WireRecord } from "../../core.js";
import type { GitHubApp } from "../../github/github-app.js";
import { logStoreFailure } from "../../http/store-failure.js";
import type { ModelCatalog } from "../../providers/model-catalog.js";
import {
  COMMENT_TOOL_REFUSAL,
  type CommentToolName,
  commentedTaskOf,
  commentToolRejected,
  runCommentTool,
} from "../../tasks/comment-tools.js";
import { runShowPage, SHOW_PAGE_REFUSAL, showPageRejected } from "../../tasks/page-tool.js";
import {
  lookedTaskOf,
  PICTURE_LOOK_REFUSAL,
  type PictureLookResult,
  pictureNotLooked,
  runLookAtPicture,
} from "../../tasks/picture-look.js";
import type { SentryApp } from "../../triggers/sentry/sentry-app-config.js";
import {
  AGENT_CALLER,
  AGENT_TOOL_REFUSAL,
  agentToolRejected,
  runListAgents,
  runListModels,
  runListTasks,
  runReadAgent,
  runReadPage,
  runStartAgent,
  runStopAgent,
  runUpdateAgent,
  runUpdateTask,
} from "../agent-tools.js";
import {
  runCreateAutomation,
  runDeleteAutomation,
  runListAutomations,
  runRunAutomation,
  runUpdateAutomation,
} from "../automation-tools.js";
import type { AdmittedConversation } from "../eve-host/conversation.js";
import { runAgentRecall, runAgentRemember } from "../memory-tools.js";
import { runCreateSection, runDeleteSection } from "../task-section-tools.js";
import { runCreateTask, runReadTask } from "../task-tools.js";
import { EXPERIMENT_OFF_REFUSAL, experimentOnIn } from "../workspace-experiment-on.js";
import { runMessageAgent } from "./agent-message.js";
import { CODER, CODER_REFUSAL } from "./bounds.js";
import {
  DESCRIPTION_EDIT_REFUSAL,
  type DescriptionEditResult,
  descriptionEditRejected,
  editedTaskOf,
  recordDescriptionEdit,
} from "./description-edit.js";
import type { InboxSandboxDoor } from "./inbox-image.js";
import {
  openPullRequest,
  PULL_REQUEST_UNAVAILABLE,
  type PullRequestToolResult,
  pullRequestRejected,
} from "./pull-request.js";
import type { SummaryModelOf } from "./replay-summary.js";
import { sessionsRouter } from "./runtime-sessions.js";
import { runShowImage } from "./show-image.js";
import { CODER_TOOL } from "./tool-set.js";

/** What the doors that reach an agent's session or the store's writer read of the deployment, as the web function serving the MCP server builds them (`../workspace-mcp/door-seams.ts`). */
export interface AgentDoorSeams {
  /** The writer over the coding agent's tool set, composed once per instance. */
  readonly writer: () => Effect.Effect<StoreWriter>;
  /** How an agent this one starts from another summarizes the steps its replay cannot keep, as the Start route's does; none leaves them out. */
  readonly summaryModel?: SummaryModelOf;
}

/** One call of the agent's tools about the workspace's coding agents, by the tool's name, the input its runtime held to its schema, and the call's own id. */
export interface AgentToolCall {
  readonly tool:
    | typeof CODER_TOOL.LIST_AGENTS
    | typeof CODER_TOOL.READ_AGENT
    | typeof CODER_TOOL.MESSAGE_AGENT
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
    | typeof CODER_TOOL.LIST_AUTOMATIONS
    | typeof CODER_TOOL.CREATE_AUTOMATION
    | typeof CODER_TOOL.UPDATE_AUTOMATION
    | typeof CODER_TOOL.DELETE_AUTOMATION
    | typeof CODER_TOOL.RUN_AUTOMATION
    | typeof CODER_TOOL.LIST_MODELS
    | typeof CODER_TOOL.SAVE_MEMORY
    | typeof CODER_TOOL.SEARCH_MEMORY;
  readonly input: UnparsedWireValue;
  readonly callId: string;
}

/** Each of the agent tools a coding agent is offered, run under the call it makes. */
const AGENT_TOOL_RUN = {
  [CODER_TOOL.LIST_AGENTS]: runListAgents,
  [CODER_TOOL.READ_AGENT]: runReadAgent,
  [CODER_TOOL.MESSAGE_AGENT]: runMessageAgent,
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
  [CODER_TOOL.LIST_AUTOMATIONS]: runListAutomations,
  [CODER_TOOL.CREATE_AUTOMATION]: runCreateAutomation,
  [CODER_TOOL.UPDATE_AUTOMATION]: runUpdateAutomation,
  [CODER_TOOL.DELETE_AUTOMATION]: runDeleteAutomation,
  [CODER_TOOL.RUN_AUTOMATION]: runRunAutomation,
  [CODER_TOOL.LIST_MODELS]: runListModels,
  [CODER_TOOL.SAVE_MEMORY]: runAgentRemember,
  [CODER_TOOL.SEARCH_MEMORY]: runAgentRecall,
} as const;

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
    readAgentOfConversation(admitted.target.userId, admitted.target.conversationId),
    foundOrRefused,
  );
}

/** The header of the coding agent the admitted conversation is, for a tool that needs no more of it, or the refusal that it is none. */
function agentHeaderOfConversation(admitted: AdmittedConversation) {
  return Effect.map(
    readAgentHeaderOfConversation(admitted.target.userId, admitted.target.conversationId),
    foundOrRefused,
  );
}

/**
 * The task a call names, where it stands in the agent's own workspace, as
 * the member whose turn this is reaches it; nothing otherwise, which each
 * tool refuses as no task in its own words. Note that a task of another
 * workspace the member is also in is none of the agent's, as `read_task`
 * reads one, and answers as no task at all.
 */
function agentTaskOf(
  admitted: AdmittedConversation,
  agent: Pick<Agent, "organizationId">,
  taskId: string,
) {
  return Effect.map(
    readTaskHeader(admitted.caller, taskId),
    Option.filter((task) => task.workspaceId === agent.organizationId),
  );
}

/** Takes one `edit_description` call's notes into the description of the task it names, given how many notes the turn has taken already, its pictures read through the sandbox door given. */
export function runAgentEditDescription(
  admitted: AdmittedConversation,
  input: UnparsedWireValue,
  takenInTurn: number,
  sandbox: InboxSandboxDoor,
): Effect.Effect<DescriptionEditResult, never, DatabaseServices> {
  return Effect.gen(function* () {
    const found = yield* agentOfConversation(admitted);
    if (Result.isFailure(found)) return descriptionEditRejected(found.failure);
    // Note that no agent whose workspace has Task descriptions off is listed the tool; a harness may call it anyway, and this refuses it.
    if (!(yield* experimentOnIn(found.success.organizationId, EXPERIMENT.DESCRIPTIONS))) {
      return descriptionEditRejected(EXPERIMENT_OFF_REFUSAL);
    }
    const taskId = editedTaskOf(input);
    if (taskId === undefined)
      return descriptionEditRejected(DESCRIPTION_EDIT_REFUSAL.NO_TASK_NAMED);
    const task = yield* agentTaskOf(admitted, found.success, taskId);
    if (Option.isNone(task)) return descriptionEditRejected(DESCRIPTION_EDIT_REFUSAL.NO_TASK);
    const agentId = found.success.id;
    // The description is written as the member whose turn this is, whoever started the agent.
    const binding = { userId: admitted.caller, taskId };
    return yield* recordDescriptionEdit(binding, { agentId }, input, takenInTurn, sandbox);
  }).pipe(
    Effect.tapError(logStoreFailure),
    Effect.catch(() =>
      Effect.succeed(descriptionEditRejected(DESCRIPTION_EDIT_REFUSAL.UNAVAILABLE)),
    ),
  );
}

/** Runs one `look_at_picture` call: one of the pictures of the description its address names, in the agent's workspace, read as the member whose turn this is. */
export function runAgentLookAtPicture(
  admitted: AdmittedConversation,
  input: UnparsedWireValue,
): Effect.Effect<PictureLookResult, never, DatabaseServices> {
  return Effect.gen(function* () {
    const found = yield* agentOfConversation(admitted);
    if (Result.isFailure(found)) return pictureNotLooked(found.failure);
    if (!(yield* experimentOnIn(found.success.organizationId, EXPERIMENT.DESCRIPTIONS))) {
      return pictureNotLooked(EXPERIMENT_OFF_REFUSAL);
    }
    const taskId = lookedTaskOf(input);
    if (taskId === undefined) return pictureNotLooked(PICTURE_LOOK_REFUSAL.UNREADABLE);
    if (Option.isNone(yield* agentTaskOf(admitted, found.success, taskId))) {
      return pictureNotLooked(PICTURE_LOOK_REFUSAL.ELSEWHERE);
    }
    // The description is read as the member whose turn this is, as `editDescription` writes it.
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
    // Note that eve offers the tool to no agent with no repository (`repositoryToolsOf`); a harness may call it anyway, and this refuses it.
    if (!hasRepository(found.success)) return pullRequestRejected(CODER_REFUSAL.NO_REPOSITORY);
    return yield* openPullRequest(admitted.target, found.success, input);
  }).pipe(
    Effect.tapError(logStoreFailure),
    Effect.catch(() => Effect.succeed(pullRequestRejected(PULL_REQUEST_UNAVAILABLE))),
  );
}

/**
 * Runs one call of a comment tool (`tasks/comment-tools.ts`) on the description of
 * the task it names, or one of its pages, in the agent's workspace, as the
 * member whose turn it is, written under the agent; the description's threads only
 * where the agent's workspace has Task descriptions on (`experimentOnIn`).
 */
export function runAgentComment(
  admitted: AdmittedConversation,
  name: CommentToolName,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, DatabaseServices> {
  return Effect.gen(function* () {
    const found = yield* agentOfConversation(admitted);
    if (Result.isFailure(found)) return commentToolRejected(found.failure);
    const taskId = commentedTaskOf(input);
    if (taskId === undefined) return commentToolRejected(COMMENT_TOOL_REFUSAL.NO_TASK_NAMED);
    const task = yield* agentTaskOf(admitted, found.success, taskId);
    if (Option.isNone(task)) return commentToolRejected(COMMENT_TOOL_REFUSAL.NO_TASK);
    const agentId = found.success.id;
    // The comments are read and written as the member whose turn this is, as `editDescription` writes the description.
    const writer = {
      actor: DESCRIPTION_COMMENT_ACTOR.AGENT,
      userId: admitted.caller,
      agentId,
    } as const;
    // A page's threads stand whatever the workspace's Task descriptions; the description's are left out while it is off.
    const descriptionsOn = yield* experimentOnIn(
      found.success.organizationId,
      EXPERIMENT.DESCRIPTIONS,
    );
    return yield* runCommentTool(name, { taskId, writer, descriptionsOn }, input);
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
 * Runs one of the agent's tools about the workspace's coding agents
 * (`../agent-tools.ts`), the agent the conversation is as the
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
  DatabaseServices | HttpClient.HttpClient | GitHubApp | ModelCatalog | SentryApp
> {
  return Effect.gen(function* () {
    const found = yield* agentOfConversation(admitted);
    if (Result.isFailure(found)) return agentToolRejected(found.failure);
    // The agent asking is the one the conversation is, and the sessions it reaches are its starter's.
    const sender = found.success;
    // Each agent the tools reach is answered by the runtime its conversation runs on (`runtime-sessions.ts`).
    const eveAs = yield* sessionsRouter;
    const eve = eveAs(sender.userId);
    const caller = { kind: AGENT_CALLER.AGENT, agent: sender } as const;
    const toolCall = {
      caller,
      eve,
      eveAs,
      writer: seams.writer(),
      clientKey: call.callId,
      summaryModel: seams.summaryModel,
    };
    return yield* AGENT_TOOL_RUN[call.tool](toolCall, call.input);
  }).pipe(
    Effect.tapError(logStoreFailure),
    Effect.catch(() => Effect.succeed(agentToolRejected(AGENT_TOOL_REFUSAL.STORE))),
  );
}
