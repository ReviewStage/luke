/**
 * mcp-relay.ts -- the Luke MCP server as Claude Code reaches it: an in-process SDK server whose every JSON-RPC message the runner posts to Luke under its own bearer, so the CLI is handed no URL, no port, and no secret.
 *
 * The Agent SDK hands the CLI an HTTP MCP server as `--mcp-config <json>` in
 * argv, headers and all (0.3.304's `ProcessTransport`), and every process in
 * the sandbox can read another's `/proc/<pid>/cmdline`. A loopback proxy
 * would keep the bearer out of argv but answer anything that reaches
 * 127.0.0.1, a teammate's Terminal included, which runs outside the command
 * sandbox. So the server is an SDK one (`type: "sdk"`): the CLI speaks MCP to
 * the runner over the control channel on its own stdin and stdout, which no
 * other process holds, and the runner relays each message to Luke's MCP URL
 * with the bearer from its own environment. Nothing listens on a port.
 *
 * The relay is JSON-RPC verbatim, since Luke's server is stateless and
 * answers each POST with one JSON body (`luke-mcp/app.ts`): a request's
 * answer is handed back to the CLI as Luke wrote it, a notification's 202 is
 * nothing to hand back, and a request Luke did not answer is answered with
 * a JSON-RPC error, so the CLI's call fails rather than hangs.
 */

import type { McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";
import { Effect, Predicate, Queue, type Redacted, type Scope, Stream } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";

/** The server's instance, of which the SDK calls `connect` alone. */
type SdkServer = McpSdkServerConfigWithInstance["instance"];
/** The transport the SDK connects the server to: the CLI's control channel. */
type CliTransport = Parameters<SdkServer["connect"]>[0];
/** One JSON-RPC message, either way across that channel. */
type JsonRpcMessage = Parameters<CliTransport["send"]>[0];

/** JSON-RPC's code for a request the server could not carry out. */
const INTERNAL_ERROR = -32603;

interface Received {
  readonly transport: CliTransport;
  readonly message: JsonRpcMessage;
}

/** The request's id, where the message is a request the CLI waits on an answer to. */
function requestId(message: JsonRpcMessage): string | number | undefined {
  if (!("method" in message) || !("id" in message)) return undefined;
  const id: unknown = message.id;
  return typeof id === "string" || typeof id === "number" ? id : undefined;
}

/** Whether Luke's body reads as a JSON-RPC message to hand the CLI. */
function isJsonRpc(value: unknown): value is JsonRpcMessage {
  return Predicate.isObject(value) && "jsonrpc" in value && value.jsonrpc === "2.0";
}

/** Hands the CLI one message; a channel the CLI already closed takes nothing. */
function deliver(transport: CliTransport, message: JsonRpcMessage) {
  return Effect.tryPromise(() => transport.send(message)).pipe(Effect.ignore);
}

/** One message from the CLI, posted to Luke under the bearer, and Luke's answer handed back. */
function relay(
  client: HttpClient.HttpClient,
  target: string,
  bearer: Redacted.Redacted,
  { transport, message }: Received,
) {
  const request = HttpClientRequest.post(target).pipe(
    HttpClientRequest.bearerToken(bearer),
    HttpClientRequest.setHeader("accept", "application/json, text/event-stream"),
    HttpClientRequest.bodyText(JSON.stringify(message), "application/json"),
  );
  const failed = (detail: string) => {
    const id = requestId(message);
    if (id === undefined) return Effect.void;
    const error = { jsonrpc: "2.0", id, error: { code: INTERNAL_ERROR, message: detail } };
    return isJsonRpc(error) ? deliver(transport, error) : Effect.void;
  };
  return client.execute(request).pipe(
    Effect.flatMap((response) => {
      if (response.status < 200 || response.status >= 300) {
        return failed(`Luke answered ${response.status}`);
      }
      if (requestId(message) === undefined) return Effect.void;
      return response.json.pipe(
        Effect.flatMap((body) =>
          isJsonRpc(body) ? deliver(transport, body) : failed("Luke's answer was no JSON-RPC"),
        ),
      );
    }),
    // Note that the client's error is not kept, because the request it describes carries the bearer.
    Effect.catch(() => failed("Luke unreachable")),
  );
}

/**
 * The Luke MCP server for the CLI's options, relaying to `target` for the
 * rest of the scope. Every message is relayed at once, beside the others, so
 * a long tool call holds up none after it.
 */
export const openMcpRelay = Effect.fn("agent-runner/openMcpRelay")(function* (
  name: string,
  target: string,
  bearer: Redacted.Redacted,
): Effect.fn.Return<McpSdkServerConfigWithInstance, never, HttpClient.HttpClient | Scope.Scope> {
  const client = yield* HttpClient.HttpClient;
  const inbox = yield* Queue.unbounded<Received>();
  yield* Stream.fromQueue(inbox).pipe(
    Stream.mapEffect((received) => relay(client, target, bearer, received), {
      concurrency: "unbounded",
    }),
    Stream.runDrain,
    Effect.forkScoped,
  );
  const server: Pick<SdkServer, "connect"> = {
    connect: (transport) => {
      transport.onmessage = (message) => {
        Queue.offerUnsafe(inbox, { transport, message });
      };
      return transport.start();
    },
  };
  // Note that the SDK calls the instance's `connect` and nothing else of it
  // (0.3.304's `connectSdkMcpServer`), so a relay stands in for an McpServer.
  const instance = server as SdkServer;
  return { type: "sdk", name, instance };
});
