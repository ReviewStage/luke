import { readAgentOfConversation } from "@repo/database/models/agent-store";
import { RENAMED_TOOL, WORKSPACE_MCP_SERVER } from "@repo/features/agent-tools";
import { AGENT_MACHINE } from "@repo/features/agent-wire";
import { integrationConnectionOf } from "@repo/features/integration-wire";
import { MAC_COMMAND_BOUNDS } from "@repo/features/mac-command-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { failureKind } from "@repo/runtime/effect";
import {
  EXCESS_KEYS,
  HTTP_METHOD,
  isRecord,
  type UnparsedWireValue,
  type WireRecord,
} from "@repo/wire";
import { readEither } from "@repo/wire/effect";
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
import type { AgentBrowser } from "../browser/agent-browser.js";
import { CODER_TOOL, type OfferedBeside } from "../coder-host/tool-set.js";
import type { AdmittedConversation } from "../eve-host/conversation.js";
import { memoryOnFor } from "../memory-tools.js";
import { descriptionsOnFor } from "../descriptions-on.js";
import { admitRunnerBearer, presentedBearer } from "./bearer.js";
import { workspaceMcpCallKey } from "./call-key.js";
import { workspaceMcpDoorSeams } from "./door-seams.js";
import type { AgentSandboxDoors } from "./sandbox-door.js";
import {
  type McpContent,
  offeredWorkspaceMcpTool,
  refusedByDoor,
  WORKSPACE_MCP_TOOLS,
  type WorkspaceMcpOfferedTo,
  type WorkspaceMcpServices,
  type WorkspaceMcpTool,
  type WorkspaceMcpToolResult,
} from "./tools.js";

export const WORKSPACE_MCP_PATH = "/api/agents/mcp";

export const WORKSPACE_INTEGRATION_MCP_PATH = `${WORKSPACE_MCP_PATH}/integrations`;

export function workspaceIntegrationMcpUrl(origin: string, connection: string): string {
  return new URL(`${WORKSPACE_INTEGRATION_MCP_PATH}/${encodeURIComponent(connection)}`, origin)
    .href;
}

export const WORKSPACE_MCP_FUNCTION = {
  MAX_DURATION_SECONDS: MAC_COMMAND_BOUNDS.MAX_TIMEOUT_SECONDS + 120,
} as const;

export const WORKSPACE_MCP_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"] as const;

const SERVER_VERSION = "1.0.0";

const MAX_BODY_BYTES = 4 * 1024 * 1024;

const PROTOCOL_VERSION_HEADER = "mcp-protocol-version";

const JSON_RPC_VERSION = "2.0";

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

const DOOR_FAILED =
  "This tool could not run just now; try it again in a moment with the same input, which runs it once.";

const IdSchema = Schema.Union([Schema.String, Schema.Number]);
const ParamsSchema = Schema.Record(Schema.String, Schema.Unknown);

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

const DROPPING_EXCESS = { excess: EXCESS_KEYS.DROP } as const;

interface RpcError {
  readonly code: number;
  readonly message: string;
}

type RpcAnswer = Result.Result<object, RpcError>;

function fieldOf(value: UnparsedWireValue, field: string): UnparsedWireValue {
  return isRecord(value) ? value[field] : undefined;
}

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

function negotiatedVersion(asked: string): string {
  return (
    WORKSPACE_MCP_PROTOCOL_VERSIONS.find((version) => version === asked) ??
    WORKSPACE_MCP_PROTOCOL_VERSIONS[0]
  );
}

function unspokenVersion(request: Request): boolean {
  const named = request.headers.get(PROTOCOL_VERSION_HEADER);
  return named !== null && !WORKSPACE_MCP_PROTOCOL_VERSIONS.some((version) => version === named);
}

interface McpToolCallResult {
  readonly content: readonly McpContent[];
  readonly isError: boolean;
}

function toolResult(tool: WorkspaceMcpTool, result: WorkspaceMcpToolResult): McpToolCallResult {
  return {
    content: tool.content?.(result) ?? [{ type: "text", text: JSON.stringify(result) }],
    isError: refusedByDoor(result),
  };
}

function renamedToolResult(name: string, renamed: string): McpToolCallResult {
  return {
    content: [
      {
        type: "text",
        text: `\`${name}\` was renamed \`${renamed}\`, and nothing was done: call \`${renamed}\` with the same input.`,
      },
    ],
    isError: true,
  };
}

