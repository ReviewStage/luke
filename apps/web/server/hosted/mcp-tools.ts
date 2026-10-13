/**
 * mcp-tools.ts -- the tools a provider's hosted MCP server lists for one account, read the way an MCP client reads them.
 *
 * An MCP server over streamable HTTP answers JSON-RPC: the client opens a
 * session with `initialize`, says `notifications/initialized`, and asks
 * `tools/list`, page by page, carrying the session id the server handed
 * back. A server may answer a request with one JSON body or with an event
 * stream whose `data:` lines carry it; both are read. The account's bearer
 * travels on every request and nowhere else, and the session is ended once
 * the list is read. What the list keeps of each tool is its name and the
 * first line of its description: nothing the model would be handed, only
 * what a person picking servers reads.
 *
 * Every failure is one word, never the server's message, which nothing here
 * can vouch for holding no credential.
 */

import { Data, Duration, Effect, Option, Schema } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";

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
} as const;

/**
 * The most pages of tools read, so a server that never ends its cursor
 * cannot hold the read: a list still going past them is no list at all,
 * because a part of one would be drawn and held as if it were whole.
 */
const MAX_PAGES = 50;

/** How long the whole read may take. */
const READ_TIMEOUT = Duration.seconds(10);

/** How long ending the session may take, after which it is let go: the list is already read. */
const END_TIMEOUT = Duration.seconds(2);

/** The most of a description's first line a tool keeps. */
const DESCRIPTION_MAX_CHARS = 160;

/** Why no list could be read. */
const MCP_TOOLS_FAILURE = {
  /** The server never answered, or answered an error status. */
  UNREACHABLE: "unreachable",
  /** The server refused the bearer. */
  REFUSED: "refused",
  /** The server answered what is no JSON-RPC answer the read understands. */
  UNREADABLE: "unreadable",
} as const;

export type McpToolsFailureReason = (typeof MCP_TOOLS_FAILURE)[keyof typeof MCP_TOOLS_FAILURE];

export class McpToolsFailure extends Data.TaggedError("McpToolsFailure")<{
  readonly reason: McpToolsFailureReason;
}> {}

/** The JSON-RPC error code an MCP server answers an unauthorized request with. */
const RPC_UNAUTHORIZED = -32001;

/** One tool, as a person picking servers reads it. */
export interface McpTool {
  readonly name: string;
  readonly description: string;
}

const RpcError = Schema.Struct({ code: Schema.Number });

const RpcAnswer = Schema.Struct({
  id: Schema.optionalKey(Schema.Union([Schema.Number, Schema.String])),
  result: Schema.optionalKey(Schema.Unknown),
  error: Schema.optionalKey(RpcError),
});

const ToolsPage = Schema.Struct({
  tools: Schema.Array(
    Schema.Struct({ name: Schema.String, description: Schema.optionalKey(Schema.String) }),
  ),
  nextCursor: Schema.optionalKey(Schema.String),
});

type RpcAnswerType = typeof RpcAnswer.Type;

const decodeAnswerText = Schema.decodeUnknownOption(Schema.fromJsonString(RpcAnswer));

/** What a request names besides its method: the handshake's terms, or the page of tools asked for. */
interface RpcParams {
  readonly protocolVersion?: string;
  readonly capabilities?: Readonly<Record<string, never>>;
  readonly clientInfo?: { readonly name: string; readonly version: string };
  readonly cursor?: string;
}
const decodePage = Schema.decodeUnknownOption(ToolsPage);

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

/** A tool's description as the list keeps it: its first line, bounded. */
function firstLine(description: string | undefined): string {
  const line = (description ?? "").trim().split(/\r?\n/)[0] ?? "";
  return line.length <= DESCRIPTION_MAX_CHARS
    ? line
    : `${line.slice(0, DESCRIPTION_MAX_CHARS - 1)}…`;
}

const unreachable = new McpToolsFailure({ reason: MCP_TOOLS_FAILURE.UNREACHABLE });
const refused = new McpToolsFailure({ reason: MCP_TOOLS_FAILURE.REFUSED });
const unreadable = new McpToolsFailure({ reason: MCP_TOOLS_FAILURE.UNREADABLE });

/**
 * The tools the server at `url` lists for the bearer `token`, in its order.
 * A server that refuses the bearer is `refused`; one that answers what is
 * no JSON-RPC answer is `unreadable`; anything that never answered is
 * `unreachable`.
 */
export const listMcpTools = /* @__PURE__ */ Effect.fn("web/listMcpTools")(function* (
  url: string,
  token: string,
): Effect.fn.Return<readonly McpTool[], McpToolsFailure, HttpClient.HttpClient> {
  const client = yield* HttpClient.HttpClient;
  // The session id the server handed back, and whether the session is open: both ride every later request.
  let session: string | undefined;
  let opened = false;
  let nextId = 0;

  /** One JSON-RPC message sent; a request answers its result, a notification nothing. */
  const send = (method: string, params: RpcParams, notification = false) =>
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
      if (response.status >= 400) return yield* unreachable;
      session = Option.getOrElse(
        Option.fromUndefinedOr(response.headers[MCP_HEADER.SESSION]),
        () => session,
      );
      if (id === undefined) return undefined;
      const body = yield* Effect.mapError(response.text, () => unreachable);
      const answer = answersOf(response.headers["content-type"] ?? "", body).find(
        (message) => message.id === id,
      );
      if (answer === undefined) return yield* unreadable;
      if (answer.error !== undefined) {
        return yield* answer.error.code === RPC_UNAUTHORIZED ? refused : unreadable;
      }
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
    const tools: McpTool[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const result = yield* send(MCP_METHOD.TOOLS_LIST, cursor !== undefined ? { cursor } : {});
      const read = Option.getOrUndefined(decodePage(result));
      if (read === undefined) return yield* unreadable;
      for (const tool of read.tools)
        tools.push({ name: tool.name, description: firstLine(tool.description) });
      cursor = read.nextCursor;
      if (cursor === undefined) return tools;
    }
    return yield* unreadable;
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
    Effect.timeoutOrElse({ duration: READ_TIMEOUT, orElse: () => Effect.fail(unreachable) }),
  );
});
