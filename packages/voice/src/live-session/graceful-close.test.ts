import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { LIVE_CLIENT_EVENT, LIVE_CLOSE_REASON, type LiveServerEvent } from "@sidecar/live";
import { Duration, Effect, type Fiber, FiberId, Runtime, TestClock } from "effect";
import { sidebandOverSocket } from "../live-socket.js";
import { FakeLiveSocket } from "../testing.js";
import type { TimerHandle } from "./append-channel.js";
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

/**
 * `closeGracefully`'s `schedule`/`cancel` seam over whichever runtime a test
 * is running on, so its timeout fires on the ambient `TestClock` a test
 * advances rather than a real one.
 */
function clockBridge(runtime: Runtime.Runtime<never>) {
  const fork = Runtime.runFork(runtime);
  const armed = new Map<TimerHandle, Fiber.RuntimeFiber<void>>();
  const delays: number[] = [];
  return {
    schedule: (callback: () => void, delayMs: number): TimerHandle => {
      const handle: TimerHandle = {};
      delays.push(delayMs);
      const fiber = fork(
        Effect.delay(Effect.sync(callback), Duration.millis(delayMs)).pipe(
          Effect.ensuring(Effect.sync(() => armed.delete(handle))),
        ),
      );
      armed.set(handle, fiber);
      return handle;
    },
    cancel: (timer: TimerHandle): void => {
      const fiber = armed.get(timer);
      if (fiber === undefined) return;
      armed.delete(timer);
      fiber.unsafeInterruptAsFork(FiberId.none);
    },
    delays,
    armed: () => armed.size,
  };
}

it.effect(
  "a graceful close registers the closed listener, sends session.close, and holds the socket until the final event",
  () =>
    Effect.gen(function* () {
      const runtime = yield* Effect.runtime<never>();
      const clock = clockBridge(runtime);
      const socket = new FakeLiveSocket();
      const sideband = sidebandOverSocket(socket);
      const heard: LiveServerEvent[] = [];
      sideband.onEvent((event) => heard.push(event));
      const closing = closeGracefully(sideband, {
        eventId: "close-1",
        schedule: clock.schedule,
        cancel: clock.cancel,
      });
      for (let i = 0; i < 20; i += 1) yield* Effect.yieldNow();
      assert.deepEqual(
        socket.sent.map((frame) => JSON.parse(frame)),
        [{ type: LIVE_CLIENT_EVENT.CLOSE, event_id: "close-1" }],
      );
      assert.equal(socket.closedByClient, false);
      assert.deepEqual(clock.delays, [SIDEBAND_CLOSE_TIMEOUT_MS]);
      socket.receive(closedEvent(LIVE_CLOSE_REASON.CLOSE_REQUESTED, 61));
      const result = yield* Effect.promise(() => closing);
      assert.equal(result.outcome, SIDEBAND_CLOSE_OUTCOME.CLOSED);
      if (result.outcome !== SIDEBAND_CLOSE_OUTCOME.CLOSED) return;
      assert.deepEqual(
        [result.closed.reason, result.closed.usage.seconds],
        [LIVE_CLOSE_REASON.CLOSE_REQUESTED, 61],
      );
      assert.equal(socket.closedByClient, true);
      assert.equal(clock.armed(), 0);
    }),
);

it.effect(
  "a socket that ends first leaves the close unconfirmed, and silence gives up at the timeout",
  () =>
    Effect.gen(function* () {
      const runtime = yield* Effect.runtime<never>();
      const clock = clockBridge(runtime);
      const lost = new FakeLiveSocket();
      const losing = closeGracefully(sidebandOverSocket(lost), {
        eventId: "c",
        schedule: clock.schedule,
        cancel: clock.cancel,
      });
      lost.closeFromServer({ code: 1006 });
      assert.deepEqual(yield* Effect.promise(() => losing), {
        outcome: SIDEBAND_CLOSE_OUTCOME.CONNECTION_LOST,
        close: { code: 1006 },
      });

      const silent = new FakeLiveSocket();
      const timing = closeGracefully(sidebandOverSocket(silent), {
        eventId: "c",
        schedule: clock.schedule,
        cancel: clock.cancel,
        timeoutMs: 50,
      });
      yield* TestClock.adjust(Duration.millis(50));
      for (let i = 0; i < 20; i += 1) yield* Effect.yieldNow();
      assert.deepEqual(yield* Effect.promise(() => timing), {
        outcome: SIDEBAND_CLOSE_OUTCOME.TIMED_OUT,
      });
      assert.equal(silent.closedByClient, true);
    }),
);
