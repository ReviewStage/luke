import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import { it } from "@effect/vitest";
import { SOCKET_OPEN_FAULT, socketOpened } from "@sidecar/voice";
import { Effect } from "effect";
import { test } from "vitest";
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

test("the ws seam opens with the handshake headers it is handed, carries text both ways, and reports the far side's close", async () => {
  const remote = await server({ bearer: "key", refuseWith: 401 });
  try {
    const opening = await openSocketOverWs(remote.url, { authorization: "Bearer key" });
    assert.equal(socketOpened(opening), true);
    if (!socketOpened(opening)) return;
    assert.deepEqual(remote.seen, [
      { authorization: "Bearer key", url: "/v1/live/sessions/sess_1/attach" },
    ]);
    const messages: string[] = [];
    const closes: number[] = [];
    opening.socket.onMessage((data) => messages.push(data));
    const closed = new Promise<void>((resolve) => {
      opening.socket.onClose((close) => {
        closes.push(close.code ?? -1);
        resolve();
      });
    });
    opening.socket.send("hello");
    while (messages.length === 0) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.deepEqual(messages, [JSON.stringify({ echoed: "hello" })]);
    opening.socket.close();
    await closed;
    assert.equal(closes.length, 1);
  } finally {
    await remote.close();
  }
});

test("a refused upgrade answers its status, and nothing listening answers a network fault by name", async () => {
  const remote = await server({ bearer: "key", refuseWith: 401 });
  try {
    const refused = await openSocketOverWs(remote.url, { authorization: "Bearer wrong" });
    assert.deepEqual(refused, { fault: SOCKET_OPEN_FAULT.REFUSED, status: 401 });
  } finally {
    await remote.close();
  }
  const unreachable = await openSocketOverWs("ws://127.0.0.1:9/attach", {});
  assert.equal(socketOpened(unreachable), false);
  if (socketOpened(unreachable)) return;
  assert.equal(unreachable.fault, SOCKET_OPEN_FAULT.NETWORK);
});

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
        const opening = yield* Effect.promise(() => openSocketOverWs(endpoint.url, {}));
        assert.ok(socketOpened(opening));
        // One more turn than the continuation already cost: the frames must still be waiting.
        let tickPassed = false;
        queueMicrotask(() => {
          tickPassed = true;
        });
        yield* waitFor(() => tickPassed);
        const types: string[] = [];
        opening.socket.onMessage((data) => {
          // SAFETY: the test wrote these frames as JSON objects with a string type.
          types.push((JSON.parse(data) as { type: string }).type);
        });
        assert.deepEqual(types, ["session.started", "session.input_audio.muted"]);
        opening.socket.close();
      } finally {
        yield* Effect.promise(() => endpoint.close());
      }
    }),
);
