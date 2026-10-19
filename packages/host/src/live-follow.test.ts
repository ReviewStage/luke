import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { LIVE_POLL_URL, type SealedLiveQueryWire } from "@luke/features/live-wire";
import { Effect, Fiber, Stream } from "effect";
import { TestClock } from "effect/testing";
import { liveRows, openRealtimeClient, type SealedRead } from "./live-follow.js";

/**
 * A read the service answered at the poll address, where it has no Realtime:
 * the rows its seal carried are the read's first rows, and each seal after,
 * a few seconds apart, hands on its rows only where they changed.
 *
 * Rows are synthetic; the service is a script of the seals it answers.
 */

/** A seal as the polling service answers one: already expired, its rows inline. */
const polled = (rows: readonly unknown[]): SealedRead<"items"> => ({
  url: LIVE_POLL_URL,
  queries: {
    items: {
      capability: LIVE_POLL_URL,
      queryFingerprint: LIVE_POLL_URL,
      expiresAt: 0,
      rows,
    } satisfies SealedLiveQueryWire,
  },
});

/** Every step the read has to take, taken. */
const settled = Effect.repeat(Effect.yieldNow, { times: 50 });

it.effect(
  "a polled read hands on its first rows, then each seal's rows a few seconds apart, skipping a seal whose rows did not change",
  () =>
    Effect.gen(function* () {
      const answers = [[{ id: "a" }], [{ id: "a" }, { id: "b" }], [{ id: "b" }]];
      const heard: unknown[][] = [];
      const reading = yield* Effect.forkChild(
        Stream.runForEach(
          liveRows(
            {
              openLive: openRealtimeClient,
              reseal: () => Effect.sync(() => polled(answers.shift() ?? [])),
              now: () => 0,
            },
            polled([{ id: "a" }]),
          ),
          (rows) => Effect.sync(() => void heard.push([...rows.items])),
        ),
      );
      yield* settled;
      assert.deepEqual(heard, [[{ id: "a" }]]);

      yield* TestClock.adjust("3 seconds");
      yield* settled;
      assert.deepEqual(heard, [[{ id: "a" }]], "an unchanged poll is no change");

      yield* TestClock.adjust("3 seconds");
      yield* settled;
      assert.deepEqual(heard, [[{ id: "a" }], [{ id: "a" }, { id: "b" }]]);

      yield* TestClock.adjust("3 seconds");
      yield* settled;
      assert.deepEqual(heard.at(-1), [{ id: "b" }]);
      yield* Fiber.interrupt(reading);
    }),
);
