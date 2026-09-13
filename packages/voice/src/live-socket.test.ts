import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { closeEvent, LIVE_SERVER_EVENT, thinkingAppend } from "@sidecar/live";
import { Effect } from "effect";
import { test } from "vitest";
import { SOCKET_OPEN_FAULT, sidebandOverSocket, socketOpened } from "./live-socket.js";
import { FakeLiveSocket, readSideband } from "./testing.js";

/** Lets the fiber reading the sideband's arrivals read what the far side has said. */
function settle() {
  return Effect.gen(function* () {
    for (let turn = 0; turn < 20; turn += 1) yield* Effect.yieldNow;
  });
}

it.effect("a sideband parses the socket's frames and drops reflected audio by type", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const socket = new FakeLiveSocket();
      const read = yield* readSideband(sidebandOverSocket(socket));

      socket.receive({
        type: LIVE_SERVER_EVENT.SESSION_STARTED,
        event_id: "ev_1",
        session: { id: "ls_1" },
      });
      socket.receive({ type: LIVE_SERVER_EVENT.INPUT_AUDIO_APPEND, audio: "AAAA" });
      socket.receive({ type: LIVE_SERVER_EVENT.OUTPUT_AUDIO_DELTA, delta: "AAAA" });
      socket.receiveText("not json");
      socket.receive({ type: "session.unknown" });
      socket.receive({
        type: LIVE_SERVER_EVENT.INPUT_TRANSCRIPT_DELTA,
        event_id: "ev_2",
        delta: " hi",
        start_ms: 0,
        end_ms: 400,
      });
      yield* settle();

      assert.deepEqual(
        read.events.map((event) => event.type),
        [LIVE_SERVER_EVENT.SESSION_STARTED, LIVE_SERVER_EVENT.INPUT_TRANSCRIPT_DELTA],
      );
    }),
  ),
);

it.effect("a sideband sends client events as JSON frames and closes the socket it stands on", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const socket = new FakeLiveSocket();
      const sideband = sidebandOverSocket(socket);
      const append = thinkingAppend({ eventId: "ev_a", delegationId: null, content: "roster" });

      yield* sideband.send(append);
      yield* sideband.send(closeEvent("ev_b"));
      yield* sideband.close;

      assert.deepEqual(
        socket.sent.map((frame) => JSON.parse(frame)),
        [append, closeEvent("ev_b")],
      );
      assert.equal(socket.closedByClient, true);
    }),
  ),
);

it.effect("a sideband's arrivals end with the socket's close, and nothing follows it", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const socket = new FakeLiveSocket();
      const read = yield* readSideband(sidebandOverSocket(socket));

      socket.closeFromServer({ code: 1006 });
      yield* settle();
      socket.closeFromServer({ code: 1000 });
      yield* settle();

      assert.deepEqual(read.closes, [{ code: 1006 }]);
    }),
  ),
);

test("an opening is a socket or one of the two faults", () => {
  assert.equal(socketOpened({ socket: new FakeLiveSocket() }), true);
  assert.equal(socketOpened({ fault: SOCKET_OPEN_FAULT.REFUSED, status: 401 }), false);
  assert.equal(socketOpened({ fault: SOCKET_OPEN_FAULT.NETWORK }), false);
});

it.effect(
  "a sideband holds what arrived before anyone read it and replays it to the first consumer",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const socket = new FakeLiveSocket();
        const sideband = sidebandOverSocket(socket);
        socket.receive({
          type: LIVE_SERVER_EVENT.SESSION_STARTED,
          event_id: "ev_1",
          session: { id: "ls_1" },
        });
        socket.receive({ type: LIVE_SERVER_EVENT.OUTPUT_AUDIO_DELTA, delta: "AAAA" });
        socket.closeFromServer({ code: 1006 });
        yield* settle();

        const read = yield* readSideband(sideband);
        const late = yield* readSideband(sideband);
        yield* settle();

        assert.deepEqual(
          read.events.map((event) => event.type),
          [LIVE_SERVER_EVENT.SESSION_STARTED],
        );
        assert.deepEqual(late.events, []);
        assert.deepEqual(read.closes, [{ code: 1006 }]);
      }),
    ),
);
