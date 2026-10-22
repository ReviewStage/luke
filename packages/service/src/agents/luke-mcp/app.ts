/**
 * app.ts -- Luke's MCP server: the tools that touch Luke, served to a native harness's agent over streamable HTTP under its runner's bearer.
 *
 * Claude Code (`mcp__luke__<tool>`) and Codex (`mcp_servers.luke`) both reach
 * it as a standard MCP server: JSON-RPC 2.0 over streamable HTTP, each
 * request one POST answered with one JSON body. It keeps no session: every
 * POST carries the runner's bearer and is admitted on it alone
 * (`bearer.ts`), so no `Mcp-Session-Id` is handed out, a GET opens no
 * stream, and a DELETE has nothing to end; both answer 405, as the
 * transport allows a server that offers neither. A bearer no standing
 * conversation holds is refused with 401 before the body is read.
 *
 * The server is written here rather than on the MCP SDK's server, whose
 * request handlers answer promises: each door is an effect, and running one
 * inside a promise handler would put a runner outside the runtime edges. It
 * speaks only what the tools need, `initialize`, `ping`, `tools/list`, and
 * `tools/call`, as the hand-written client of the same protocol does
 * (`../../integrations/mcp-tools.ts`); its tests drive it with the SDK's
 * own client, the one a harness speaks.
 *
 * A protocol fault, a body that is no JSON-RPC, an unknown method, or a
 * tool the registry does not hold, is a JSON-RPC error. A tool's own
 * refusal, or a door that failed, is the tool's result marked `isError`,
 * which the agent reads as it reads any tool's answer.
 */

import { randomUUID } from "node:crypto";
import { LUKE_TOOL_RESULT } from "@luke/agent-runner/protocol";
import { readCodingAgentOfConversation } from "@luke/database/models/coding-agent-store";
import { CODING_AGENT_KIND } from "@luke/features/coding-agent-wire";
import { MAC_COMMAND_BOUNDS } from "@luke/features/mac-command-wire";
import { failureKind } from "@luke/runtime/effect";
import { EXCESS_KEYS, isRecord, type UnparsedWireValue } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Effect, Layer, Option, Result, Schema } from "effect";
import { type HttpClient, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { HOSTED_HTTP_STATUS } from "../../http/http.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedNotFoundRoute,
  hostedRefusing,
  hostedStoreOrUnavailable,
  parseJsonBytes,
  readBodyBytesEffect,
} from "../../http/http-effect.js";
import { ANY_METHOD, type WebRoutes } from "../../route.js";
import type { AdmittedConversation } from "../brain-host/conversation.js";
import type { AgentBrowser } from "../browser/agent-browser.js";
import { admitRunnerBearer, presentedBearer } from "./bearer.js";
import { lukeMcpDoorSeams } from "./door-seams.js";
import type { AgentSandboxDoors } from "./sandbox-door.js";
import {
  LUKE_MCP_TOOLS,
  type LukeMcpOfferedTo,
  type LukeMcpServices,
  type LukeMcpTool,
  type LukeMcpToolResult,
  type McpContent,
  offeredLukeMcpTool,
  refusedByDoor,
} from "./tools.js";

/** The path a runner's MCP client posts to. */
export const LUKE_MCP_PATH = "/api/agents/mcp";

/** The function the server is deployed as. */
export const LUKE_MCP_FUNCTION = {
  /** The duration its bundle declares: the longest `run_on_mac` a call may wait on, and two minutes for the store and the Mac's answer around it. */
  MAX_DURATION_SECONDS: MAC_COMMAND_BOUNDS.MAX_TIMEOUT_SECONDS + 120,
} as const;

/**
 * The protocol versions the server speaks, newest first: the ones that
 * define streamable HTTP. `initialize` answers the client's own where it is
 * one of these, and the newest otherwise, which the client then accepts or
 * leaves.
 */
export const LUKE_MCP_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"] as const;

/** How the server names itself to a client. */
const SERVER_INFO = { name: "luke", version: "1.0.0" } as const;

/** The most a request body may hold: past every tool input's own bound, and under the platform's. */
const MAX_BODY_BYTES = 4 * 1024 * 1024;

const HTTP_METHOD = { POST: "POST" } as const;

/** The header a client names the negotiated protocol version in, on every request after `initialize`. */
const PROTOCOL_VERSION_HEADER = "mcp-protocol-version";

const JSON_RPC_VERSION = "2.0";

/** JSON-RPC's own error codes, as MCP uses them. */
const JSON_RPC_ERROR = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

const MCP_METHOD = {
  INITIALIZE: "initialize",
  PING: "ping",
  TOOLS_LIST: "tools/list",
  TOOLS_CALL: "tools/call",
} as const;

