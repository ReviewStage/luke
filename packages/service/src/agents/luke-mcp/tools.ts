/**
 * tools.ts -- the Luke tools a native harness's agent is served over MCP, each by its eve tool's own schema and door.
 *
 * A Claude Code or Codex agent keeps its harness's own shell, files, todos,
 * and subagents; what touches Luke reaches it as an MCP tool of Luke's own
 * server (`app.ts`). Each tool here is the one the agent's eve tool file
 * declares (`apps/dev/tools/<name>.ts`): the same name, the same description,
 * the same input schema, and the same door the coder host's method for it
 * runs (`../coder-host/inbox-door.ts` for the inbox, `../coder-host/agent-doors.ts`
 * for the rest), so the two runtimes run one implementation. A door is
 * reached directly rather than through the coder host, because the host
 * composes eve's sandbox and tools, which the web function serving this
 * server does not bundle. The registry maps a tool's name to those three,
 * and, for the one tool whose answer is a picture, how it is shown.
 *
 * Left out, beside the harness's own shell, files, todos, waiting,
 * subagents, skills, and web reads: the spoken-turn tools
 * (`queue_question`, `withdraw_question`, `end_call`), which only a spoken
 * turn of eve's offers. The integrations' `connection_search` and
 * `connection_execute` are eve's own built-in tools rather than tool files;
 * here they keep eve's names, words, and schemas, and run through Luke's own
 * door over the same grants (`../../integrations/connection-door.ts`).
 *
 * Two things eve's tool files keep in the session's own state have none
 * here, since the server keeps no session: a call's id, which the agent
 * tools key a start or a message on and chat a post, is minted for each
 * call; and the turn's count of plan notes and chat posts, which each call
 * starts from nothing, so those caps hold per call. Nor is the list
 * narrowed per agent as eve narrows its own at each turn: a tool eve would
 * not offer (no plan, no repository) is refused by its door.
 */

import type { DatabaseServices } from "@luke/database/core/query";
import { CHAT_TOOL } from "@luke/features/chat-wire";
import { INBOX_TOOL } from "@luke/features/inbox-wire";
import {
  ACTION_RESULT_STATUS,
  isRecord,
  type UnparsedWireValue,
  type WireValue,
  WireValueSchema,
} from "@luke/wire";
import { emitJsonSchema } from "@luke/wire/effect";
import { type Effect, Schema } from "effect";
import type { HttpClient } from "effect/http";
import type { HostedEnvironment } from "../../environment.js";
import type { GitHubApp } from "../../github/github-app.js";
import {
  CONNECTION_EXECUTE_TOOL,
  CONNECTION_SEARCH_TOOL,
  runConnectionExecute,
  runConnectionSearch,
} from "../../integrations/connection-door.js";
import type {
  IntegrationConnect,
  WorkspaceLinearConnect,
} from "../../integrations/integration-connect.js";
import type { ModelCatalog } from "../../providers/model-catalog.js";
import { LOOK_AT_BOARD_STATUS, LOOK_AT_BOARD_TOOL } from "../../tasks/board-look.js";
import { DRAW_ON_BOARD_TOOL } from "../../tasks/board-tool.js";
import {
  type CommentToolName,
  READ_COMMENTS_TOOL,
  REOPEN_THREAD_TOOL,
  REPLY_TO_COMMENT_TOOL,
  RESOLVE_THREAD_TOOL,
} from "../../tasks/comment-tools.js";
import { CODER_SHOW_PAGE_TOOL } from "../../tasks/page-tool.js";
import { LOOK_AT_PICTURE_TOOL, PICTURE_LOOK_STATUS } from "../../tasks/picture-look.js";
import { SHOW_CODE_TOOL } from "../../tasks/show-code.js";
import type { AdmittedConversation } from "../brain-host/conversation.js";
import {
  type AgentDoorSeams,
  type AgentToolCall,
  runAgentBoard,
  runAgentChat,
  runAgentComment,
  runAgentEditPlan,
  runAgentLookAtPicture,
  runAgentOpenPullRequest,
  runAgentShowCode,
  runAgentShowImage,
  runAgentShowPage,
  runAgentTools,
} from "../coder-host/agent-doors.js";
import { CHAT_TOOLS } from "../coder-host/chat.js";
import { INBOX_TOOLS } from "../coder-host/inbox.js";
import { runAgentInbox } from "../coder-host/inbox-door.js";
import type { InboxSandboxDoor } from "../coder-host/inbox-image.js";
import { EDIT_PLAN_TOOL } from "../coder-host/plan-edit.js";
import { OPEN_PULL_REQUEST_TOOL } from "../coder-host/pull-request.js";
import { SHOW_IMAGE_TOOL } from "../coder-host/show-image.js";
import { CODER_TOOL } from "../coder-host/tool-set.js";
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
} from "../coding-agent-tools.js";
import { RUN_ON_MAC_TOOL, runOnMacTool } from "../mac-command.js";
import type { RepositorySandboxDoor } from "../repository-shell.js";
import { CREATE_SECTION_TOOL, DELETE_SECTION_TOOL } from "../task-section-tools.js";
import { CREATE_TASK_TOOL, READ_TASK_TOOL } from "../task-tools.js";

