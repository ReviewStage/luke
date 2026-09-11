import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { type LiveSideband, sidebandOverSocket } from "@sidecar/voice/live-session";
import { FakeLiveSocket } from "@sidecar/voice/testing";
import { onTestFinished, test } from "vitest";
import { type RawData, WebSocket, WebSocketServer } from "ws";
import {
  closeEvent,
  LIVE_CLIENT_EVENT,
  LIVE_SERVER_EVENT,
  type LiveServerEvent,
} from "../server/live";
import { observedSideband, upstreamSideband } from "../server/voice/live-sideband";

/** OpenAI's end of one attach, stood up on this machine: what it sends the sideband hears, what the sideband sends it keeps. */
async function upstream() {
  const server = http.createServer();
  const sockets = new WebSocketServer({ server });
  const received: string[] = [];
  const attached = new Promise<WebSocket>((resolve) => {
    sockets.once("connection", (socket) => {
      socket.on("message", (data: RawData) => received.push(data.toString()));
      resolve(socket);
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  // SAFETY: a listening TCP server answers its bound address as AddressInfo, never a pipe path.
  const { port } = server.address() as AddressInfo;
  const client = new WebSocket(`ws://127.0.0.1:${port}/v1/live/sessions/sess_1/attach`);
  await once(client, "open");
  const far = await attached;
  return {
    client,
    far,
    received,
    close: async () => {
      sockets.close();
      server.closeAllConnections();
      server.close();
      await once(server, "close");
    },
  };
}

test("the upstream socket reads as a sideband: Live events parsed, binary and reflected audio dropped, sends as JSON text, and the far close reported", async () => {
  const remote = await upstream();
  onTestFinished(() => remote.close());
  const sideband = upstreamSideband(remote.client);
  const heard: LiveServerEvent[] = [];
  const closes: number[] = [];
  sideband.onEvent((event) => heard.push(event));
  const closed = new Promise<void>((resolve) => {
    sideband.onClose((close) => {
      closes.push(close.code ?? -1);
      resolve();
    });
  });

  remote.far.send(Buffer.from([1, 2, 3]), { binary: true });
  remote.far.send(JSON.stringify({ type: LIVE_SERVER_EVENT.OUTPUT_AUDIO_DELTA, delta: "AAAA" }));
  remote.far.send("not a document");
  remote.far.send(
    JSON.stringify({
      type: LIVE_SERVER_EVENT.SESSION_STARTED,
      event_id: "started",
      session: { id: "sess_1" },
    }),
  );
  sideband.send(closeEvent("close-1"));
  while (remote.received.length === 0 || heard.length === 0) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.deepEqual(
    heard.map((event) => event.type),
    [LIVE_SERVER_EVENT.SESSION_STARTED],
  );
  assert.deepEqual(
    remote.received.map((frame) => JSON.parse(frame)),
    [{ type: LIVE_CLIENT_EVENT.CLOSE, event_id: "close-1" }],
  );

  remote.far.close(1000);
  await closed;
  assert.deepEqual(closes, [1000]);
});

function started(id: string) {
  return { type: LIVE_SERVER_EVENT.SESSION_STARTED, event_id: `started-${id}`, session: { id } };
}

test("an observed sideband hands each event to the observer once, ahead of every listener, replay included, and the sends and close pass through", () => {
  const socket = new FakeLiveSocket();
  const observed: string[] = [];
  const order: string[] = [];
  const sideband: LiveSideband = observedSideband(sidebandOverSocket(socket), (event) => {
    observed.push("event_id" in event ? event.event_id : "");
    order.push("observer");
  });

  // Said before anyone listened: held by the inner sideband, replayed at the first listener.
  socket.receive(started("early"));
  const stopFirst = sideband.onEvent(() => order.push("first"));
  sideband.onEvent(() => order.push("second"));
  socket.receive(started("late"));
  stopFirst();
  socket.receive(started("later"));

  assert.deepEqual(observed, ["started-early", "started-late", "started-later"]);
  assert.deepEqual(order, [
    "observer",
    "first",
    "observer",
    "first",
    "second",
    "observer",
    "second",
  ]);

  const closes: (number | undefined)[] = [];
  sideband.onClose((close) => closes.push(close.code));
  sideband.send(closeEvent("c"));
  socket.closeFromServer({ code: 1006 });
  sideband.close();
  assert.deepEqual(
    socket.sent.map((frame) => JSON.parse(frame)),
    [{ type: LIVE_CLIENT_EVENT.CLOSE, event_id: "c" }],
  );
  assert.deepEqual(closes, [1006]);
  assert.equal(socket.closedByClient, true);
});
