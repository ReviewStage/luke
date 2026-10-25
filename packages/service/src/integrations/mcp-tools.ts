/**
 * mcp-tools.ts -- the tools a provider's hosted MCP server lists for one account, read the way an MCP client reads them.
 *
 * An MCP server over streamable HTTP answers JSON-RPC: the client opens a
 * session with `initialize`, says `notifications/initialized`, and asks
 * `tools/list`, page by page, carrying the session id the server handed
 * back. A server may answer a request with one JSON body or with an event
 * stream whose `data:` lines carry it; both are read. The account's bearer
 * travels on every request and nowhere else, and the session is ended once
 * the list is read. What the list keeps of each tool is its name, the title
 * a person reads where the server gave one (the tool's own `title`, else its
 * annotations' `title`, the spec's order), its description whole (bounded,
 * for a person to read it all where a list opens it), the hints the server
 * annotated it with (`readOnlyHint` and its kin), where it sent any it
 * spelled as the spec does, and the arguments its input schema declares
 * (`mcp-tool-parameters.ts`): nothing the model would be handed, only what a
 * person picking servers reads. A tool whose title, hints, or input schema
 * is malformed is kept without them, so one server's slip never costs the
 * developer its whole list.
 *
 * The same session serves a native agent's integration servers
 * (`connection-door.ts`): `listMcpToolSchemas` reads each tool with the
 * schemas the server declared, untouched, and `callMcpTool` finds one tool
 * by name and calls it, answering the server's own result.
 *
 * Every failure is one word. The one thing kept of what the server said is
 * the first line of a JSON-RPC error's message, bounded, and only where it
 * carries neither the bearer nor anything shaped like a credential: that
 * line ("App is not enabled for Slack MCP server access") is what tells a
 * developer how to mend a connection, and it reaches their window.
 */

import {
  type IntegrationToolAnnotations,
  type IntegrationToolParameter,
  integrationToolAnnotationsSchema,
} from "@luke/features/integration-wire";
import {
  isRecord,
  isWireString,
  type UnparsedWireValue,
  type WireRecord,
  WireRecordShapeSchema,
  type WireValue,
  WireValueSchema,
} from "@luke/wire";
import { Data, Duration, Effect, Option, Schema } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import { toolParameters } from "./mcp-tool-parameters.js";

/** The protocol revision the session is opened under. */
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

/**
 * The most pages of tools read, so a server that never ends its cursor
 * cannot hold the read: a list still going past them is no list at all,
 * because a part of one would be drawn and held as if it were whole.
 */
const MAX_PAGES = 50;

/** How long the whole read may take. */
const READ_TIMEOUT = Duration.seconds(10);

/** How long a call of one tool may take, the read before it included: under the function's own bound, which is longer still. */
const CALL_TIMEOUT = Duration.minutes(5);

/** How long ending the session may take, after which it is let go: the list is already read. */
const END_TIMEOUT = Duration.seconds(2);

/** The most of a description a tool keeps, enough for any a server writes for a person to read whole. */
const DESCRIPTION_MAX_CHARS = 8000;

/** The most of a title a tool keeps. */
const TITLE_MAX_CHARS = 200;

/** The most of a server's error message a failure keeps. */
const MESSAGE_MAX_CHARS = 200;

/**
 * What a server's message may not carry to be kept: a bearer header, a
 * Slack token's prefix, or a long unbroken run of token characters (a
 * path's or a host's segments are short, so an address in it is kept).
 */
const CREDENTIAL_SHAPE = /bearer\s|xox[a-z]-|[A-Za-z0-9_+=-]{32,}/i;

/** Words that name a secret, or a credential's name with a value set after it. */
const SECRET_WORDS =
  /secret|passw(?:or)?d|api[_-]?key|private[_ -]?key|(?:token|assertion|code|key)\s*[=:]/i;

/** A run long enough to be a short key: any that mixes letters and digits is dropped. */
const KEY_LIKE_RUN = /[A-Za-z0-9_+=.-]{16,}/g;

/** Whether a line holds anything a credential could hide in, short or long. */
function shapedLikeCredential(line: string): boolean {
  if (CREDENTIAL_SHAPE.test(line) || SECRET_WORDS.test(line)) return true;
  return (line.match(KEY_LIKE_RUN) ?? []).some((run) => /\d/.test(run) && /[A-Za-z]/.test(run));
}

/** The shortest run of the bearer whose echo in a server's message drops it, so a truncated token is caught too. */
const TOKEN_ECHO_CHARS = 12;

