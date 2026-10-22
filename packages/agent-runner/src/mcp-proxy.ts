/**
 * mcp-proxy.ts -- the Luke MCP server as Claude Code reaches it: a loopback listener the runner holds for the launch, which forwards each request to Luke with the runner's bearer added, so the CLI is handed a URL and no secret.
 *
 * The Agent SDK hands the CLI its MCP servers as `--mcp-config <json>` in
 * argv, headers and all (0.3.304's `ProcessTransport`), and every process in
 * the sandbox can read another's `/proc/<pid>/cmdline`, the agent's commands
 * included under the weaker nested sandbox. So the CLI's config names this
 * listener and nothing secret, and the bearer stays in the runner's memory,
 * added to the runner's own request to Luke.
 *
 * The listener binds 127.0.0.1 alone, on a port the kernel picks for each
 * launch, and closes with the launch. It forwards to the one MCP URL the
 * config names and nowhere else, so nothing reaching it reaches Luke's token
 * route; a command the agent runs has a network namespace of its own under
 * the command sandbox, where this loopback is not reachable.
 */

import { createServer } from "node:http";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import { Data, Effect, type Redacted, type Scope } from "effect";
import type * as Headers from "effect/http/Headers";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpServer from "effect/http/HttpServer";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as NetAddress from "effect/net/NetAddress";

/** The only address the listener answers on. */
export const MCP_PROXY_HOST = "127.0.0.1";

/** The path the CLI is handed; any other is answered 404. */
const MCP_PROXY_PATH = "/mcp";

/** A status for a request the proxy could not take to Luke. */
const STATUS = { NOT_FOUND: 404, BAD_GATEWAY: 502 } as const;

/**
 * Headers that describe one hop rather than the request, or that the proxy
 * sets itself: the CLI's own `authorization` (it has none to give) is
 * replaced with the bearer, and the body's length and encoding are the
 * forwarded request's and response's own.
 */
const HOP_HEADERS: ReadonlySet<string> = new Set([
  "authorization",
  "connection",
  "content-encoding",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

/** The listener could not be bound. */
export class McpProxyFailed extends Data.TaggedError("McpProxyFailed")<{
  readonly detail: string;
}> {}

function endToEnd(headers: Headers.Headers): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !HOP_HEADERS.has(name)));
}

/** One request from the CLI, sent on to Luke under the bearer, and Luke's answer streamed back. */
function forward(client: HttpClient.HttpClient, target: string, bearer: Redacted.Redacted) {
  return Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    if (new URL(request.url, "http://loopback").pathname !== MCP_PROXY_PATH) {
      return HttpServerResponse.empty({ status: STATUS.NOT_FOUND });
    }
    const body = new Uint8Array(yield* request.arrayBuffer);
    let outgoing = HttpClientRequest.make(request.method)(target).pipe(
      HttpClientRequest.setHeaders(endToEnd(request.headers)),
      HttpClientRequest.bearerToken(bearer),
    );
    if (body.byteLength > 0) {
      outgoing = HttpClientRequest.bodyUint8Array(
        outgoing,
        body,
        request.headers["content-type"] ?? "application/json",
      );
    }
    const response = yield* client.execute(outgoing);
    const contentType = response.headers["content-type"];
    return HttpServerResponse.stream(response.stream, {
      status: response.status,
      headers: endToEnd(response.headers),
      ...(contentType === undefined ? undefined : { contentType }),
    });
  }).pipe(
    // Note that the client's error is not kept, because the request it describes carries the bearer.
    Effect.catch(() => Effect.succeed(HttpServerResponse.empty({ status: STATUS.BAD_GATEWAY }))),
  );
}

/**
 * Opens the proxy to the MCP server at `target` for the rest of the scope,
 * and answers the URL the CLI is to be handed: loopback, its port the
 * kernel's pick, no secret in it.
 */
export const openMcpProxy = Effect.fn("agent-runner/openMcpProxy")(function* (
  target: string,
  bearer: Redacted.Redacted,
): Effect.fn.Return<string, McpProxyFailed, HttpClient.HttpClient | Scope.Scope> {
  const client = yield* HttpClient.HttpClient;
  const node = yield* Effect.sync(() => createServer());
  const server = yield* NodeHttpServer.make(() => node, { host: MCP_PROXY_HOST, port: 0 }).pipe(
    Effect.mapError((error) => new McpProxyFailed({ detail: String(error) })),
  );
  yield* Effect.provideService(
    HttpServer.serveEffect(forward(client, target, bearer)),
    HttpServer.HttpServer,
    server,
  );
  // A streamed answer the CLI still holds open would keep the server from closing.
  yield* Effect.addFinalizer(() => Effect.sync(() => node.closeAllConnections()));
  if (!NetAddress.isInetAddress(server.address)) {
    return yield* new McpProxyFailed({ detail: "the listener has no port" });
  }
  return `http://${MCP_PROXY_HOST}:${server.address.port}${MCP_PROXY_PATH}`;
});
