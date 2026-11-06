import {
  type IntegrationToolAnnotations,
  type IntegrationToolParameter,
  integrationToolAnnotationsSchema,
} from "@repo/features/integration-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import {
  isRecord,
  isWireString,
  type UnparsedWireValue,
  type WireRecord,
  WireRecordShapeSchema,
  type WireValue,
  WireValueSchema,
} from "@repo/wire";
import { Data, Duration, Effect, Option, Schema } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import { toolParameters } from "./mcp-tool-parameters.js";

const PROTOCOL_VERSION = "2025-06-18";

const MCP_HEADER = {
  SESSION: "mcp-session-id",
  PROTOCOL: "mcp-protocol-version",
} as const;

const MCP_METHOD = {
  INITIALIZE: "initialize",
  INITIALIZED: "notifications/initialized",
  TOOLS_LIST: "tools/list",
  TOOLS_CALL: "tools/call",
} as const;

const MAX_PAGES = 50;

const READ_TIMEOUT = Duration.seconds(10);

const CALL_TIMEOUT = Duration.minutes(5);

const END_TIMEOUT = Duration.seconds(2);

const DESCRIPTION_MAX_CHARS = 8000;

const TITLE_MAX_CHARS = 200;

const MESSAGE_MAX_CHARS = 200;

const CREDENTIAL_SHAPE = /bearer\s|xox[a-z]-|[A-Za-z0-9_+=-]{32,}/i;

const SECRET_WORDS =
  /secret|passw(?:or)?d|api[_-]?key|private[_ -]?key|(?:token|assertion|code|key)\s*[=:]/i;

const KEY_LIKE_RUN = /[A-Za-z0-9_+=.-]{16,}/g;

export function namesSecret(line: string): boolean {
  return CREDENTIAL_SHAPE.test(line) || SECRET_WORDS.test(line);
}

function shapedLikeCredential(line: string): boolean {
  if (namesSecret(line)) return true;
  return (line.match(KEY_LIKE_RUN) ?? []).some((run) => /\d/.test(run) && /[A-Za-z]/.test(run));
}

const TOKEN_ECHO_CHARS = 12;

export const MCP_TOOLS_FAILURE = {
  UNREACHABLE: "unreachable",
  REFUSED: "refused",
  REJECTED: "rejected",
  UNREADABLE: "unreadable",
} as const;

export type McpToolsFailureReason = (typeof MCP_TOOLS_FAILURE)[keyof typeof MCP_TOOLS_FAILURE];

export class McpToolsFailure extends Data.TaggedError("McpToolsFailure")<{
  readonly reason: McpToolsFailureReason;
  readonly code?: number;
  readonly serverMessage?: string;
  readonly listed?: readonly McpToolSchema[];
}> {}

const RPC_UNAUTHORIZED = -32001;

export interface McpTool {
  readonly name: string;
  readonly title?: string;
  readonly description: string;
  readonly annotations?: IntegrationToolAnnotations;
  readonly parameters?: readonly IntegrationToolParameter[];
}

const RpcError = Schema.Struct({
  code: Schema.Number,
  message: Schema.optionalKey(Schema.String),
});

const RpcAnswer = Schema.Struct({
  id: Schema.optionalKey(Schema.Union([Schema.Number, Schema.String, Schema.Null])),
  result: Schema.optionalKey(Schema.Unknown),
  error: Schema.optionalKey(RpcError),
});

const ToolsPage = Schema.Struct({
  tools: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      title: Schema.optionalKey(WireValueSchema),
      description: Schema.optionalKey(Schema.String),
      annotations: Schema.optionalKey(WireValueSchema),
      inputSchema: Schema.optionalKey(WireValueSchema),
      outputSchema: Schema.optionalKey(WireValueSchema),
    }),
  ),
  nextCursor: Schema.optionalKey(Schema.String),
});

type RpcAnswerType = typeof RpcAnswer.Type;

const decodeAnswerText = Schema.decodeUnknownOption(Schema.fromJsonString(RpcAnswer));

interface RpcParams {
  readonly protocolVersion?: string;
  readonly capabilities?: Readonly<Record<string, never>>;
  readonly clientInfo?: { readonly name: string; readonly version: string };
  readonly cursor?: string;
  readonly name?: string;
  readonly arguments?: WireRecord;
}

