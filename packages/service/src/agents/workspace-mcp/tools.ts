import type { DatabaseServices, StoreFailure } from "@repo/database/core/query";
import {
  type Agent,
  reserveTurnDescriptionNotes,
  settleTurnDescriptionNotes,
} from "@repo/database/models/agent-store";
import { AGENT_MACHINE } from "@repo/features/agent-wire";
import { INBOX_TOOL } from "@repo/features/inbox-wire";
import { pictureTypeSchema } from "@repo/features/picture-wire";
import { ACTION_RESULT_STATUS, type UnparsedWireValue, unparsedWire } from "@repo/wire";
import { emitJsonSchema } from "@repo/wire/effect";
import { Effect, Exit, Option, Schema } from "effect";
import type { HttpClient } from "effect/http";
import type { HostedEnvironment } from "../../environment.js";
import type { GitHubApp } from "../../github/github-app.js";
import { logStoreFailure } from "../../http/store-failure.js";
import type { IntegrationConnect } from "../../integrations/integration-connect.js";
import type { ModelCatalog } from "../../providers/model-catalog.js";
import {
  type CommentToolName,
  READ_COMMENTS_TOOL,
  REPLY_TO_COMMENT_TOOL,
  UPDATE_COMMENT_TOOL,
} from "../../tasks/comment-tools.js";
import { CODER_SHOW_PAGE_TOOL } from "../../tasks/page-tool.js";
import {
  LOOK_AT_PICTURE_TOOL,
  lookNamedOnly,
  PICTURE_LOOK_STATUS,
} from "../../tasks/picture-look.js";
import type { SentryApp } from "../../triggers/sentry/sentry-app-config.js";
import {
  CODER_READ_AGENT_TOOL,
  LIST_AGENTS_TOOL,
  LIST_MODELS_TOOL,
  LIST_TASKS_TOOL,
  READ_PAGE_TOOL,
  START_AGENT_TOOL,
  STOP_AGENT_TOOL,
  UPDATE_AGENT_TOOL,
  UPDATE_TASK_TOOL,
} from "../agent-tools.js";
import {
  CREATE_AUTOMATION_TOOL,
  DELETE_AUTOMATION_TOOL,
  LIST_AUTOMATIONS_TOOL,
  RUN_AUTOMATION_TOOL,
  UPDATE_AUTOMATION_TOOL,
} from "../automation-tools.js";
import type { AgentBrowser } from "../browser/agent-browser.js";
import {
  BROWSER_TOOL,
  BROWSER_TOOL_REFUSAL,
  browserModelOutput,
  browserNotRun,
  runBrowserTool,
  storedBrowserOutput,
} from "../browser/browser-tool.js";
import {
  type AgentDoorSeams,
  type AgentToolCall,
  runAgentComment,
  runAgentEditDescription,
  runAgentLookAtPicture,
  runAgentOpenPullRequest,
  runAgentShowImage,
  runAgentShowPage,
  runAgentTools,
} from "../coder-host/agent-doors.js";
import { MESSAGE_AGENT_TOOL } from "../coder-host/agent-message.js";
import { INBOX_TOOLS } from "../coder-host/inbox.js";
import { runAgentInbox } from "../coder-host/inbox-door.js";
import type { InboxSandboxDoor } from "../coder-host/inbox-image.js";
import {
  EDIT_DESCRIPTION_TOOL,
  DESCRIPTION_EDIT_REFUSAL,
  descriptionEditRejected,
  requestedNotes,
} from "../coder-host/description-edit.js";
import { OPEN_PULL_REQUEST_TOOL } from "../coder-host/pull-request.js";
import { SHOW_IMAGE_TOOL } from "../coder-host/show-image.js";
import {
  CODER_TOOL,
  machineToolsOf,
  macToolsOf,
  type OfferedBeside,
  repositoryToolsOf,
} from "../coder-host/tool-set.js";
import type { AdmittedConversation } from "../eve-host/conversation.js";
import { RUN_ON_MAC_TOOL, runOnMacTool } from "../mac-command.js";
import { SAVE_MEMORY_TOOL, SEARCH_MEMORY_TOOL } from "../memory-tools.js";
import { CREATE_SECTION_TOOL, DELETE_SECTION_TOOL } from "../task-section-tools.js";
import { CREATE_TASK_TOOL, READ_TASK_TOOL } from "../task-tools.js";

export type WorkspaceMcpToolResult = { readonly status?: string } & object;

export type WorkspaceMcpServices =
  | DatabaseServices
  | HttpClient.HttpClient
  | GitHubApp
  | ModelCatalog
  | IntegrationConnect
  | HostedEnvironment
  | SentryApp;

type WorkspaceMcpToolServices = WorkspaceMcpServices | AgentBrowser;

interface WorkspaceMcpCallContext {
  readonly sandbox: InboxSandboxDoor;
  readonly callKey: Effect.Effect<string, StoreFailure, DatabaseServices>;
  readonly seams: AgentDoorSeams;
}

