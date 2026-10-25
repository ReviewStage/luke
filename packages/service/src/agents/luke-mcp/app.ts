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
 * Beside it stands one server per integration the agent is handed, at
 * `LUKE_INTEGRATION_MCP_PATH/<connection>` (`notion-2` for a member's second
 * Notion account), on the same bearer and the same JSON-RPC: its
 * `initialize` tells the client what eve tells the model of the connection,
 * which account it is among them, as its `instructions`; its
 * `tools/list` is the provider's own tools, and its `tools/call` forwards to
 * the provider on the member's own grant and answers the provider's result
 * as it sent it (`../../integrations/connection-door.ts`). A harness names
 * each as a server of its own, so their tools reach the model under the
 * connection's name, as any remote MCP server's do, and the harness's own
 * tool search defers them.
 *
 * A protocol fault, a body that is no JSON-RPC, an unknown method, or a
 * tool the registry does not hold, is a JSON-RPC error. A tool's own
 * refusal, or a door that failed, is the tool's result marked `isError`,
 * which the agent reads as it reads any tool's answer.
 */

import { randomUUID } from "node:crypto";
import { readCodingAgentOfConversation } from "@luke/database/models/coding-agent-store";
import { CODING_AGENT_KIND, CODING_AGENT_MACHINE } from "@luke/features/coding-agent-wire";
import { integrationConnectionOf } from "@luke/features/integration-wire";
import { MAC_COMMAND_BOUNDS } from "@luke/features/mac-command-wire";
import { failureKind } from "@luke/runtime/effect";
import {
  EXCESS_KEYS,
  HTTP_METHOD,
  isRecord,
  type UnparsedWireValue,
  type WireRecord,
} from "@luke/wire";
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
import {
  type ConnectionRefusal,
  callConnectionTool,
  connectionInstructions,
  listConnectionTools,
} from "../../integrations/connection-door.js";
import type { McpToolSchema } from "../../integrations/mcp-tools.js";
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

/** The path under which each integration the agent is handed is a server of its own, named by its connection. */
export const LUKE_INTEGRATION_MCP_PATH = `${LUKE_MCP_PATH}/integrations`;

/** An integration server's address under an origin: the connection's name, the one path segment after `LUKE_INTEGRATION_MCP_PATH`. */
export function lukeIntegrationMcpUrl(origin: string, connection: string): string {
  return new URL(`${LUKE_INTEGRATION_MCP_PATH}/${encodeURIComponent(connection)}`, origin).href;
}

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

/** The version every server names itself with to a client. */
const SERVER_VERSION = "1.0.0";

/** The most a request body may hold: past every tool input's own bound, and under the platform's. */
const MAX_BODY_BYTES = 4 * 1024 * 1024;

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

/** A door's result as MCP's tool result: as the tool shows it (a picture as an image), else its JSON as one text block, marked an error where the door refused. */
function toolResult(tool: LukeMcpTool, result: LukeMcpToolResult): McpToolCallResult {
  return {
    content: tool.content?.(result) ?? [{ type: "text", text: JSON.stringify(result) }],
    isError: refusedByDoor(result),
  };
}

/**
 * What each listed tool declares to Claude Code: the most of its result it
 * takes whole, the pinned CLI's (2.1.304) own ceiling, where past 50,000
 * characters it would save the result to a file and hand the model a path
 * (code.claude.com/docs/en/mcp, "Raise the limit for a specific tool"). Eve
 * hands its model a Luke tool's whole result, which each door bounds.
 */
const TOOL_META = { "anthropic/maxResultSizeChars": 500_000 } as const;

/** What an agent whose row is gone is offered by: no task, no repository, and no operator's tools. */
const NO_AGENT_OFFERED: LukeMcpOfferedTo = {
  taskId: null,
  repository: null,
  kind: CODING_AGENT_KIND.CODER,
  machine: CODING_AGENT_MACHINE.VERCEL,
};

/** The tool result where the door failed rather than refused. */
const DOOR_FAILED_RESULT: McpToolCallResult = {
  content: [{ type: "text", text: DOOR_FAILED }],
  isError: true,
};

/** The doors to an admitted agent's sandbox, which the edge composes on its own runner (`sandbox-door.ts`). */
type LukeMcpSandboxDoor = (admitted: AdmittedConversation) => AgentSandboxDoors;

/** The agent's browser as the edge composes it (`../browser/agent-browser.ts`'s `agentBrowserServices`), over the runtime's HTTP client. */
export type LukeMcpBrowser = Layer.Layer<AgentBrowser, never, HttpClient.HttpClient>;

/** What the server is composed over: the doors to the agent's sandbox, and its browser. */
export interface LukeMcpDoors {
  readonly sandbox: LukeMcpSandboxDoor;
  readonly browser: LukeMcpBrowser;
}

/**
 * One MCP server as the endpoint answers it for an admitted agent: the name
 * it gives itself, its `tools/list`, and its `tools/call` on the call's
 * params; Luke's own, or one integration's.
 */
interface McpServer {
  readonly name: string;
  /** What `initialize` tells the client of the server, which the harness shows the model; none for Luke's own, whose tools say it. */
  readonly instructions: (
    admitted: AdmittedConversation,
  ) => Effect.Effect<Option.Option<string>, never, LukeMcpServices>;
  readonly listTools: (
    admitted: AdmittedConversation,
  ) => Effect.Effect<RpcAnswer, never, LukeMcpServices>;
  readonly callTool: (
    admitted: AdmittedConversation,
    params: UnparsedWireValue,
  ) => Effect.Effect<RpcAnswer, never, LukeMcpServices>;
}

