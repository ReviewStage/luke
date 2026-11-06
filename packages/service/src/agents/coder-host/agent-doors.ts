import type { DatabaseServices } from "@repo/database/core/query";
import {
  type Agent,
  hasRepository,
  readAgentHeaderOfConversation,
  readAgentOfConversation,
} from "@repo/database/models/agent-store";
import { readTaskHeader } from "@repo/database/models/task-store";
import type { StoreWriter } from "@repo/database/models/writer";
import { PAGE_OWNER, PAGE_SHOWER } from "@repo/features/page-wire";
import { DESCRIPTION_COMMENT_ACTOR } from "@repo/features/description-comment-wire";
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
import { descriptionsOnFor } from "../descriptions-on.js";
import { runCreateSection, runDeleteSection } from "../task-section-tools.js";
import { runCreateTask, runReadTask } from "../task-tools.js";
import { runMessageAgent } from "./agent-message.js";
import { CODER, CODER_REFUSAL } from "./bounds.js";
import type { InboxSandboxDoor } from "./inbox-image.js";
import {
  editedTaskOf,
  DESCRIPTION_EDIT_REFUSAL,
  type DescriptionEditResult,
  descriptionEditRejected,
  recordDescriptionEdit,
} from "./description-edit.js";
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

export interface AgentDoorSeams {
  readonly writer: () => Effect.Effect<StoreWriter>;
  readonly summaryModel?: SummaryModelOf;
}

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

function foundOrRefused<A>(found: Option.Option<A>) {
  return Option.match(found, {
    onNone: () => Result.fail(CODER_REFUSAL.NO_AGENT),
    onSome: (agent) => Result.succeed(agent),
  });
}

function agentOfConversation(admitted: AdmittedConversation) {
  return Effect.map(
    readAgentOfConversation(admitted.target.userId, admitted.target.conversationId),
    foundOrRefused,
  );
}

function agentHeaderOfConversation(admitted: AdmittedConversation) {
  return Effect.map(
    readAgentHeaderOfConversation(admitted.target.userId, admitted.target.conversationId),
    foundOrRefused,
  );
}

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

export function runAgentEditDescription(
  admitted: AdmittedConversation,
  input: UnparsedWireValue,
  takenInTurn: number,
  sandbox: InboxSandboxDoor,
): Effect.Effect<DescriptionEditResult, never, DatabaseServices> {
  return Effect.gen(function* () {
    const found = yield* agentOfConversation(admitted);
    if (Result.isFailure(found)) return descriptionEditRejected(found.failure);
    if (!(yield* descriptionsOnFor(found.success.userId, found.success.kind))) {
      return descriptionEditRejected(DESCRIPTION_EDIT_REFUSAL.OFF);
    }
    const taskId = editedTaskOf(input);
    if (taskId === undefined)
      return descriptionEditRejected(DESCRIPTION_EDIT_REFUSAL.NO_TASK_NAMED);
    const task = yield* agentTaskOf(admitted, found.success, taskId);
    if (Option.isNone(task)) return descriptionEditRejected(DESCRIPTION_EDIT_REFUSAL.NO_TASK);
    const agentId = found.success.id;
    const binding = { userId: admitted.caller, taskId };
    return yield* recordDescriptionEdit(binding, { agentId }, input, takenInTurn, sandbox);
  }).pipe(
    Effect.tapError(logStoreFailure),
    Effect.catch(() =>
      Effect.succeed(descriptionEditRejected(DESCRIPTION_EDIT_REFUSAL.UNAVAILABLE)),
    ),
  );
}

export function runAgentLookAtPicture(
  admitted: AdmittedConversation,
  input: UnparsedWireValue,
): Effect.Effect<PictureLookResult, never, DatabaseServices> {
  return Effect.gen(function* () {
    const found = yield* agentOfConversation(admitted);
    if (Result.isFailure(found)) return pictureNotLooked(found.failure);
    if (!(yield* descriptionsOnFor(found.success.userId, found.success.kind))) {
      return pictureNotLooked(PICTURE_LOOK_REFUSAL.OFF);
    }
    const taskId = lookedTaskOf(input);
    if (taskId === undefined) return pictureNotLooked(PICTURE_LOOK_REFUSAL.UNREADABLE);
    if (Option.isNone(yield* agentTaskOf(admitted, found.success, taskId))) {
      return pictureNotLooked(PICTURE_LOOK_REFUSAL.ELSEWHERE);
    }
    return yield* runLookAtPicture({ userId: admitted.caller, taskId }, input);
  }).pipe(
    Effect.tapError(logStoreFailure),
    Effect.catch(() => Effect.succeed(pictureNotLooked(PICTURE_LOOK_REFUSAL.UNAVAILABLE))),
  );
}

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
    if (!hasRepository(found.success)) return pullRequestRejected(CODER_REFUSAL.NO_REPOSITORY);
    return yield* openPullRequest(admitted.target, found.success, input);
  }).pipe(
    Effect.tapError(logStoreFailure),
    Effect.catch(() => Effect.succeed(pullRequestRejected(PULL_REQUEST_UNAVAILABLE))),
  );
}

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
    const writer = {
      actor: DESCRIPTION_COMMENT_ACTOR.AGENT,
      userId: admitted.caller,
      agentId,
    } as const;
    const descriptionsOn = yield* descriptionsOnFor(found.success.userId, found.success.kind);
    return yield* runCommentTool(name, { taskId, writer, descriptionsOn }, input);
  }).pipe(
    Effect.tapError(logStoreFailure),
    Effect.catch(() => Effect.succeed(commentToolRejected(COMMENT_TOOL_REFUSAL.UNAVAILABLE))),
  );
}

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

export function runAgentShowImage(
  admitted: AdmittedConversation,
  input: UnparsedWireValue,
  sandbox: InboxSandboxDoor,
): Effect.Effect<WireRecord, never, DatabaseServices> {
  return runShowImage({ target: admitted.target, sandbox, checkout: CODER.CHECKOUT_PATH }, input);
}

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
    const sender = found.success;
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