/** What a door answers: the tool's own result, the value its eve tool hands the model. */
export type LukeMcpToolResult = { readonly status?: string } & object;

/** What the doors run against, every one of which a web function's runtime provides. */
export type LukeMcpServices =
  | DatabaseServices
  | HttpClient.HttpClient
  | GitHubApp
  | ModelCatalog
  | WorkspaceLinearConnect
  | IntegrationConnect
  | HostedEnvironment;

/** What a call carries beside its input: the doors to the agent's sandbox, where a tool reads a file the agent names by its path or `show_code` reads its checkout; a fresh id of its own; and the seams the doors that reach eve or the store's writer read. */
interface LukeMcpCallContext {
  readonly sandbox: InboxSandboxDoor;
  readonly repository: RepositorySandboxDoor;
  readonly callId: string;
  readonly seams: AgentDoorSeams;
}

/** One block of an MCP tool result: text, or an image or a sound as base64 with its type. */
export type McpContent =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image" | "audio"; readonly data: string; readonly mimeType: string };

/** One tool as the server offers and runs it. */
export interface LukeMcpTool {
  readonly description: string;
  /** The input schema as JSON Schema, emitted from the eve tool's own. */
  readonly inputSchema: object;
  /** Runs one call through the tool's door, as the agent's admitted conversation. */
  readonly run: (
    admitted: AdmittedConversation,
    input: UnparsedWireValue,
    context: LukeMcpCallContext,
  ) => Effect.Effect<LukeMcpToolResult, unknown, LukeMcpServices>;
  /** How a result is shown to the agent, where it is more than its JSON: a picture as an image. */
  readonly content?: (result: LukeMcpToolResult) => readonly McpContent[];
}

/** A tool as its eve file declares it: its name, its words, and its input schema. */
interface ToolSpec {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Schema.Top;
}

function entry(
  spec: ToolSpec,
  run: LukeMcpTool["run"],
  content?: LukeMcpTool["content"],
): readonly [string, LukeMcpTool] {
  return entryOf(spec.name, spec.description, emitJsonSchema(spec.inputSchema), run, content);
}

function entryOf(
  name: string,
  description: string,
  inputSchema: object,
  run: LukeMcpTool["run"],
  content?: LukeMcpTool["content"],
): readonly [string, LukeMcpTool] {
  const tool: LukeMcpTool = {
    description,
    inputSchema,
    run,
    ...(content === undefined ? {} : { content }),
  };
  return [name, tool];
}

/** A tool about the workspace's agents and tasks, run through their one door. */
function agentTool(spec: ToolSpec & { readonly name: AgentToolCall["tool"] }) {
  return entry(spec, (admitted, input, { seams, callId }) =>
    runAgentTools(seams, admitted, { tool: spec.name, input, callId }),
  );
}

/** A tool of the plan's comment threads, run through the comment door. */
function commentTool(spec: ToolSpec & { readonly name: CommentToolName }) {
  return entry(spec, (admitted, input) => runAgentComment(admitted, spec.name, input));
}

/** A look that answered a picture: its bytes as base64 and their type. */
const isLooked = Schema.is(
  Schema.Struct({
    status: Schema.Literal(PICTURE_LOOK_STATUS.LOOKED),
    image: Schema.String,
    mediaType: Schema.String,
  }),
);

/** A look at the whiteboard that answered its image, a PNG as base64. */
const isBoardLooked = Schema.is(
  Schema.Struct({ status: Schema.Literal(LOOK_AT_BOARD_STATUS.LOOKED), image: Schema.String }),
);

/** The type the whiteboard's image is drawn in (`../../tasks/board-look.ts`). */
const BOARD_IMAGE_TYPE = "image/png";