const TOOL_META = { "anthropic/maxResultSizeChars": 500_000 } as const;

const ALWAYS_LOADED_TOOLS: ReadonlySet<string> = new Set([
  CODER_TOOL.POST_THREAD,
  CODER_TOOL.READ_THREADS,
  CODER_TOOL.WITHDRAW_ASK,
  CODER_TOOL.OPEN_PULL_REQUEST,
  CODER_TOOL.EDIT_DESCRIPTION,
  CODER_TOOL.UPDATE_TASK,
  CODER_TOOL.READ_TASK,
  CODER_TOOL.SHOW_IMAGE,
  CODER_TOOL.SHOW_PAGE,
  CODER_TOOL.MESSAGE_AGENT,
  CODER_TOOL.LIST_AGENTS,
  CODER_TOOL.START_AGENT,
]);

const ALWAYS_LOADED_META = { ...TOOL_META, "anthropic/alwaysLoad": true } as const;

const NO_AGENT_OFFERED: WorkspaceMcpOfferedTo = { repository: null, machine: AGENT_MACHINE.VERCEL };

const NO_AGENT_BESIDE: OfferedBeside = { memoryOn: false, descriptionsOn: false };

const DOOR_FAILED_RESULT: McpToolCallResult = {
  content: [{ type: "text", text: DOOR_FAILED }],
  isError: true,
};

type WorkspaceMcpSandboxDoor = (admitted: AdmittedConversation) => AgentSandboxDoors;

export type WorkspaceMcpBrowser = Layer.Layer<AgentBrowser, never, HttpClient.HttpClient>;

export interface WorkspaceMcpDoors {
  readonly sandbox: WorkspaceMcpSandboxDoor;
  readonly browser: WorkspaceMcpBrowser;
}

interface McpServer {
  readonly name: string;
  readonly instructions: (
    admitted: AdmittedConversation,
  ) => Effect.Effect<Option.Option<string>, never, WorkspaceMcpServices>;
  readonly listTools: (
    admitted: AdmittedConversation,
  ) => Effect.Effect<RpcAnswer, never, WorkspaceMcpServices>;
  readonly callTool: (
    admitted: AdmittedConversation,
    params: UnparsedWireValue,
  ) => Effect.Effect<RpcAnswer, never, WorkspaceMcpServices>;
}

function callWorkspaceTool(
  doors: WorkspaceMcpDoors,
  admitted: AdmittedConversation,
  params: UnparsedWireValue,
): Effect.Effect<RpcAnswer, never, WorkspaceMcpServices> {
  const call = readEither(CallParamsSchema, DROPPING_EXCESS)(params);
  if (Result.isFailure(call)) {
    return Effect.succeed(rpcFailure(JSON_RPC_ERROR.INVALID_PARAMS, "Invalid tools/call params"));
  }
  const { name } = call.success;
  const renamed = RENAMED_TOOL.get(name);
  if (renamed !== undefined)
    return Effect.succeed(Result.succeed(renamedToolResult(name, renamed)));
  const tool = WORKSPACE_MCP_TOOLS.get(name);
  if (tool === undefined) {
    return Effect.succeed(rpcFailure(JSON_RPC_ERROR.INVALID_PARAMS, `Unknown tool: ${name}`));
  }
  const input = fieldOf(params, "arguments") ?? {};
  return Effect.flatMap(workspaceMcpDoorSeams, (seams) => {
    const sandbox = doors.sandbox(admitted);
    const context = {
      sandbox: sandbox.files,
      callKey: workspaceMcpCallKey(admitted, name, input),
      seams,
    };
    return tool.run(admitted, input, context);
  }).pipe(
    Effect.provide(doors.browser),
    Effect.map((result) => Result.succeed(toolResult(tool, result))),
    Effect.catchCause((cause) =>
      Effect.as(
        Effect.logWarning(`${PRODUCT_NAME} MCP tool ${name} failed: ${failureKind(cause)}`),
        Result.succeed(DOOR_FAILED_RESULT),
      ),
    ),
  );
}

