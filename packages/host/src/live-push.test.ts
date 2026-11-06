import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Clock, Duration, Effect, Fiber, Option } from "effect";
import { TestClock } from "effect/testing";
import { pushLive } from "./live-push.js";

/**
 * A read the service keeps leaving unanswered is read again after waits that
 * double from two seconds up to a minute, rather than every two seconds for
 * as long as a window holds it.
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
    yield* TestClock.adjust(Duration.seconds(183));
    yield* Fiber.interrupt(following);
    // Waits of 2, 4, 8, 16, and 32 seconds, then a minute each.
    assert.deepEqual(asked, [0, 2_000, 6_000, 14_000, 30_000, 62_000, 122_000, 182_000]);
  }),
);
