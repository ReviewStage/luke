import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Clock, Duration, Effect, Fiber, Option } from "effect";
import { TestClock } from "effect/testing";
import { pushLive } from "./live-push.js";

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
    assert.deepEqual(asked, [0, 2_000, 6_000, 14_000, 30_000, 62_000, 122_000, 182_000]);
  }),
);