/** What a tool call answers where its door failed rather than refused, which names nothing of the failure. */
const DOOR_FAILED = "Luke could not run this tool just now; try again in a moment.";

const IdSchema = Schema.Union([Schema.String, Schema.Number]);
const ParamsSchema = Schema.Record(Schema.String, Schema.Unknown);

/** One JSON-RPC message a client sends: a request (an id and a method), a notification (a method alone), or its answer to a request of the server's (an id alone). */
const MessageSchema = Schema.Struct({
  jsonrpc: Schema.Literal(JSON_RPC_VERSION),
  id: Schema.optionalKey(IdSchema),
  method: Schema.optionalKey(Schema.String),
  params: Schema.optionalKey(ParamsSchema),
});
type Message = typeof MessageSchema.Type;
type RequestId = typeof IdSchema.Type;

const InitializeParamsSchema = Schema.Struct({ protocolVersion: Schema.String });

const CallParamsSchema = Schema.Struct({
  name: Schema.String,
  arguments: Schema.optionalKey(ParamsSchema),
});

/** A protocol message is read for the keys the server acts on: MCP lets a client send more (`_meta`, `capabilities`, …). */
const DROPPING_EXCESS = { excess: EXCESS_KEYS.DROP } as const;

/** A JSON-RPC error as the answer carries it. */
interface RpcError {
  readonly code: number;
  readonly message: string;
}

type RpcAnswer = Result.Result<object, RpcError>;

/** One field of a record as it arrived, unparsed; nothing where the value is no record or holds none. */
function fieldOf(value: UnparsedWireValue, field: string): UnparsedWireValue {
  return isRecord(value) ? value[field] : undefined;
}

/** The answer to a request, as its JSON-RPC response. */
function rpcResponse(
  id: RequestId | null,
  answer: RpcAnswer,
): HttpServerResponse.HttpServerResponse {
  const body = Result.isSuccess(answer)
    ? { jsonrpc: JSON_RPC_VERSION, id, result: answer.success }
    : { jsonrpc: JSON_RPC_VERSION, id, error: answer.failure };
  return HttpServerResponse.jsonUnsafe(body, {
    status:
      Result.isSuccess(answer) || id !== null
        ? HOSTED_HTTP_STATUS.OK
        : HOSTED_HTTP_STATUS.BAD_REQUEST,
    headers: { "cache-control": "no-store" },
  });
}

function rpcFailure(code: number, message: string): RpcAnswer {
  return Result.fail({ code, message });
}

/** The protocol version `initialize` answers: the client's own where the server speaks it, else the newest. */
function negotiatedVersion(asked: string): string {
  return (
    LUKE_MCP_PROTOCOL_VERSIONS.find((version) => version === asked) ?? LUKE_MCP_PROTOCOL_VERSIONS[0]
  );
}

/** Whether a request names a protocol version the server does not speak; one naming none is taken as the transport's default. */
function unspokenVersion(request: Request): boolean {
  const named = request.headers.get(PROTOCOL_VERSION_HEADER);
  return named !== null && !LUKE_MCP_PROTOCOL_VERSIONS.some((version) => version === named);
}

/** MCP's result of a tool call: what the tool answered, as content blocks, and whether it is the tool's own error. */
interface McpToolCallResult {
  readonly content: readonly McpContent[];
  readonly isError: boolean;
}

/** What a result cut to its bound says in the place of what it left out. */
function cutMarker(leftOut: number): string {
  return `\n… ${leftOut} characters of this result were left out here …\n`;
}

/** A text cut to the characters given: its first and last characters, and between them the count left out. */
function cutText(text: string, budget: number): string {
  const marker = cutMarker(text.length - budget);
  const kept = Math.max(0, budget - marker.length);
  const head = Math.ceil(kept / 2);
  return `${text.slice(0, head)}${marker}${text.slice(text.length - (kept - head))}`;
}

/**
 * A result's content bounded as the harness takes it whole
 * (`LUKE_TOOL_RESULT`): its text blocks kept in order while they fit the
 * bound together, the one that overflows cut to what is left of it, and
 * any after it dropped; a picture kept wherever it stands, since the
 * harness holds those to its own token bound. Note that eve's own tools
 * bound what they answer, so a result past the bound is cut here rather
 * than saved to a file the agent must read back.
 */
function boundedContent(content: readonly McpContent[]): readonly McpContent[] {
  let left: number = LUKE_TOOL_RESULT.MAX_CHARS;
  return content.flatMap((block): readonly McpContent[] => {
    if (block.type !== "text") return [block];
    if (block.text.length <= left) {
      left -= block.text.length;
      return [block];
    }
    if (left <= 0) return [];
    const text = cutText(block.text, left);
    left = 0;
    return [{ type: "text", text }];
  });
}

