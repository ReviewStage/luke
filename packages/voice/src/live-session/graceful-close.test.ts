import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { LIVE_CLIENT_EVENT, LIVE_CLOSE_REASON, type LiveServerEvent } from "@sidecar/live";
import { Duration, Effect, Fiber, TestClock } from "effect";
import { sidebandOverSocket } from "../live-socket.js";
import { FakeLiveSocket } from "../testing.js";
import {
  closeGracefully,
  SIDEBAND_CLOSE_OUTCOME,
  SIDEBAND_CLOSE_TIMEOUT_MS,
} from "./graceful-close.js";

function closedEvent(reason: string, seconds: number) {
  return {
    type: "session.closed",
    event_id: "closed",
    reason,
    usage: { seconds },
  };
}

/** Lets the forked close reach its wait, and whatever a received event started run its course. */
function settle() {
  return Effect.gen(function* () {
    for (let turn = 0; turn < 20; turn += 1) yield* Effect.yieldNow();
  });
}

it.effect(
  "a graceful close registers the closed listener, sends session.close, and holds the socket until the final event",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const socket = new FakeLiveSocket();
        const sideband = yield* sidebandOverSocket(socket);
        const heard: LiveServerEvent[] = [];
        sideband.onEvent((event) => heard.push(event));
        const closing = yield* Effect.fork(closeGracefully(sideband, { eventId: "close-1" }));
        yield* settle();
        assert.deepEqual(
          socket.sent.map((frame) => JSON.parse(frame)),
          [{ type: LIVE_CLIENT_EVENT.CLOSE, event_id: "close-1" }],
        );
        assert.equal(socket.closedByClient, false);
        socket.receive(closedEvent(LIVE_CLOSE_REASON.CLOSE_REQUESTED, 61));
        const result = yield* Fiber.join(closing);
        assert.equal(result.outcome, SIDEBAND_CLOSE_OUTCOME.CLOSED);
        if (result.outcome !== SIDEBAND_CLOSE_OUTCOME.CLOSED) return;
        assert.deepEqual(
          [result.closed.reason, result.closed.usage.seconds],
          [LIVE_CLOSE_REASON.CLOSE_REQUESTED, 61],
        );
        assert.equal(socket.closedByClient, true);
        // Nothing is left armed that the timeout's own instant could still act on.
        yield* TestClock.adjust(Duration.millis(SIDEBAND_CLOSE_TIMEOUT_MS));
        yield* settle();
        assert.equal(socket.sent.length, 1);
      }),
    ),
);

it.effect(
  "a socket that ends first leaves the close unconfirmed, and silence gives up at the timeout",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const lost = new FakeLiveSocket();
        const losing = yield* Effect.fork(
          closeGracefully(yield* sidebandOverSocket(lost), { eventId: "c" }),
        );
        yield* settle();
        lost.closeFromServer({ code: 1006 });
        assert.deepEqual(yield* Fiber.join(losing), {
          outcome: SIDEBAND_CLOSE_OUTCOME.CONNECTION_LOST,
          close: { code: 1006 },
        });

        const silent = new FakeLiveSocket();
        const timing = yield* Effect.fork(
          closeGracefully(yield* sidebandOverSocket(silent), { eventId: "c", timeoutMs: 50 }),
        );
        yield* settle();
        yield* TestClock.adjust(Duration.millis(49));
        assert.equal(silent.closedByClient, false);
        yield* TestClock.adjust(Duration.millis(1));
        assert.deepEqual(yield* Fiber.join(timing), { outcome: SIDEBAND_CLOSE_OUTCOME.TIMED_OUT });
        assert.equal(silent.closedByClient, true);
      }),
    ),
);
