import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { it } from "@effect/vitest";
import { socketOpened } from "@luke/voice";
import { Effect, Stream } from "effect";
import { WebSocketServer } from "ws";
import { openVoiceSocketOverWs } from "./voice-socket-over-ws.js";

/** Gives the fiber scheduler turns until `condition` holds, or fails the test if it never does. */
function waitFor(condition: () => boolean, rounds = 300): Effect.Effect<void> {
  return Effect.gen(function* () {
    for (let round = 0; round < rounds; round += 1) {
      if (condition()) return;
      for (let tick = 0; tick < 100; tick += 1) yield* Effect.yieldNow;
    }
    assert.ok(condition(), "the condition did not hold in time");
  });
}

/** A local upgrade endpoint that admits a bearer and refuses everything else with a status. */
async function server(options: { bearer: string; refuseWith: number }) {
  const httpServer = http.createServer((_request, response) => {
    response.statusCode = 404;
    response.end();
  });
  const socketServer = new WebSocketServer({ noServer: true });
  const seen: { authorization: string | undefined; url: string | undefined }[] = [];
  httpServer.on("upgrade", (request, socket, head) => {
    seen.push({ authorization: request.headers.authorization, url: request.url });
    if (request.headers.authorization !== `Bearer ${options.bearer}`) {
      socket.write(`HTTP/1.1 ${options.refuseWith} Refused\r\nConnection: close\r\n\r\n`);
      socket.destroy();
      return;
    }
    socketServer.handleUpgrade(request, socket, head, (client) => {
      client.on("message", (data) => {
        client.send(JSON.stringify({ echoed: String(data) }));
      });
    });
  });
  httpServer.listen(0, "127.0.0.1");
  await once(httpServer, "listening");
  // SAFETY: a listening TCP server answers its bound address as AddressInfo, never a pipe path.
  const { port } = httpServer.address() as AddressInfo;
  return {
    url: `ws://127.0.0.1:${port}/v1/live/sessions/sess_1/attach`,
    seen,
    close: async () => {
      socketServer.close();
      httpServer.close();
      await once(httpServer, "close");
    },
  };
}

it.effect(
  "the ws seam opens with the handshake headers it is handed, carries text both ways, and reports the far side's close",
  () =>
    Effect.gen(function* () {
      const remote = yield* Effect.promise(() => server({ bearer: "key", refuseWith: 401 }));
      try {
        const opening = yield* openVoiceSocketOverWs(remote.url, { authorization: "Bearer key" });
        assert.equal(socketOpened(opening), true);
        if (!socketOpened(opening)) return;
        assert.deepEqual(remote.seen, [
          { authorization: "Bearer key", url: "/v1/live/sessions/sess_1/attach" },
        ]);
        const messages: string[] = [];
        const closes: number[] = [];
        let ended = false;
        yield* Effect.forkChild(
          Stream.runForEach(opening.socket.arrivals, (arrival) =>
            Effect.sync(() => {
              if ("frame" in arrival) {
                messages.push(arrival.frame);
                return;
              }
              closes.push(arrival.close.code ?? -1);
              ended = true;
            }),
          ),
        );
        opening.socket.send("hello");
        yield* waitFor(() => messages.length > 0);
        assert.deepEqual(messages, [JSON.stringify({ echoed: "hello" })]);
        opening.socket.close();
        yield* waitFor(() => ended);
        assert.equal(closes.length, 1);
      } finally {
        yield* Effect.promise(() => remote.close());
      }
    }),
);