export const McpToolSchemaSchema = Schema.Struct({
  name: Schema.String,
  title: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.String),
  annotations: Schema.optionalKey(WireRecordShapeSchema),
  inputSchema: Schema.optionalKey(WireValueSchema),
  outputSchema: Schema.optionalKey(WireValueSchema),
});

export type McpToolSchema = typeof McpToolSchemaSchema.Type;

export type McpToolCall =
  | {
      readonly called: true;
      readonly tools: readonly McpToolSchema[];
      readonly tool: McpToolSchema;
      readonly result: WireValue;
    }
  | { readonly called: false; readonly tools: readonly McpToolSchema[] };

type ListedTool = (typeof ToolsPage.Type)["tools"][number];
const decodePage = Schema.decodeUnknownOption(ToolsPage);
const decodeWireValue = Schema.decodeUnknownOption(WireValueSchema);

const decodeToolResult = Schema.decodeUnknownOption(
  Schema.Struct({
    isError: Schema.optionalKey(Schema.Boolean),
    structuredContent: Schema.optionalKey(Schema.Unknown),
    content: Schema.optionalKey(Schema.Array(Schema.Unknown)),
  }),
);

const decodeTextBlock = Schema.decodeUnknownOption(
  Schema.Struct({ type: Schema.Literal("text"), text: Schema.String }),
);

const decodeJsonText = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

function answersOf(contentType: string, body: string): readonly RpcAnswerType[] {
  const texts = contentType.includes("text/event-stream")
    ? body.split(/\r?\n\r?\n/).map((event) =>
        event
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice("data:".length).trimStart())
          .join("\n"),
      )
    : [body];
  return texts.flatMap((text) => Option.toArray(decodeAnswerText(text)));
}

function bounded(text: string | undefined, max: number): string {
  const whole = (text ?? "").trim();
  return whole.length <= max ? whole : `${whole.slice(0, max - 1)}…`;
}

function firstLine(text: string | undefined, max: number): string {
  const line = (text ?? "").trim().split(/\r?\n/)[0] ?? "";
  return line.length <= max ? line : `${line.slice(0, max - 1)}…`;
}

const decodeAnnotations = Schema.decodeUnknownOption(integrationToolAnnotationsSchema);

function keptAnnotations(sent: UnparsedWireValue): IntegrationToolAnnotations | undefined {
  const read = Option.getOrUndefined(decodeAnnotations(sent));
  return read === undefined || Object.keys(read).length === 0 ? undefined : read;
}

function keptTitle(own: UnparsedWireValue, annotations: UnparsedWireValue): string | undefined {
  const fromAnnotations = isRecord(annotations) ? annotations.title : undefined;
  const title = [own, fromAnnotations].filter(isWireString).find((each) => each.trim() !== "");
  return title === undefined ? undefined : bounded(title, TITLE_MAX_CHARS);
}

const unreachable = new McpToolsFailure({ reason: MCP_TOOLS_FAILURE.UNREACHABLE });
const refused = new McpToolsFailure({ reason: MCP_TOOLS_FAILURE.REFUSED });
const unreadable = new McpToolsFailure({ reason: MCP_TOOLS_FAILURE.UNREADABLE });

function echoesToken(line: string, token: string): boolean {
  if (token.length <= TOKEN_ECHO_CHARS) return line.includes(token);
  for (let start = 0; start + TOKEN_ECHO_CHARS <= token.length; start += 1) {
    if (line.includes(token.slice(start, start + TOKEN_ECHO_CHARS))) return true;
  }
  return false;
}

export function credentialFreeLine(message: string | undefined): string | undefined {
  const line = (message ?? "").trim().split(/\r?\n/)[0] ?? "";
  if (line === "" || shapedLikeCredential(line)) return undefined;
  return firstLine(line, MESSAGE_MAX_CHARS);
}

function keptMessage(message: string | undefined, token: string): string | undefined {
  const kept = credentialFreeLine(message);
  return kept === undefined || echoesToken(kept, token) ? undefined : kept;
}

