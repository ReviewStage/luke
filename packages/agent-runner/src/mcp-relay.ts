import type { McpSdkServerConfigWithInstance } from "@anthropic-ai/claude-agent-sdk";
import { Effect, Predicate, Queue, type Redacted, type Scope, Stream } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";

type SdkServer = McpSdkServerConfigWithInstance["instance"];
type CliTransport = Parameters<SdkServer["connect"]>[0];
type JsonRpcMessage = Parameters<CliTransport["send"]>[0];

const INTERNAL_ERROR = -32603;

interface Received {
  readonly transport: CliTransport;
  readonly message: JsonRpcMessage;
}

function requestId(message: JsonRpcMessage): string | number | undefined {
  if (!("method" in message) || !("id" in message)) return undefined;
  const id: unknown = message.id;
  return typeof id === "string" || typeof id === "number" ? id : undefined;
}

function isJsonRpc(value: unknown): value is JsonRpcMessage {
  return Predicate.isObject(value) && "jsonrpc" in value && value.jsonrpc === "2.0";
}

function deliver(transport: CliTransport, message: JsonRpcMessage) {
  return Effect.tryPromise(() => transport.send(message)).pipe(Effect.ignore);
}

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
        return failed(`The service answered ${response.status}`);
      }
      if (requestId(message) === undefined) return Effect.void;
      return response.json.pipe(
        Effect.flatMap((body) =>
          isJsonRpc(body)
            ? deliver(transport, body)
            : failed("The service's answer was no JSON-RPC"),
        ),
      );
    }),
    Effect.catch(() => failed("Service unreachable")),
  );
}

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
  const instance = server as SdkServer;
  return { type: "sdk", name, instance };
});