/** One `tools/call` run through the tool's door as the admitted conversation, with a fresh id of its own. */
function callLukeTool(
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
function listLukeTools(
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

/** Luke's own server, over the doors the edge composes. */
function lukeServer(doors: LukeMcpDoors): McpServer {
  return {
    name: "luke",
    instructions: () => Effect.succeedNone,
    listTools: listLukeTools,
    callTool: (admitted, params) => callLukeTool(doors, admitted, params),
  };
}

/** The input schema a provider's tool is listed with where it declared none an MCP client takes: any object. */
const ANY_OBJECT_SCHEMA = { type: "object" } as const;

/** A provider's tool as its integration's server lists it: as the provider listed it, with an object input schema, as MCP requires. */
function listedIntegrationTool(tool: McpToolSchema) {
  return {
    name: tool.name,
    ...(tool.title !== undefined ? { title: tool.title } : undefined),
    ...(tool.description !== undefined ? { description: tool.description } : undefined),
    inputSchema: isRecord(tool.inputSchema) ? tool.inputSchema : ANY_OBJECT_SCHEMA,
    ...(isRecord(tool.outputSchema) ? { outputSchema: tool.outputSchema } : undefined),
    ...(tool.annotations !== undefined ? { annotations: tool.annotations } : undefined),
  };
}

/** A refusal of an integration's call as the tool's error the agent reads: the refusal's JSON, `requiresSignIn` among it where the member must connect. */
function refusedCall(refusal: ConnectionRefusal): WireRecord {
  return { content: [{ type: "text", text: JSON.stringify(refusal) }], isError: true };
}

/** One integration's server, named by its connection. */
function integrationServer(connection: string): McpServer {
  return {
    name: connection,
    instructions: (admitted) => connectionInstructions(admitted, connection),
    listTools: (admitted) =>
      Effect.map(listConnectionTools(admitted, connection), (tools) =>
        Result.succeed({ tools: tools.map(listedIntegrationTool) }),
      ),
    callTool: (admitted, params) => {
      const call = readEither(CallParamsSchema, DROPPING_EXCESS)(params);
      if (Result.isFailure(call)) {
        return Effect.succeed(
          rpcFailure(JSON_RPC_ERROR.INVALID_PARAMS, "Invalid tools/call params"),
        );
      }
      const input = fieldOf(params, "arguments");
      return Effect.map(
        callConnectionTool(admitted, connection, call.success.name, isRecord(input) ? input : {}),
        (answered) =>
          Result.succeed(
            Result.isSuccess(answered) ? answered.success : refusedCall(answered.failure),
          ),
      );
    },
  };
}

/** One request's answer, by its method. */
function answerRequest(
  server: McpServer,
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
      return Effect.map(server.instructions(admitted), (instructions) =>
        Result.succeed({
          protocolVersion: negotiatedVersion(asked.success.protocolVersion),
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: server.name, version: SERVER_VERSION },
          ...(Option.isSome(instructions) ? { instructions: instructions.value } : undefined),
        }),
      );
    }
    case MCP_METHOD.PING:
      return Effect.succeed(Result.succeed({}));
    case MCP_METHOD.TOOLS_LIST:
      return server.listTools(admitted);
    case MCP_METHOD.TOOLS_CALL:
      return server.callTool(admitted, params);
    default:
      return Effect.succeed(
        rpcFailure(JSON_RPC_ERROR.METHOD_NOT_FOUND, `Method not found: ${method}`),
      );
  }
}

/** One message answered: a request with its response, anything else taken with 202 and no body. */
function answerMessage(
  server: McpServer,
  admitted: AdmittedConversation,
  message: Message,
  raw: UnparsedWireValue,
): Effect.Effect<HttpServerResponse.HttpServerResponse, never, LukeMcpServices> {
  const { id, method } = message;
  if (id === undefined || method === undefined) {
    return Effect.succeed(HttpServerResponse.empty({ status: HOSTED_HTTP_STATUS.ACCEPTED }));
  }
  return Effect.map(
    answerRequest(server, admitted, method, fieldOf(raw, "params") ?? {}),
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

/** The integration server a request's path names by its connection; nothing for a path that names no connection. */
function integrationServerOf(request: Request): Option.Option<McpServer> {
  const prefix = `${LUKE_INTEGRATION_MCP_PATH}/`;
  const { pathname } = new URL(request.url);
  if (!pathname.startsWith(prefix)) return Option.none();
  // Note that a connection's name is lower-case letters, digits, and hyphens alone, so its segment needs no decoding.
  const connection = pathname.slice(prefix.length);
  return integrationConnectionOf(connection) === undefined
    ? Option.none()
    : Option.some(integrationServer(connection));
}

/** POST: one JSON-RPC message to the server the request's path names, admitted on the runner's bearer. */
const mcpEndpoint = /* @__PURE__ */ Effect.fn("web/lukeMcpEndpoint")(function* (
  serverOf: (request: Request) => Option.Option<McpServer>,
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
  const server = serverOf(request);
  if (Option.isNone(server)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
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
  return yield* answerMessage(server.value, admitted.value, message.success, parsed.success);
});

/** The group: Luke's server over the sandbox door and the browser the edge composes, each integration's server beside it, and the hosted vocabulary's own refusal for any other path. */
export function lukeMcpApp(doors: LukeMcpDoors): WebRoutes<LukeMcpServices> {
  const luke = Option.some(lukeServer(doors));
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, LUKE_MCP_PATH, hostedRefusing(mcpEndpoint(() => luke))),
    HttpRouter.add(
      ANY_METHOD,
      `${LUKE_INTEGRATION_MCP_PATH}/:connection`,
      hostedRefusing(mcpEndpoint(integrationServerOf)),
    ),
    hostedNotFoundRoute,
  );
}
