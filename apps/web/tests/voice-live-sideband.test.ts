import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { it } from "@effect/vitest";
import { sidebandOverSocket } from "@sidecar/voice/live-session";
import { arrival, FakeLiveSocket, onFakeChange, readSideband } from "@sidecar/voice/testing";
import { Effect, Stream } from "effect";
import { onTestFinished } from "vitest";
import { type RawData, WebSocket, WebSocketServer } from "ws";
import { closeEvent, LIVE_CLIENT_EVENT, LIVE_SERVER_EVENT } from "../server/live";
import { observedSideband, upstreamSideband } from "../server/voice/live-sideband";

/**
 * The sideband over a real loopback socket and over a fake one. Every wait
 * here stands on the event itself — a frame the far side heard, an arrival
 * the reader ran — and never on a pause, since `ws` delivers frames on IO
 * ticks a fiber yield would not wait for.
 */

/** Tells whoever is waiting that a fake moved, so a wait stands on the event rather than on time. */
function notifier() {
  const listeners = new Set<() => void>();
  return {
    notify: (): void => {
      for (const listener of [...listeners]) listener();
    },
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** OpenAI's end of one attach, stood up on this machine: what it sends the sideband hears, what the sideband sends it keeps. */
async function upstream() {
  const server = http.createServer();
  const sockets = new WebSocketServer({ server });
  const received: string[] = [];
  const heard = notifier();
  const attached = new Promise<WebSocket>((resolve) => {
    sockets.once("connection", (socket) => {
      socket.on("message", (data: RawData) => {
        received.push(data.toString());
        heard.notify();
      });
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
    onReceived: heard.subscribe,
    close: async () => {
      sockets.close();
      server.closeAllConnections();
      server.close();
      await once(server, "close");
    },
  };
}

it.effect(
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
      yield* arrival(remote.onReceived, () => remote.received.length > 0, "the close frame sent");
      yield* arrival(onFakeChange, () => read.events.length > 0, "the started event read");
      assert.deepEqual(
        read.events.map((event) => event.type),
        [LIVE_SERVER_EVENT.SESSION_STARTED],
      );
      assert.deepEqual(
        remote.received.map((frame) => JSON.parse(frame)),
        [{ type: LIVE_CLIENT_EVENT.CLOSE, event_id: "close-1" }],
      );

      remote.far.close(1000);
      yield* arrival(onFakeChange, () => read.closes.length > 0, "the far close read");
      assert.deepEqual(
        read.closes.map((close) => close.code ?? -1),
        [1000],
      );
    }),
);

function started(id: string) {
  return { type: LIVE_SERVER_EVENT.SESSION_STARTED, event_id: `started-${id}`, session: { id } };
}

it.effect(
  "an observed sideband hands each event to the observer once, ahead of the reader that runs its arrivals, replay included, and the sends and close pass through",
  () =>
    Effect.gen(function* () {
      const socket = new FakeLiveSocket();
      const observed: string[] = [];
      const order: string[] = [];
      const closes: (number | undefined)[] = [];
      const ran = notifier();
      const sideband = observedSideband(sidebandOverSocket(socket), (event) => {
        observed.push("event_id" in event ? event.event_id : "");
        order.push("observer");
        ran.notify();
      });

      // Said before anyone read: held by the socket, observed and read when the
      // session's one reader comes. Each wait below is for that reader's pass
      // over the event just delivered, which is what puts the two in order.
      socket.receive(started("early"));
      yield* Effect.forkScoped(
        Stream.runForEach(sideband.arrivals, (heard) =>
          Effect.sync(() => {
            if ("close" in heard) closes.push(heard.close.code);
            else order.push("reader");
            ran.notify();
          }),
        ),
      );
      yield* arrival(ran.subscribe, () => order.length === 2, "the early event observed and read");
      socket.receive(started("late"));
      yield* arrival(ran.subscribe, () => order.length === 4, "the late event observed and read");
      socket.receive(started("later"));
      yield* arrival(ran.subscribe, () => order.length === 6, "the later event observed and read");

      assert.deepEqual(observed, ["started-early", "started-late", "started-later"]);
      assert.deepEqual(order, ["observer", "reader", "observer", "reader", "observer", "reader"]);

      yield* sideband.send(closeEvent("c"));
      socket.closeFromServer({ code: 1006 });
      yield* arrival(ran.subscribe, () => closes.length === 1, "the server close read");
      yield* sideband.close;
      assert.deepEqual(
        socket.sent.map((frame) => JSON.parse(frame)),
        [{ type: LIVE_CLIENT_EVENT.CLOSE, event_id: "c" }],
      );
      assert.deepEqual(closes, [1006]);
      assert.equal(socket.closedByClient, true);
    }),
);