export type McpContent =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image" | "audio"; readonly data: string; readonly mimeType: string };

export interface WorkspaceMcpTool {
  readonly description: string;
  readonly inputSchema: object;
  readonly run: (
    admitted: AdmittedConversation,
    input: UnparsedWireValue,
    context: WorkspaceMcpCallContext,
  ) => Effect.Effect<WorkspaceMcpToolResult, unknown, WorkspaceMcpToolServices>;
  readonly content?: (result: WorkspaceMcpToolResult) => readonly McpContent[];
}

interface ToolSpec {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Schema.Top;
}

function entry(
  spec: ToolSpec,
  run: WorkspaceMcpTool["run"],
  content?: WorkspaceMcpTool["content"],
): readonly [string, WorkspaceMcpTool] {
  return entryOf(spec.name, spec.description, emitJsonSchema(spec.inputSchema), run, content);
}

function entryOf(
  name: string,
  description: string,
  inputSchema: object,
  run: WorkspaceMcpTool["run"],
  content?: WorkspaceMcpTool["content"],
): readonly [string, WorkspaceMcpTool] {
  const tool: WorkspaceMcpTool = {
    description,
    inputSchema,
    run,
    ...(content === undefined ? {} : { content }),
  };
  return [name, tool];
}

function agentTool(spec: ToolSpec & { readonly name: AgentToolCall["tool"] }) {
  return entry(spec, (admitted, input, { seams, callKey }) =>
    Effect.flatMap(callKey, (callId) =>
      runAgentTools(seams, admitted, { tool: spec.name, input, callId }),
    ),
  );
}

function commentTool(spec: ToolSpec & { readonly name: CommentToolName }) {
  return entry(spec, (admitted, input) => runAgentComment(admitted, spec.name, input));
}

const isLooked = Schema.is(
  Schema.Struct({
    status: Schema.Literal(PICTURE_LOOK_STATUS.LOOKED),
    image: Schema.String,
    mediaType: pictureTypeSchema,
  }),
);

const LOOKED_TEXT: McpContent = {
  type: "text",
  text: JSON.stringify({ status: PICTURE_LOOK_STATUS.LOOKED }),
};

function lookedPictureContent(result: WorkspaceMcpToolResult): readonly McpContent[] {
  if (isLooked(result)) {
    return [LOOKED_TEXT, { type: "image", data: result.image, mimeType: result.mediaType }];
  }
  return [{ type: "text", text: JSON.stringify(lookNamedOnly(unparsedWire(result))) }];
}

function browserContent(result: WorkspaceMcpToolResult): readonly McpContent[] {
  const output = unparsedWire(result);
  const shown = browserModelOutput(output);
  const text: McpContent = { type: "text", text: JSON.stringify(storedBrowserOutput(output)) };
  if (shown.type !== "content") return [text];
  const images = shown.value.flatMap((part): readonly McpContent[] =>
    part.type === "file" && part.data.type === "data" && typeof part.data.data === "string"
      ? [{ type: "image", data: part.data.data, mimeType: part.mediaType }]
      : [],
  );
  return [text, ...images];
}

function runAgentBrowser(admitted: AdmittedConversation, input: UnparsedWireValue) {
  const session = admitted.runtimeSessionId;
  if (session === undefined) return Effect.succeed(browserNotRun(BROWSER_TOOL_REFUSAL.NO_SANDBOX));
  const call = {
    browserSession: session,
    conversationId: admitted.target.conversationId,
    transcript: admitted.target,
    openSandbox: () => Promise.resolve(),
  };
  return runBrowserTool(call, input);
}

function runTurnCappedEditDescription(
  admitted: AdmittedConversation,
  input: UnparsedWireValue,
  sandbox: InboxSandboxDoor,
) {
  const { userId, conversationId } = admitted.target;
  const requested = requestedNotes(input);
  return Effect.acquireUseRelease(
    reserveTurnDescriptionNotes(userId, conversationId, requested),
    (turn) => {
      if (Option.isSome(turn)) {
        return runAgentEditDescription(admitted, input, turn.value.taken - requested, sandbox);
      }
      return requested > 0
        ? Effect.succeed(descriptionEditRejected(DESCRIPTION_EDIT_REFUSAL.NO_TURN))
        : runAgentEditDescription(admitted, input, 0, sandbox);
    },
    (turn, exit) => {
      if (Option.isNone(turn)) return Effect.void;
      const answer = Exit.isSuccess(exit) ? exit.value : undefined;
      const saved = answer?.status === ACTION_RESULT_STATUS.ACCEPTED ? answer.taken : 0;
      return settleTurnDescriptionNotes(userId, turn.value.turnId, requested, saved).pipe(
        Effect.tapError(logStoreFailure),
        Effect.ignore,
      );
    },
  ).pipe(
    Effect.tapError(logStoreFailure),
    Effect.catch(() =>
      Effect.succeed(descriptionEditRejected(DESCRIPTION_EDIT_REFUSAL.UNAVAILABLE)),
    ),
  );
}