function listWorkspaceTools(
  admitted: AdmittedConversation,
): Effect.Effect<RpcAnswer, never, WorkspaceMcpServices> {
  const { userId, conversationId } = admitted.target;
  return readAgentOfConversation(userId, conversationId).pipe(
    Effect.flatMap((found) =>
      Effect.map(
        Option.isSome(found)
          ? Effect.all({
              memoryOn: memoryOnFor(found.value.userId),
              descriptionsOn: descriptionsOnFor(found.value.userId, found.value.kind),
            })
          : Effect.succeed(NO_AGENT_BESIDE),
        (beside) =>
          offeredWorkspaceMcpTool(
            Option.getOrElse(found, () => NO_AGENT_OFFERED),
            beside,
          ),
      ),
    ),
    Effect.map((offered) => {
      const tools = [...WORKSPACE_MCP_TOOLS]
        .filter(([name]) => offered(name))
        .map(([name, tool]) => ({
          name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          _meta: ALWAYS_LOADED_TOOLS.has(name) ? ALWAYS_LOADED_META : TOOL_META,
        }));
      return Result.succeed({ tools });
    }),
    Effect.catchCause((cause) =>
      Effect.as(
        Effect.logWarning(`${PRODUCT_NAME} MCP tools/list failed: ${failureKind(cause)}`),
        rpcFailure(JSON_RPC_ERROR.INTERNAL_ERROR, "The tools could not be listed just now"),
      ),
    ),
  );
}

function workspaceServer(doors: WorkspaceMcpDoors): McpServer {
  return {
    name: WORKSPACE_MCP_SERVER,
    instructions: () => Effect.succeedNone,
    listTools: listWorkspaceTools,
    callTool: (admitted, params) => callWorkspaceTool(doors, admitted, params),
  };
}

const ANY_OBJECT_SCHEMA = { type: "object" } as const;

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

function refusedCall(refusal: ConnectionRefusal): WireRecord {
  return { content: [{ type: "text", text: JSON.stringify(refusal) }], isError: true };
}

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

function answerRequest(
  server: McpServer,
  admitted: AdmittedConversation,
  method: string,
  params: UnparsedWireValue,
): Effect.Effect<RpcAnswer, never, WorkspaceMcpServices> {
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

function answerMessage(
  server: McpServer,
  admitted: AdmittedConversation,
  message: Message,
  raw: UnparsedWireValue,
): Effect.Effect<HttpServerResponse.HttpServerResponse, never, WorkspaceMcpServices> {
  const { id, method } = message;
  if (id === undefined || method === undefined) {
    return Effect.succeed(HttpServerResponse.empty({ status: HOSTED_HTTP_STATUS.ACCEPTED }));
  }
  return Effect.map(
    answerRequest(server, admitted, method, fieldOf(raw, "params") ?? {}),
    (answer) => rpcResponse(id, answer),
  );
}

function bearerRefused(): HttpServerResponse.HttpServerResponse {
  return HttpServerResponse.jsonUnsafe(HOSTED_REFUSAL.INVALID_TOKEN, {
    status: HOSTED_HTTP_STATUS.UNAUTHORIZED,
    headers: { "www-authenticate": `Bearer realm="${PRODUCT_NAME}"` },
  });
}

function integrationServerOf(request: Request): Option.Option<McpServer> {
  const prefix = `${WORKSPACE_INTEGRATION_MCP_PATH}/`;
  const { pathname } = new URL(request.url);
  if (!pathname.startsWith(prefix)) return Option.none();
  const connection = pathname.slice(prefix.length);
  return integrationConnectionOf(connection) === undefined
    ? Option.none()
    : Option.some(integrationServer(connection));
}

const mcpEndpoint = /* @__PURE__ */ Effect.fn("web/workspaceMcpEndpoint")(function* (
  serverOf: (request: Request) => Option.Option<McpServer>,
): Effect.fn.Return<
  HttpServerResponse.HttpServerResponse,
  HostedRefusal,
  HttpServerRequest.HttpServerRequest | WorkspaceMcpServices
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

export function workspaceMcpApp(doors: WorkspaceMcpDoors): WebRoutes<WorkspaceMcpServices> {
  const server = Option.some(workspaceServer(doors));
  return Layer.mergeAll(
    HttpRouter.add(ANY_METHOD, WORKSPACE_MCP_PATH, hostedRefusing(mcpEndpoint(() => server))),
    HttpRouter.add(
      ANY_METHOD,
      `${WORKSPACE_INTEGRATION_MCP_PATH}/:connection`,
      hostedRefusing(mcpEndpoint(integrationServerOf)),
    ),
    hostedNotFoundRoute,
  );
}
