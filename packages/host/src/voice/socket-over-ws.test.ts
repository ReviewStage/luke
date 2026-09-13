import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { it } from "@effect/vitest";
import { SOCKET_OPEN_FAULT, socketOpened } from "@sidecar/voice";
import { Effect, Exit, Fiber, Stream } from "effect";
import { WebSocketServer } from "ws";
import { openSocketOverWs } from "./socket-over-ws.js";

/** Gives the fiber scheduler turns until `condition` holds, or fails the test if it never does. */
function waitFor(condition: () => boolean, rounds = 300): Effect.Effect<void> {
  return Effect.gen(function* () {
    for (let round = 0; round < rounds; round += 1) {
      if (condition()) return;
      for (let tick = 0; tick < 100; tick += 1) yield* Effect.yieldNow();
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
        const opening = yield* openSocketOverWs(remote.url, { authorization: "Bearer key" });
        assert.equal(socketOpened(opening), true);
        if (!socketOpened(opening)) return;
        assert.deepEqual(remote.seen, [
          { authorization: "Bearer key", url: "/v1/live/sessions/sess_1/attach" },
        ]);
        const messages: string[] = [];
        const closes: number[] = [];
        let ended = false;
        yield* Effect.fork(
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

it.effect(
  "a refused upgrade answers its status, and nothing listening answers a network fault by name",
  () =>
    Effect.gen(function* () {
      const remote = yield* Effect.promise(() => server({ bearer: "key", refuseWith: 401 }));
      try {
        const refused = yield* openSocketOverWs(remote.url, { authorization: "Bearer wrong" });
        assert.deepEqual(refused, { fault: SOCKET_OPEN_FAULT.REFUSED, status: 401 });
      } finally {
        yield* Effect.promise(() => remote.close());
      }
      const unreachable = yield* openSocketOverWs("ws://127.0.0.1:9/attach", {});
      assert.equal(socketOpened(unreachable), false);
      if (socketOpened(unreachable)) return;
      assert.equal(unreachable.fault, SOCKET_OPEN_FAULT.NETWORK);
    }),
);

/** Gives the event loop real turns until `condition` holds, for a condition only the network can settle. */
function waitOnTheNetwork(condition: () => boolean, rounds = 400): Effect.Effect<void> {
  return Effect.gen(function* () {
    for (let round = 0; round < rounds; round += 1) {
      if (condition()) return;
      yield* Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 5)));
    }
    assert.ok(condition(), "the condition did not hold in time");
  });
}

/** An endpoint that accepts the upgrade request and never answers it, so the handshake stands until the client gives it up. */
async function serverThatNeverAnswers() {
  const httpServer = http.createServer();
  const held = new Set<Duplex>();
  let ended = 0;
  httpServer.on("upgrade", (_request, socket) => {
    held.add(socket);
    socket.on("end", () => {
      ended += 1;
    });
    socket.resume();
  });
  httpServer.listen(0, "127.0.0.1");
  await once(httpServer, "listening");
  // SAFETY: a listening TCP server answers its bound address as AddressInfo, never a pipe path.
  const { port } = httpServer.address() as AddressInfo;
  return {
    url: `ws://127.0.0.1:${port}/v1/live/sessions/sess_1/attach`,
    connected: () => held.size,
    ended: () => ended,
    close: async () => {
      for (const socket of held) socket.destroy();
      httpServer.close();
      await once(httpServer, "close");
    },
  };
}

it.effect(
  "an open interrupted before the handshake answered leaves no socket connecting behind it",
  () =>
    Effect.gen(function* () {
      const remote = yield* Effect.promise(() => serverThatNeverAnswers());
      try {
        const opening = yield* Effect.fork(openSocketOverWs(remote.url, {}));
        yield* waitOnTheNetwork(() => remote.connected() === 1);
        assert.equal(Exit.isInterrupted(yield* Fiber.interrupt(opening)), true);
        // The handshake the interrupted attempt began is given up rather than left standing.
        yield* waitOnTheNetwork(() => remote.ended() === 1);
        assert.equal(remote.ended(), 1);
      } finally {
        yield* Effect.promise(() => remote.close());
      }
    }),
);

/** One unmasked server-to-client text frame, as the wire carries it (FIN set, opcode text, one-byte length). */
function textFrame(text: string): Buffer {
  const payload = Buffer.from(text, "utf8");
  assert.ok(payload.length < 126);
  return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
}

/**
 * An upgrade endpoint that answers the handshake and the session's first
 * frames in ONE write, so the frames sit in the same chunk as the response:
 * the production timing a promise continuation is one tick too late for.
 */
async function serverSpeakingWithTheHandshake(frames: readonly string[]) {
  const httpServer = http.createServer((_request, response) => {
    response.statusCode = 404;
    response.end();
  });
  const upgraded = new Set<Duplex>();
  httpServer.on("upgrade", (request, socket) => {
    upgraded.add(socket);
    const key = request.headers["sec-websocket-key"] ?? "";
    const accept = createHash("sha1")
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
      .digest("base64");
    const response = [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "",
      "",
    ].join("\r\n");
    socket.write(Buffer.concat([Buffer.from(response, "latin1"), ...frames.map(textFrame)]));
  });
  httpServer.listen(0, "127.0.0.1");
  await once(httpServer, "listening");
  // SAFETY: a listening TCP server answers its bound address as AddressInfo, never a pipe path.
  const { port } = httpServer.address() as AddressInfo;
  return {
    url: `ws://127.0.0.1:${port}/v1/live/sessions/sess_1/attach`,
    close: async () => {
      // An upgraded socket is no longer the HTTP server's to close, and this server answers no
      // close handshake, so the connections are dropped outright.
      for (const socket of upgraded) socket.destroy();
      httpServer.close();
      await once(httpServer, "close");
    },
  };
}

it.effect(
  "frames in the same chunk as the handshake response reach a consumer that subscribes after the open settles, in order",
  () =>
    Effect.gen(function* () {
      const spoken = [
        JSON.stringify({ type: "session.started" }),
        JSON.stringify({ type: "session.input_audio.muted" }),
      ];
      const endpoint = yield* Effect.promise(() => serverSpeakingWithTheHandshake(spoken));
      try {
        const opening = yield* openSocketOverWs(endpoint.url, {});
        assert.ok(socketOpened(opening));
        // One more turn than the continuation already cost: the frames must still be waiting.
        let tickPassed = false;
        queueMicrotask(() => {
          tickPassed = true;
        });
        yield* waitFor(() => tickPassed);
        const types: string[] = [];
        yield* Effect.fork(
          Stream.runForEach(opening.socket.arrivals, (arrival) =>
            Effect.sync(() => {
              if (!("frame" in arrival)) return;
              // SAFETY: the test wrote these frames as JSON objects with a string type.
              types.push((JSON.parse(arrival.frame) as { type: string }).type);
            }),
          ),
        );
        yield* waitFor(() => types.length > 1);
        assert.deepEqual(types, ["session.started", "session.input_audio.muted"]);
        opening.socket.close();
      } finally {
        yield* Effect.promise(() => endpoint.close());
      }
    }),
);