function rpcFailure(error: typeof RpcError.Type, token: string): McpToolsFailure {
  if (error.code === RPC_UNAUTHORIZED) return refused;
  const serverMessage = keptMessage(error.message, token);
  return new McpToolsFailure({
    reason: MCP_TOOLS_FAILURE.REJECTED,
    code: error.code,
    ...(serverMessage !== undefined ? { serverMessage } : undefined),
  });
}

type McpSend = (
  method: string,
  params: RpcParams,
  notification?: boolean,
) => Effect.Effect<unknown, McpToolsFailure>;

function inMcpSession<A>(
  url: string,
  token: string,
  timeout: Duration.Input,
  body: (send: McpSend) => Effect.Effect<A, McpToolsFailure>,
): Effect.Effect<A, McpToolsFailure, HttpClient.HttpClient> {
  return Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    let session: string | undefined;
    let opened = false;
    let nextId = 0;

    const send: McpSend = (method, params, notification = false) =>
      Effect.gen(function* () {
        const id = notification ? undefined : ++nextId;
        const request = HttpClientRequest.post(url).pipe(
          HttpClientRequest.setHeaders({
            authorization: `Bearer ${token}`,
            accept: "application/json, text/event-stream",
            ...(session !== undefined ? { [MCP_HEADER.SESSION]: session } : undefined),
            ...(opened ? { [MCP_HEADER.PROTOCOL]: PROTOCOL_VERSION } : undefined),
          }),
          HttpClientRequest.bodyJsonUnsafe({
            jsonrpc: "2.0",
            method,
            params,
            ...(id !== undefined ? { id } : undefined),
          }),
        );
        const response = yield* Effect.mapError(client.execute(request), () => unreachable);
        if (response.status === 401 || response.status === 403) {
          return yield* refused;
        }
        if (response.status >= 400) {
          const failed = yield* Effect.mapError(response.text, () => unreachable);
          const error = answersOf(response.headers["content-type"] ?? "", failed).find(
            (message) => message.error !== undefined,
          )?.error;
          return yield* error === undefined ? unreachable : rpcFailure(error, token);
        }
        session = Option.getOrElse(
          Option.fromUndefinedOr(response.headers[MCP_HEADER.SESSION]),
          () => session,
        );
        if (id === undefined) return undefined;
        const text = yield* Effect.mapError(response.text, () => unreachable);
        const answer = answersOf(response.headers["content-type"] ?? "", text).find(
          (message) => message.id === id,
        );
        if (answer === undefined) return yield* unreadable;
        if (answer.error !== undefined) return yield* rpcFailure(answer.error, token);
        return answer.result;
      });

    const read = Effect.gen(function* () {
      yield* send(MCP_METHOD.INITIALIZE, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: PRODUCT_NAME, version: "1" },
      });
      opened = true;
      yield* send(MCP_METHOD.INITIALIZED, {}, true);
      return yield* body(send);
    });

    const end = Effect.suspend(() =>
      session === undefined
        ? Effect.void
        : Effect.ignore(
            client
              .execute(
                HttpClientRequest.delete(url).pipe(
                  HttpClientRequest.setHeaders({
                    authorization: `Bearer ${token}`,
                    [MCP_HEADER.SESSION]: session,
                  }),
                ),
              )
              .pipe(Effect.timeout(END_TIMEOUT)),
          ),
    );

    return yield* read.pipe(
      Effect.ensuring(end),
      Effect.timeoutOrElse({ duration: timeout, orElse: () => Effect.fail(unreachable) }),
    );
  });
}

function listedTools(send: McpSend): Effect.Effect<readonly ListedTool[], McpToolsFailure> {
  return Effect.gen(function* () {
    const tools: ListedTool[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const result = yield* send(MCP_METHOD.TOOLS_LIST, cursor !== undefined ? { cursor } : {});
      const read = Option.getOrUndefined(decodePage(result));
      if (read === undefined) return yield* unreadable;
      tools.push(...read.tools);
      cursor = read.nextCursor;
      if (cursor === undefined) return tools;
    }
    return yield* unreadable;
  });
}

