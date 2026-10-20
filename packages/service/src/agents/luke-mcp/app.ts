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

import type { DatabaseServices } from "@luke/database/core/query";
import { failureKind } from "@luke/runtime/effect";
import { EXCESS_KEYS, isRecord, type UnparsedWireValue } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Effect, Layer, Option, Result, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
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
import type { CoderHost } from "../coder-host/host.js";
import { admitRunnerBearer, presentedBearer } from "./bearer.js";
import { LUKE_MCP_TOOLS, type LukeMcpToolResult, refusedByDoor } from "./tools.js";

/** The path a runner's MCP client posts to. */
export const LUKE_MCP_PATH = "/api/agents/mcp";

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

/** MCP's result of a tool call: what the tool answered, as text blocks, and whether it is the tool's own error. */
interface McpToolCallResult {
  readonly content: readonly { readonly type: "text"; readonly text: string }[];
  readonly isError: boolean;
}

/** A door's result as MCP's tool result: its JSON as one text block, marked an error where the door refused. */
function toolResult(result: LukeMcpToolResult): McpToolCallResult {
  return {
    content: [{ type: "text", text: JSON.stringify(result) }],
    isError: refusedByDoor(result),
  };
}

/** The tool result where the door failed rather than refused. */
const DOOR_FAILED_RESULT: McpToolCallResult = {
  content: [{ type: "text", text: DOOR_FAILED }],
  isError: true,
};

/** One `tools/call` run through the tool's door as the admitted conversation. */
function callTool(
  host: CoderHost,
  admitted: AdmittedConversation,
  params: UnparsedWireValue,
): Effect.Effect<RpcAnswer, never, DatabaseServices> {
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
  return tool.run(host, admitted, input).pipe(
    Effect.map((result) => Result.succeed(toolResult(result))),
    Effect.catchCause((cause) =>
      Effect.as(
        Effect.logWarning(`Luke MCP tool ${name} failed: ${failureKind(cause)}`),
        Result.succeed(DOOR_FAILED_RESULT),
      ),
    ),
  );
}

/** One request's answer, by its method. */
function answerRequest(
  host: CoderHost,
  admitted: AdmittedConversation,
  method: string,
  params: UnparsedWireValue,
): Effect.Effect<RpcAnswer, never, DatabaseServices> {
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
      return Effect.succeed(
        Result.succeed({
          tools: [...LUKE_MCP_TOOLS].map(([name, tool]) => ({
            name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          })),
        }),
      );
    case MCP_METHOD.TOOLS_CALL:
      return callTool(host, admitted, params);
    default:
      return Effect.succeed(
        rpcFailure(JSON_RPC_ERROR.METHOD_NOT_FOUND, `Method not found: ${method}`),
      );
  }
}

/** One message answered: a request with its response, anything else taken with 202 and no body. */
function answerMessage(
  host: CoderHost,
  admitted: AdmittedConversation,
  message: Message,
  raw: UnparsedWireValue,
): Effect.Effect<HttpServerResponse.HttpServerResponse, never, DatabaseServices> {
  const { id, method } = message;
  if (id === undefined || method === undefined) {
    return Effect.succeed(HttpServerResponse.empty({ status: HOSTED_HTTP_STATUS.ACCEPTED }));
  }
  return Effect.map(answerRequest(host, admitted, method, fieldOf(raw, "params") ?? {}), (answer) =>
    rpcResponse(id, answer),
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
  host: () => CoderHost,
): Effect.fn.Return<
  HttpServerResponse.HttpServerResponse,
  HostedRefusal,
  HttpServerRequest.HttpServerRequest | DatabaseServices
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
  return yield* answerMessage(host(), admitted.value, message.success, parsed.success);
});

/**
 * The group: the one MCP path over the coder host the edge builds, handed
 * as a thunk so the host is composed on the first call rather than as the
 * route is loaded; and the hosted vocabulary's own refusal for any other.
 */
export function lukeMcpApp(host: () => CoderHost): WebRoutes<DatabaseServices> {
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, LUKE_MCP_PATH, hostedRefusing(mcpEndpoint(host))),
    hostedNotFoundRoute,
  );
}
