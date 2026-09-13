import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { it } from "@effect/vitest";
import { sidebandOverSocket } from "@sidecar/voice/live-session";
import { FakeLiveSocket, readSideband } from "@sidecar/voice/testing";
import { Effect, Stream } from "effect";
import { onTestFinished } from "vitest";
import { type RawData, WebSocket, WebSocketServer } from "ws";
import { closeEvent, LIVE_CLIENT_EVENT, LIVE_SERVER_EVENT } from "../server/live";
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

/** Gives the fiber reading the socket its turns, so what the far side said has been read. */
const pause = Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 5)));

it.scopedLive(
  "the upstream socket reads as a sideband: Live events parsed, binary and reflected audio dropped, sends as JSON text, and the far close reported",
  () =>
    Effect.gen(function* () {
      const remote = yield* Effect.promise(() => upstream());
      onTestFinished(() => remote.close());
      const sideband = yield* upstreamSideband(remote.client);
      const read = yield* readSideband(sideband);

      remote.far.send(Buffer.from([1, 2, 3]), { binary: true });
      remote.far.send(
        JSON.stringify({ type: LIVE_SERVER_EVENT.OUTPUT_AUDIO_DELTA, delta: "AAAA" }),
      );
      remote.far.send("not a document");
      remote.far.send(
        JSON.stringify({
          type: LIVE_SERVER_EVENT.SESSION_STARTED,
          event_id: "started",
          session: { id: "sess_1" },
        }),
      );
      yield* sideband.send(closeEvent("close-1"));
      while (remote.received.length === 0 || read.events.length === 0) {
        yield* pause;
      }
      assert.deepEqual(
        read.events.map((event) => event.type),
        [LIVE_SERVER_EVENT.SESSION_STARTED],
      );
      assert.deepEqual(
        remote.received.map((frame) => JSON.parse(frame)),
        [{ type: LIVE_CLIENT_EVENT.CLOSE, event_id: "close-1" }],
      );

      remote.far.close(1000);
      while (read.closes.length === 0) {
        yield* pause;
      }
      assert.deepEqual(
        read.closes.map((close) => close.code ?? -1),
        [1000],
      );
    }),
);

function started(id: string) {
  return { type: LIVE_SERVER_EVENT.SESSION_STARTED, event_id: `started-${id}`, session: { id } };
}

it.scopedLive(
  "an observed sideband hands each event to the observer once, ahead of the reader that runs its arrivals, replay included, and the sends and close pass through",
  () =>
    Effect.gen(function* () {
      const socket = new FakeLiveSocket();
      const observed: string[] = [];
      const order: string[] = [];
      const closes: (number | undefined)[] = [];
      const sideband = observedSideband(sidebandOverSocket(socket), (event) => {
        observed.push("event_id" in event ? event.event_id : "");
        order.push("observer");
      });

      // Said before anyone read: held by the socket, observed and read when the
      // session's one reader comes. The pause between each is that reader's turn.
      socket.receive(started("early"));
      yield* pause;
      yield* Effect.forkScoped(
        Stream.runForEach(sideband.arrivals, (arrival) =>
          Effect.sync(() => {
            if ("close" in arrival) closes.push(arrival.close.code);
            else order.push("reader");
          }),
        ),
      );
      yield* pause;
      socket.receive(started("late"));
      yield* pause;
      socket.receive(started("later"));
      yield* pause;

      assert.deepEqual(observed, ["started-early", "started-late", "started-later"]);
      assert.deepEqual(order, ["observer", "reader", "observer", "reader", "observer", "reader"]);

      yield* sideband.send(closeEvent("c"));
      socket.closeFromServer({ code: 1006 });
      yield* pause;
      yield* sideband.close;
      assert.deepEqual(
        socket.sent.map((frame) => JSON.parse(frame)),
        [{ type: LIVE_CLIENT_EVENT.CLOSE, event_id: "c" }],
      );
      assert.deepEqual(closes, [1006]);
      assert.equal(socket.closedByClient, true);
    }),
);