function toolSchema(tool: ListedTool): McpToolSchema {
  return {
    name: tool.name,
    ...(isWireString(tool.title) ? { title: tool.title } : undefined),
    ...(tool.description !== undefined ? { description: tool.description } : undefined),
    ...(isRecord(tool.annotations) ? { annotations: tool.annotations } : undefined),
    ...(tool.inputSchema !== undefined ? { inputSchema: tool.inputSchema } : undefined),
    ...(tool.outputSchema !== undefined ? { outputSchema: tool.outputSchema } : undefined),
  };
}

export const listMcpTools = /* @__PURE__ */ Effect.fn("web/listMcpTools")(function* (
  url: string,
  token: string,
): Effect.fn.Return<readonly McpTool[], McpToolsFailure, HttpClient.HttpClient> {
  const listed = yield* inMcpSession(url, token, READ_TIMEOUT, listedTools);
  return listed.map((tool): McpTool => {
    const title = keptTitle(tool.title, tool.annotations);
    const annotations = keptAnnotations(tool.annotations);
    const parameters = toolParameters(tool.inputSchema);
    return {
      name: tool.name,
      ...(title !== undefined ? { title } : undefined),
      description: bounded(tool.description, DESCRIPTION_MAX_CHARS),
      ...(annotations !== undefined ? { annotations } : undefined),
      ...(parameters !== undefined ? { parameters } : undefined),
    };
  });
});

export const listMcpToolSchemas = /* @__PURE__ */ Effect.fn("web/listMcpToolSchemas")(function* (
  url: string,
  token: string,
): Effect.fn.Return<readonly McpToolSchema[], McpToolsFailure, HttpClient.HttpClient> {
  const listed = yield* inMcpSession(url, token, READ_TIMEOUT, listedTools);
  return listed.map(toolSchema);
});

export const callMcpTool = /* @__PURE__ */ Effect.fn("web/callMcpTool")(function* (
  url: string,
  token: string,
  name: string,
  input: WireRecord,
): Effect.fn.Return<McpToolCall, McpToolsFailure, HttpClient.HttpClient> {
  return yield* inMcpSession(url, token, CALL_TIMEOUT, (send) =>
    Effect.gen(function* () {
      const tools = (yield* listedTools(send)).map(toolSchema);
      const tool = tools.find((each) => each.name === name);
      if (tool === undefined) return { called: false, tools } as const;
      const called = Effect.gen(function* () {
        const result = yield* send(MCP_METHOD.TOOLS_CALL, { name, arguments: input });
        const answered = Option.getOrUndefined(decodeWireValue(result));
        if (answered === undefined) return yield* unreadable;
        return { called: true, tools, tool, result: answered } as const;
      });
      return yield* Effect.mapError(
        called,
        (failure) =>
          new McpToolsFailure({
            reason: failure.reason,
            ...(failure.code !== undefined ? { code: failure.code } : undefined),
            ...(failure.serverMessage !== undefined
              ? { serverMessage: failure.serverMessage }
              : undefined),
            listed: tools,
          }),
      );
    }),
  );
});

export const readMcpTool = /* @__PURE__ */ Effect.fn("web/readMcpTool")(function* (
  url: string,
  token: string,
  name: string,
  input: WireRecord,
  timeout: Duration.Input,
): Effect.fn.Return<WireValue, McpToolsFailure, HttpClient.HttpClient> {
  return yield* inMcpSession(url, token, timeout, (send) =>
    Effect.gen(function* () {
      const result = yield* send(MCP_METHOD.TOOLS_CALL, { name, arguments: input });
      const answered = Option.getOrUndefined(decodeWireValue(result));
      if (answered === undefined) return yield* unreadable;
      return answered;
    }),
  );
});

export function toolResultTexts(result: WireValue): readonly string[] {
  const read = Option.getOrUndefined(decodeToolResult(result));
  if (read === undefined || read.isError === true) return [];
  return (read.content ?? []).flatMap((block) =>
    Option.toArray(Option.map(decodeTextBlock(block), (text) => text.text)),
  );
}

export function toolResultJson(result: WireValue): readonly unknown[] {
  const read = Option.getOrUndefined(decodeToolResult(result));
  if (read === undefined || read.isError === true) return [];
  const structured = read.structuredContent !== undefined ? [read.structuredContent] : [];
  return [
    ...structured,
    ...toolResultTexts(result).flatMap((text) => Option.toArray(decodeJsonText(text))),
  ];
}