/** A door's result as MCP's tool result: as the tool shows it (a picture as an image), else its JSON as one text block, bounded, and marked an error where the door refused. */
function toolResult(tool: LukeMcpTool, result: LukeMcpToolResult): McpToolCallResult {
  return {
    content: boundedContent(
      tool.content?.(result) ?? [{ type: "text", text: JSON.stringify(result) }],
    ),
    isError: refusedByDoor(result),
  };
}

/** What each listed tool declares to the harness: the most of its result Claude Code is to take whole rather than save to a file. */
const TOOL_META = { "anthropic/maxResultSizeChars": LUKE_TOOL_RESULT.MAX_CHARS } as const;

/** What an agent whose row is gone is offered by: no task, no repository, and no operator's tools. */
const NO_AGENT_OFFERED: LukeMcpOfferedTo = {
  taskId: null,
  repository: null,
  kind: CODING_AGENT_KIND.CODER,
};

/** The tool result where the door failed rather than refused. */
const DOOR_FAILED_RESULT: McpToolCallResult = {
  content: [{ type: "text", text: DOOR_FAILED }],
  isError: true,
};

/** The doors to an admitted agent's sandbox, which the edge composes on its own runner (`sandbox-door.ts`). */
export type LukeMcpSandboxDoor = (admitted: AdmittedConversation) => AgentSandboxDoors;

/** The agent's browser as the edge composes it (`../browser/agent-browser.ts`'s `agentBrowserServices`), over the runtime's HTTP client. */
export type LukeMcpBrowser = Layer.Layer<AgentBrowser, never, HttpClient.HttpClient>;

/** What the server is composed over: the doors to the agent's sandbox, and its browser. */
export interface LukeMcpDoors {
  readonly sandbox: LukeMcpSandboxDoor;
  readonly browser: LukeMcpBrowser;
}

/** One `tools/call` run through the tool's door as the admitted conversation, with a fresh id of its own. */
function callTool(
  doors: LukeMcpDoors,
  admitted: AdmittedConversation,
  params: UnparsedWireValue,
): Effect.Effect<RpcAnswer, never, LukeMcpServices> {
  const call = readEither(CallParamsSchema, DROPPING_EXCESS)(params);
  if (Result.isFailure(call)) {
    return Effect.succeed(rpcFailure(JSON_RPC_ERROR.INVALID_PARAMS, "Invalid tools/call params"));
  }
  const { name } = call.success;
  const tool = LUKE_MCP_TOOLS.get(name);
  if (tool === undefined) {
    return Effect.succeed(rpcFailure(JSON_RPC_ERROR.INVALID_PARAMS, `Unknown tool: ${name}`));
  }
  const input = fieldOf(params, "arguments") ?? {};
  return Effect.flatMap(lukeMcpDoorSeams, (seams) => {
    const sandbox = doors.sandbox(admitted);
    const context = {
      sandbox: sandbox.files,
      repository: sandbox.repository,
      callId: randomUUID(),
      seams,
    };
    return tool.run(admitted, input, context);
  }).pipe(
    Effect.provide(doors.browser),
    Effect.map((result) => Result.succeed(toolResult(tool, result))),
    Effect.catchCause((cause) =>
      Effect.as(
        Effect.logWarning(`Luke MCP tool ${name} failed: ${failureKind(cause)}`),
        Result.succeed(DOOR_FAILED_RESULT),
      ),
    ),
  );
}

/**
 * The tools listed to the admitted agent: those eve offers it, by its task,
 * its repository, and its kind (`offeredLukeMcpTool`); those eve offers
 * every agent where its row is gone, since no narrowed tool's door would
 * carry out a call for an agent that no longer stands.
 */
function listTools(
  admitted: AdmittedConversation,
): Effect.Effect<RpcAnswer, never, LukeMcpServices> {
  const { userId, conversationId } = admitted.target;
  return readCodingAgentOfConversation(userId, conversationId).pipe(
    Effect.map((found) => {
      const offered = offeredLukeMcpTool(Option.getOrElse(found, () => NO_AGENT_OFFERED));
      const tools = [...LUKE_MCP_TOOLS]
        .filter(([name]) => offered(name))
        .map(([name, tool]) => ({
          name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          _meta: TOOL_META,
        }));
      return Result.succeed({ tools });
    }),
    Effect.catchCause((cause) =>
      Effect.as(
        Effect.logWarning(`Luke MCP tools/list failed: ${failureKind(cause)}`),
        rpcFailure(JSON_RPC_ERROR.INTERNAL_ERROR, "Luke could not list its tools just now"),
      ),
    ),
  );
}

