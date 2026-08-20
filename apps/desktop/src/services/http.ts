import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { CLOUD_FAILURE, CloudFailure } from "@sidecar/core/effect-errors";
import { Context, Effect, Layer } from "effect";
import * as Data from "effect/Data";

export class Http extends Context.Tag("Http")<
  Http,
  {
    readonly request: (url: string, init: RequestInit) => Effect.Effect<Response, CloudFailure>;
    readonly readJson: (response: Response) => Effect.Effect<unknown, CloudFailure>;
    readonly listenLoopback: (options: {
      host: string;
      port: number | 0;
      onRequest: (
        request: IncomingMessage,
        response: ServerResponse,
      ) => Effect.Effect<void, LoopbackFailure>;
    }) => Effect.Effect<{ server: Server; port: number }, LoopbackFailure>;
    readonly closeServer: (server: Server) => Effect.Effect<void, LoopbackFailure>;
    readonly closeAllConnections: (server: Server) => Effect.Effect<void>;
  }
>() {}

export class LoopbackFailure extends Data.TaggedError("LoopbackFailure")<{
  readonly reason: string;
}> {}

/** Runs a request handler at the composition root; assigned before loopback listens. */
export type RunRequestEffect = <A, E, R>(effect: Effect.Effect<A, E, R>) => void;

function closeServerPromise(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

function listenLoopback(
  runRequest: RunRequestEffect,
  options: {
    host: string;
    port: number | 0;
    onRequest: (
      request: IncomingMessage,
      response: ServerResponse,
    ) => Effect.Effect<void, LoopbackFailure>;
  },
): Effect.Effect<{ server: Server; port: number }, LoopbackFailure> {
  return Effect.async((resume) => {
    const server = createServer((request, response) => {
      runRequest(
        options.onRequest(request, response).pipe(
          Effect.catchAll(() =>
            Effect.sync(() => {
              if (!response.writableEnded) {
                response.writeHead(500, { "content-type": "text/plain" }).end("Internal error");
              }
            }),
          ),
        ),
      );
    });
    server.once("error", (error) => {
      resume(
        Effect.fail(
          new LoopbackFailure({
            reason: error instanceof Error ? error.message : "loopback listen failed",
          }),
        ),
      );
    });
    server.listen(options.port, options.host, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        resume(Effect.fail(new LoopbackFailure({ reason: "loopback address unavailable" })));
        return;
      }
      // SAFETY: TCP loopback listen returns AddressInfo; Unix socket paths never arise on this host binding.
      resume(Effect.succeed({ server, port: (address as AddressInfo).port }));
    });
  });
}

export function makeHttpLive(runRequest: RunRequestEffect): Layer.Layer<Http> {
  return Layer.succeed(Http, {
    request: (url, init) =>
      Effect.tryPromise({
        try: () => fetch(url, init),
        catch: () =>
          new CloudFailure({
            failure: CLOUD_FAILURE.TRANSIENT,
            provider: "http",
          }),
      }),
    readJson: (response) =>
      Effect.tryPromise({
        try: () => response.json(),
        catch: () =>
          new CloudFailure({
            failure: CLOUD_FAILURE.TRANSIENT,
            provider: "http",
          }),
      }),
    listenLoopback: (options) => listenLoopback(runRequest, options),
    closeServer: (server) =>
      Effect.tryPromise({
        try: () => closeServerPromise(server),
        catch: (error) =>
          new LoopbackFailure({
            reason: error instanceof Error ? error.message : "loopback close failed",
          }),
      }),
    closeAllConnections: (server) =>
      Effect.sync(() => {
        server.closeAllConnections();
      }),
  });
}