/** Why no list could be read. */
export const MCP_TOOLS_FAILURE = {
  /** The server never answered, or answered an error status with no message. */
  UNREACHABLE: "unreachable",
  /** The server refused the bearer. */
  REFUSED: "refused",
  /** The server answered with a JSON-RPC error of its own. */
  REJECTED: "rejected",
  /** The server answered what is no JSON-RPC answer the read understands. */
  UNREADABLE: "unreadable",
} as const;

export type McpToolsFailureReason = (typeof MCP_TOOLS_FAILURE)[keyof typeof MCP_TOOLS_FAILURE];

export class McpToolsFailure extends Data.TaggedError("McpToolsFailure")<{
  readonly reason: McpToolsFailureReason;
  /** The server's JSON-RPC error code, where it answered one. */
  readonly code?: number;
  /** The first line of the server's error message, where one was safe to keep. */
  readonly serverMessage?: string;
}> {}

/** The JSON-RPC error code an MCP server answers an unauthorized request with. */
const RPC_UNAUTHORIZED = -32001;

/** One tool, as a person picking servers reads it. */
export interface McpTool {
  readonly name: string;
  /** The title its server gave it for a person to read, where it gave one. */
  readonly title?: string;
  readonly description: string;
  /** The hints its server sent, where it sent any. */
  readonly annotations?: IntegrationToolAnnotations;
  /** The arguments its input schema declares, where that schema was readable. */
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
      // A malformed title, hint, or input schema costs its tool that part, never the page.
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

/** What a request names besides its method: the handshake's terms, the page of tools asked for, or the tool called and its input. */
interface RpcParams {
  readonly protocolVersion?: string;
  readonly capabilities?: Readonly<Record<string, never>>;
  readonly clientInfo?: { readonly name: string; readonly version: string };
  readonly cursor?: string;
  readonly name?: string;
  readonly arguments?: WireRecord;
}

/** One tool as the server listed it, for a model to call: its name, its title and words, its hints, and the schemas it declared, as the server wrote them. */
export const McpToolSchemaSchema = Schema.Struct({
  name: Schema.String,
  title: Schema.optionalKey(Schema.String),
  description: Schema.optionalKey(Schema.String),
  annotations: Schema.optionalKey(WireRecordShapeSchema),
  inputSchema: Schema.optionalKey(WireValueSchema),
  outputSchema: Schema.optionalKey(WireValueSchema),
});

export type McpToolSchema = typeof McpToolSchemaSchema.Type;

/** What a call of one tool answered: every tool the server listed in the call's session, and the server's own result where it lists one under the name. */
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

/** The JSON-RPC answers a response carries: its body whole, or each event's `data:` lines joined. */
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

/** A text whole, its ends trimmed, bounded to `max` characters. */
function bounded(text: string | undefined, max: number): string {
  const whole = (text ?? "").trim();
  return whole.length <= max ? whole : `${whole.slice(0, max - 1)}…`;
}

/** A text's first line, bounded to `max` characters. */
function firstLine(text: string | undefined, max: number): string {
  const line = (text ?? "").trim().split(/\r?\n/)[0] ?? "";
  return line.length <= max ? line : `${line.slice(0, max - 1)}…`;
}

const decodeAnnotations = Schema.decodeUnknownOption(integrationToolAnnotationsSchema);

/** The hints a tool keeps of those its server sent: none where it sent none at all, or spelled them as the spec does not. */
function keptAnnotations(sent: UnparsedWireValue): IntegrationToolAnnotations | undefined {
  const read = Option.getOrUndefined(decodeAnnotations(sent));
  return read === undefined || Object.keys(read).length === 0 ? undefined : read;
}

/**
 * The title a tool keeps: its own `title`, else its annotations' `title`,
 * the spec's order, bounded; none where neither is words.
 */
function keptTitle(own: UnparsedWireValue, annotations: UnparsedWireValue): string | undefined {
  const fromAnnotations = isRecord(annotations) ? annotations.title : undefined;
  const title = [own, fromAnnotations].filter(isWireString).find((each) => each.trim() !== "");
  return title === undefined ? undefined : bounded(title, TITLE_MAX_CHARS);
}

const unreachable = new McpToolsFailure({ reason: MCP_TOOLS_FAILURE.UNREACHABLE });
const refused = new McpToolsFailure({ reason: MCP_TOOLS_FAILURE.REFUSED });
const unreadable = new McpToolsFailure({ reason: MCP_TOOLS_FAILURE.UNREADABLE });

/** Whether `line` repeats any run of the bearer long enough to be part of it rather than chance. */
function echoesToken(line: string, token: string): boolean {
  if (token.length <= TOKEN_ECHO_CHARS) return line.includes(token);
  for (let start = 0; start + TOKEN_ECHO_CHARS <= token.length; start += 1) {
    if (line.includes(token.slice(start, start + TOKEN_ECHO_CHARS))) return true;
  }
  return false;
}

/**
 * A provider's message as Luke may pass it on to a window: its first line,
 * bounded, or nothing where that line is empty or holds anything a
 * credential could be: a bearer, a secret's name or a credential's name set
 * to a value, a long run of token characters, or a short one mixing letters
 * and digits as a key does.
 */
export function credentialFreeLine(message: string | undefined): string | undefined {
  const line = (message ?? "").trim().split(/\r?\n/)[0] ?? "";
  if (line === "" || shapedLikeCredential(line)) return undefined;
  return firstLine(line, MESSAGE_MAX_CHARS);
}

/**
 * A server's error message as a failure may keep it: its first line, or
 * nothing where that could carry a credential, which is any run of the
 * bearer the server was sent, the only account secret it holds of ours,
 * or anything shaped like one.
 */
function keptMessage(message: string | undefined, token: string): string | undefined {
  const kept = credentialFreeLine(message);
  return kept === undefined || echoesToken(kept, token) ? undefined : kept;
}

/** The failure a JSON-RPC error amounts to: a refusal of the bearer, or the server's own error with what was safe to keep of it. */
function rpcFailure(error: typeof RpcError.Type, token: string): McpToolsFailure {
  if (error.code === RPC_UNAUTHORIZED) return refused;
  const serverMessage = keptMessage(error.message, token);
  return new McpToolsFailure({
    reason: MCP_TOOLS_FAILURE.REJECTED,
    code: error.code,
    ...(serverMessage !== undefined ? { serverMessage } : undefined),
  });
}

/** One JSON-RPC message sent within a session; a request answers its result, a notification nothing. */
type McpSend = (
  method: string,
  params: RpcParams,
  notification?: boolean,
) => Effect.Effect<unknown, McpToolsFailure>;

/**
 * A session with the server at `url` under the bearer `token`: opened with
 * `initialize`, `body` run over it, and ended as a courtesy, the whole
 * within `timeout`. A server that refuses the bearer is `refused`; one that
 * answers a JSON-RPC error of its own, under any status, is `rejected` with
 * its code and what was safe to keep of its message; one that answers what
 * is no JSON-RPC answer is `unreadable`; anything that never answered, or
 * answered an error status with no JSON-RPC error, is `unreachable`.
 */
function inMcpSession<A>(
  url: string,
  token: string,
  timeout: Duration.Input,
  body: (send: McpSend) => Effect.Effect<A, McpToolsFailure>,
): Effect.Effect<A, McpToolsFailure, HttpClient.HttpClient> {
  return Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    // The session id the server handed back, and whether the session is open: both ride every later request.
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
          // Note that we read an error status's body, because a server says there why it refused.
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
        clientInfo: { name: "luke", version: "1" },
      });
      opened = true;
      yield* send(MCP_METHOD.INITIALIZED, {}, true);
      return yield* body(send);
    });

    /** The session ended as a courtesy, within its own bound; whether the server heard it changes nothing. */
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