/** One request's answer, by its method. */
function answerRequest(
  doors: LukeMcpDoors,
  admitted: AdmittedConversation,
  method: string,
  params: UnparsedWireValue,
): Effect.Effect<RpcAnswer, never, LukeMcpServices> {
  switch (method) {
    case MCP_METHOD.INITIALIZE: {
      const asked = readEither(InitializeParamsSchema, DROPPING_EXCESS)(params);
      if (Result.isFailure(asked)) {
        return Effect.succeed(
          rpcFailure(JSON_RPC_ERROR.INVALID_PARAMS, "Invalid initialize params"),
        );
      }
      return Effect.succeed(
        Result.succeed({
          protocolVersion: negotiatedVersion(asked.success.protocolVersion),
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
        }),
      );
    }
    case MCP_METHOD.PING:
      return Effect.succeed(Result.succeed({}));
    case MCP_METHOD.TOOLS_LIST:
      return listTools(admitted);
    case MCP_METHOD.TOOLS_CALL:
      return callTool(doors, admitted, params);
    default:
      return Effect.succeed(
        rpcFailure(JSON_RPC_ERROR.METHOD_NOT_FOUND, `Method not found: ${method}`),
      );
  }
}

/** One message answered: a request with its response, anything else taken with 202 and no body. */
function answerMessage(
  doors: LukeMcpDoors,
  admitted: AdmittedConversation,
  message: Message,
  raw: UnparsedWireValue,
): Effect.Effect<HttpServerResponse.HttpServerResponse, never, LukeMcpServices> {
  const { id, method } = message;
  if (id === undefined || method === undefined) {
    return Effect.succeed(HttpServerResponse.empty({ status: HOSTED_HTTP_STATUS.ACCEPTED }));
  }
  return Effect.map(
    answerRequest(doors, admitted, method, fieldOf(raw, "params") ?? {}),
    (answer) => rpcResponse(id, answer),
  );
}

/** The refusal of a bearer, which names the scheme a client is to present, as RFC 6750 asks. */
function bearerRefused(): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.jsonUnsafe(HOSTED_REFUSAL.INVALID_TOKEN, {
    status: HOSTED_HTTP_STATUS.UNAUTHORIZED,
    headers: { "www-authenticate": 'Bearer realm="luke"' },
  });
}

/** POST: one JSON-RPC message, admitted on the runner's bearer. */
const mcpEndpoint = /* @__PURE__ */ Effect.fn("web/lukeMcpEndpoint")(function* (
  doors: LukeMcpDoors,
): Effect.fn.Return<
  HttpServerResponse.HttpServerResponse,
  HostedRefusal,
  HttpServerRequest.HttpServerRequest | LukeMcpServices
> {
  const incoming = yield* HttpServerRequest.HttpServerRequest;
  if (incoming.method !== HTTP_METHOD.POST) {
    return HttpServerResponse.empty({
      status: HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
      headers: { allow: HTTP_METHOD.POST },
    });
  }
  const request = yield* Effect.orDie(HttpServerRequest.toWeb(incoming));
  const bearer = presentedBearer(request);
  if (bearer === undefined) return bearerRefused();
  const admitted = yield* hostedStoreOrUnavailable(admitRunnerBearer(bearer));
  if (Option.isNone(admitted)) return bearerRefused();
  if (unspokenVersion(request)) {
    return rpcResponse(
      null,
      rpcFailure(JSON_RPC_ERROR.INVALID_REQUEST, "Unsupported MCP-Protocol-Version"),
    );
  }
  const parsed = yield* Effect.result(
    Effect.flatMap(readBodyBytesEffect(MAX_BODY_BYTES), parseJsonBytes),
  );
  if (Result.isFailure(parsed)) {
    if (parsed.failure.error !== HOSTED_REFUSAL.INVALID_REQUEST.error) {
      return yield* Effect.fail(parsed.failure);
    }
    return rpcResponse(null, rpcFailure(JSON_RPC_ERROR.PARSE_ERROR, "Parse error"));
  }
  const message = readEither(MessageSchema, DROPPING_EXCESS)(parsed.success);
  if (Result.isFailure(message)) {
    return rpcResponse(null, rpcFailure(JSON_RPC_ERROR.INVALID_REQUEST, "Invalid Request"));
  }
  return yield* answerMessage(doors, admitted.value, message.success, parsed.success);
});

/** The group: the one MCP path over the sandbox door and the browser the edge composes, and the hosted vocabulary's own refusal for any other. */
export function lukeMcpApp(doors: LukeMcpDoors): WebRoutes<LukeMcpServices> {
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, LUKE_MCP_PATH, hostedRefusing(mcpEndpoint(doors))),
    hostedNotFoundRoute,
  );
}
