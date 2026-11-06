import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Clock, Duration, Effect, Fiber, Option } from "effect";
import { TestClock } from "effect/testing";
import { pushLive } from "./live-push.js";

/**
 * A read the service keeps leaving unanswered is read again after waits that
 * double from two seconds, rather than every two seconds for as long as a
 * window holds it.
 */

it.effect("a read the service keeps leaving unanswered is read again after doubling waits", () =>
  Effect.gen(function* () {
    const asked: number[] = [];
    const following = yield* Effect.forkChild(
      pushLive<"rows", never>({
        seal: () =>
          Effect.map(Clock.currentTimeMillis, (now) => {
            asked.push(now);
            return { failure: "unavailable" };
          }),
        decode: () => Option.none(),
        publish: () => Effect.void,
      }),
    );
    yield* TestClock.adjust(Duration.seconds(60));
    yield* Fiber.interrupt(following);
    // Waits of 2, 4, 8, and 16 seconds, the next 32 running past the minute.
    assert.deepEqual(asked, [0, 2_000, 6_000, 14_000, 30_000]);
  }),
);