/**
 * A look's text block where it looked: its status alone, as JSON. Note that
 * the transcript keeps a Luke tool's text blocks alone
 * (`../native-events/claude-code-moments.ts`), so this is what a look is
 * stored as, the same as eve's relay stores one (`storedPictureLookOutput`).
 */
const LOOKED_TEXT: McpContent = {
  type: "text",
  text: JSON.stringify({ status: PICTURE_LOOK_STATUS.LOOKED }),
};

/** What the agent is shown of a look at the whiteboard: its status and its image, as an image, where it looked; its JSON otherwise. */
function lookedBoardContent(result: LukeMcpToolResult): readonly McpContent[] {
  if (isBoardLooked(result)) {
    return [LOOKED_TEXT, { type: "image", data: result.image, mimeType: BOARD_IMAGE_TYPE }];
  }
  return [{ type: "text", text: JSON.stringify(result) }];
}

/** What the agent is shown of a look: its status and the picture itself, as an image, where it looked; its JSON otherwise. */
function lookedPictureContent(result: LukeMcpToolResult): readonly McpContent[] {
  if (isLooked(result)) {
    return [LOOKED_TEXT, { type: "image", data: result.image, mimeType: result.mediaType }];
  }
  return [{ type: "text", text: JSON.stringify(result) }];
}

/** A connection call that ran, its tool's output kept as eve reads it. */
const isExecuted = Schema.is(
  Schema.Struct({ status: Schema.Literal(ACTION_RESULT_STATUS.ACCEPTED), output: WireValueSchema }),
);

/** One block of a provider tool's result as the agent is shown it, as eve's model output shows it: a text, a picture, or a sound, and a resource as its words. */
function remoteBlock(block: WireValue): readonly McpContent[] {
  if (!isRecord(block)) return [];
  const { type, text, data, mimeType } = block;
  if (type === "text" && typeof text === "string") return [{ type, text }];
  if ((type === "image" || type === "audio") && typeof data === "string") {
    return typeof mimeType === "string" ? [{ type, data, mimeType }] : [];
  }
  if (type === "resource" && isRecord(block.resource)) {
    const { uri, text: words, blob, mimeType: blobType } = block.resource;
    const named = typeof uri === "string" ? uri : undefined;
    if (typeof words === "string") {
      return [{ type: "text", text: named === undefined ? words : `${named}\n${words}` }];
    }
    if (typeof blob !== "string") return [];
    // Note that a picture or a sound a resource carries is shown as one, and any other bytes are named, so none is dropped unsaid.
    const kind = typeof blobType === "string" ? blobType : "application/octet-stream";
    if (kind.startsWith("image/")) return [{ type: "image", data: blob, mimeType: kind }];
    if (kind.startsWith("audio/")) return [{ type: "audio", data: blob, mimeType: kind }];
    return [
      { type: "text", text: `Resource: ${named ?? "resource"} (${kind}, binary, not shown)` },
    ];
  }
  if (type === "resource_link") {
    const name = typeof block.name === "string" ? block.name : "resource";
    const uri = typeof block.uri === "string" ? block.uri : "";
    return [{ type: "text", text: `Resource link: ${name} ${uri}`.trim() }];
  }
  return [];
}

/** What the agent is shown of a connection call: the tool's own content blocks where any is no text, its text, or its JSON; the refusal's JSON otherwise. */
function executedContent(result: LukeMcpToolResult): readonly McpContent[] {
  if (!isExecuted(result)) return [{ type: "text", text: JSON.stringify(result) }];
  const { output } = result;
  if (Array.isArray(output)) {
    const blocks = output.flatMap(remoteBlock);
    if (blocks.some((block) => block.type !== "text")) return blocks;
  }
  return [{ type: "text", text: typeof output === "string" ? output : JSON.stringify(output) }];
}

