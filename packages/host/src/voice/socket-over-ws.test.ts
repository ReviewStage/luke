import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { SOCKET_OPEN_FAULT, socketOpened } from "@sidecar/voice";
import { test } from "vitest";
import { WebSocketServer } from "ws";
import { openSocketOverWs } from "./socket-over-ws.js";

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