/** Every tool the session's server lists, page by page, as it listed them. */
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

/** A listed tool as a model is shown it: its name, its title, words, and hints, and its schemas untouched. */
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

/**
 * The tools the server at `url` lists for the bearer `token`, in its order,
 * as a person picking servers reads them; why not as `inMcpSession` says.
 */
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

/** The tools the server at `url` lists for the bearer `token`, in its order, each with the schemas it declared; why not as `inMcpSession` says. */
export const listMcpToolSchemas = /* @__PURE__ */ Effect.fn("web/listMcpToolSchemas")(function* (
  url: string,
  token: string,
): Effect.fn.Return<readonly McpToolSchema[], McpToolsFailure, HttpClient.HttpClient> {
  const listed = yield* inMcpSession(url, token, READ_TIMEOUT, listedTools);
  return listed.map(toolSchema);
});

/**
 * One call of the tool the server at `url` lists under `name`, with
 * `input`, under the bearer `token`, in one session: the server's own
 * result, which may be its tool's error, beside every tool it lists, which
 * the session reads first to find the tool; why no call was made as
 * `inMcpSession` says.
 */
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
      const result = yield* send(MCP_METHOD.TOOLS_CALL, { name, arguments: input });
      const answered = Option.getOrUndefined(decodeWireValue(result));
      if (answered === undefined) return yield* unreadable;
      return { called: true, tools, tool, result: answered } as const;
    }),
  );
});