/** The tools served, by name, in the order `tools/list` names them. */
export const LUKE_MCP_TOOLS: ReadonlyMap<string, LukeMcpTool> = new Map<string, LukeMcpTool>([
  // The inbox.
  entry(INBOX_TOOLS.POST, (admitted, input, { sandbox }) =>
    runAgentInbox(admitted, { tool: INBOX_TOOL.POST, input, sandbox }),
  ),
  entry(INBOX_TOOLS.READ, (admitted, input) =>
    runAgentInbox(admitted, { tool: INBOX_TOOL.READ, input }),
  ),
  entry(INBOX_TOOLS.WITHDRAW, (admitted, input) =>
    runAgentInbox(admitted, { tool: INBOX_TOOL.WITHDRAW, input }),
  ),
  // The pull request, the plan, and pages and pictures.
  entry(OPEN_PULL_REQUEST_TOOL, (admitted, input) => runAgentOpenPullRequest(admitted, input)),
  entry(EDIT_PLAN_TOOL, (admitted, input, { sandbox }) =>
    runAgentEditPlan(admitted, input, 0, sandbox),
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
  entry(SHOW_CODE_TOOL, (admitted, input, { repository }) =>
    runAgentShowCode(admitted, input, repository),
  ),
  // The task's whiteboard.
  entry(DRAW_ON_BOARD_TOOL, (admitted, input) =>
    runAgentBoard(admitted, CODER_TOOL.DRAW_ON_BOARD, input),
  ),
  entry(
    LOOK_AT_BOARD_TOOL,
    (admitted, input) => runAgentBoard(admitted, CODER_TOOL.LOOK_AT_BOARD, input),
    lookedBoardContent,
  ),
  // The workspace's agents.
  agentTool(START_AGENT_TOOL),
  agentTool(STOP_AGENT_TOOL),
  agentTool(LIST_AGENTS_TOOL),
  agentTool(CODER_READ_AGENT_TOOL),
  agentTool(UPDATE_AGENT_TOOL),
  agentTool(LIST_MODELS_TOOL),
  // Tasks, sections, and issues.
  agentTool(LIST_TASKS_TOOL),
  agentTool(READ_TASK_TOOL),
  agentTool(CREATE_TASK_TOOL),
  agentTool(UPDATE_TASK_TOOL),
  agentTool(CREATE_SECTION_TOOL),
  agentTool(DELETE_SECTION_TOOL),
  // Chat.
  entry(CHAT_TOOLS.POST, (admitted, input, { seams, sandbox, callId }) =>
    runAgentChat(seams, admitted, {
      tool: CHAT_TOOL.POST,
      input,
      clientKey: callId,
      postsInTurn: 0,
      sandbox,
    }),
  ),
  entry(CHAT_TOOLS.READ, (admitted, input, { seams }) =>
    runAgentChat(seams, admitted, { tool: CHAT_TOOL.READ, input }),
  ),
  entry(CHAT_TOOLS.RESOLVE, (admitted, input, { seams }) =>
    runAgentChat(seams, admitted, { tool: CHAT_TOOL.RESOLVE, input }),
  ),
  entry(CHAT_TOOLS.EDIT_CHANNEL, (admitted, input, { seams }) =>
    runAgentChat(seams, admitted, { tool: CHAT_TOOL.EDIT_CHANNEL, input }),
  ),
  // The plan's comments.
  commentTool(READ_COMMENTS_TOOL),
  commentTool(REPLY_TO_COMMENT_TOOL),
  commentTool(RESOLVE_THREAD_TOOL),
  commentTool(REOPEN_THREAD_TOOL),
  // The developer's Mac.
  entry(RUN_ON_MAC_TOOL, (admitted, input) => runOnMacTool(admitted.target.userId, input)),
  // The integrations.
  entryOf(
    CONNECTION_SEARCH_TOOL.name,
    CONNECTION_SEARCH_TOOL.description,
    CONNECTION_SEARCH_TOOL.inputSchema,
    (admitted, input) => runConnectionSearch(admitted, input),
  ),
  entryOf(
    CONNECTION_EXECUTE_TOOL.name,
    CONNECTION_EXECUTE_TOOL.description,
    CONNECTION_EXECUTE_TOOL.inputSchema,
    (admitted, input) => runConnectionExecute(admitted, input),
    executedContent,
  ),
]);

/** The prefix of every status a door answers for a call it did not carry out (`not-run`, `not-looked`, `not-saved`, …). */
const NOT_DONE_PREFIX = "not-";

/** The statuses a door answers for a call it refused outright. */
const REFUSED_STATUSES: ReadonlySet<string> = new Set([
  ACTION_RESULT_STATUS.REJECTED,
  ACTION_RESULT_STATUS.UNSUPPORTED,
]);

/** Whether a door's answer is its refusal, which the server answers as a tool error the agent reads. */
export function refusedByDoor(result: LukeMcpToolResult): boolean {
  const { status } = result;
  return (
    status !== undefined && (REFUSED_STATUSES.has(status) || status.startsWith(NOT_DONE_PREFIX))
  );
}