export const WORKSPACE_MCP_TOOLS: ReadonlyMap<string, WorkspaceMcpTool> = new Map<
  string,
  WorkspaceMcpTool
>([
  entry(INBOX_TOOLS.POST, (admitted, input, { sandbox }) =>
    runAgentInbox(admitted, { tool: INBOX_TOOL.POST, input, sandbox }),
  ),
  entry(INBOX_TOOLS.READ, (admitted, input) =>
    runAgentInbox(admitted, { tool: INBOX_TOOL.READ, input }),
  ),
  entry(INBOX_TOOLS.WITHDRAW, (admitted, input) =>
    runAgentInbox(admitted, { tool: INBOX_TOOL.WITHDRAW, input }),
  ),
  entry(OPEN_PULL_REQUEST_TOOL, (admitted, input) => runAgentOpenPullRequest(admitted, input)),
  entry(EDIT_DESCRIPTION_TOOL, (admitted, input, { sandbox }) =>
    runTurnCappedEditDescription(admitted, input, sandbox),
  ),
  entry(
    LOOK_AT_PICTURE_TOOL,
    (admitted, input) => runAgentLookAtPicture(admitted, input),
    lookedPictureContent,
  ),
  entry(SHOW_IMAGE_TOOL, (admitted, input, { sandbox }) =>
    runAgentShowImage(admitted, input, sandbox),
  ),
  entry(CODER_SHOW_PAGE_TOOL, (admitted, input, { sandbox }) =>
    runAgentShowPage(admitted, input, sandbox),
  ),
  agentTool(READ_PAGE_TOOL),
  agentTool(START_AGENT_TOOL),
  agentTool(STOP_AGENT_TOOL),
  agentTool(LIST_AGENTS_TOOL),
  agentTool(CODER_READ_AGENT_TOOL),
  agentTool(MESSAGE_AGENT_TOOL),
  agentTool(UPDATE_AGENT_TOOL),
  agentTool(LIST_MODELS_TOOL),
  agentTool(LIST_TASKS_TOOL),
  agentTool(READ_TASK_TOOL),
  agentTool(CREATE_TASK_TOOL),
  agentTool(UPDATE_TASK_TOOL),
  agentTool(CREATE_SECTION_TOOL),
  agentTool(DELETE_SECTION_TOOL),
  agentTool(LIST_AUTOMATIONS_TOOL),
  agentTool(CREATE_AUTOMATION_TOOL),
  agentTool(UPDATE_AUTOMATION_TOOL),
  agentTool(DELETE_AUTOMATION_TOOL),
  agentTool(RUN_AUTOMATION_TOOL),
  agentTool(SAVE_MEMORY_TOOL),
  agentTool(SEARCH_MEMORY_TOOL),
  commentTool(READ_COMMENTS_TOOL),
  commentTool(REPLY_TO_COMMENT_TOOL),
  commentTool(UPDATE_COMMENT_TOOL),
  entry(RUN_ON_MAC_TOOL, (admitted, input) => runOnMacTool(admitted.target, input)),
  entry(BROWSER_TOOL, runAgentBrowser, browserContent),
]);

export type WorkspaceMcpOfferedTo = Pick<Agent, "repository" | "machine">;

const MEMORY_TOOLS: readonly string[] = [CODER_TOOL.SAVE_MEMORY, CODER_TOOL.SEARCH_MEMORY];

const DESCRIPTION_TOOLS: readonly string[] = [
  CODER_TOOL.EDIT_DESCRIPTION,
  CODER_TOOL.LOOK_AT_PICTURE,
];

const NARROWED_TOOLS: ReadonlySet<string> = new Set<string>([
  ...MEMORY_TOOLS,
  ...DESCRIPTION_TOOLS,
  ...repositoryToolsOf({ repository: "any" }),
  ...machineToolsOf({ machine: AGENT_MACHINE.VERCEL }),
  ...macToolsOf({ machine: AGENT_MACHINE.VERCEL }),
]);

export function offeredWorkspaceMcpTool(
  agent: WorkspaceMcpOfferedTo,
  beside: OfferedBeside,
): (name: string) => boolean {
  const offered: ReadonlySet<string> = new Set<string>([
    ...(beside.memoryOn ? MEMORY_TOOLS : []),
    ...(beside.descriptionsOn ? DESCRIPTION_TOOLS : []),
    ...repositoryToolsOf(agent),
    ...machineToolsOf(agent),
    ...macToolsOf(agent),
  ]);
  return (name) => !NARROWED_TOOLS.has(name) || offered.has(name);
}

const NOT_DONE_PREFIX = "not-";

const REFUSED_STATUSES: ReadonlySet<string> = new Set([
  ACTION_RESULT_STATUS.REJECTED,
  ACTION_RESULT_STATUS.UNSUPPORTED,
]);

export function refusedByDoor(result: WorkspaceMcpToolResult): boolean {
  const { status } = result;
  return (
    status !== undefined && (REFUSED_STATUSES.has(status) || status.startsWith(NOT_DONE_PREFIX))
  );
}
