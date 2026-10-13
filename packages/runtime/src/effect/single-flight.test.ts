import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Deferred, Effect, Fiber } from "effect";
import { singleFlightEffect } from "./single-flight.js";

it.effect(
  "concurrent refresh asks share one in-flight run, so a rotated token is never spent twice",
  () =>
    Effect.gen(function* () {
      let runs = 0;
      const release = yield* Deferred.make<void>();
      const refresh = singleFlightEffect(() =>
        Effect.gen(function* () {
          runs += 1;
          yield* Deferred.await(release);
        }),
      );

      const first = yield* Effect.forkChild(refresh());
      const second = yield* Effect.forkChild(refresh());
      assert.equal(runs, 1);

      yield* Deferred.succeed(release, undefined);
      yield* Effect.all([first, second].map((fiber) => Fiber.await(fiber)));

      // A finished flight is over: the next ask holds the newly rotated token
      // and may start a refresh of its own.
      const third = yield* Effect.forkChild(refresh());
      assert.equal(runs, 2);
      yield* Fiber.await(third);
    }),
);
