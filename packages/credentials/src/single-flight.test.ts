import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Deferred, Effect, Exit } from "effect";
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

      const first = yield* Effect.fork(refresh());
      const second = yield* Effect.fork(refresh());
      assert.equal(runs, 1);

      yield* Deferred.succeed(release, undefined);
      yield* Effect.all([first, second].map((fiber) => fiber.await));

      // A finished flight is over: the next ask holds the newly rotated token
      // and may start a refresh of its own.
      const third = yield* Effect.fork(refresh());
      assert.equal(runs, 2);
      yield* third.await;
    }),
);

it.effect("a failed flight fails every waiter and still ends, so the next ask can try again", () =>
  Effect.gen(function* () {
    let runs = 0;
    const refresh = singleFlightEffect(() =>
      Effect.gen(function* () {
        runs += 1;
        // The flight suspends once before it fails, as every refresh that
        // reaches the token endpoint does: a body that fails without ever
        // suspending is over before a second ask can join it.
        yield* Effect.yieldNow();
        return yield* Effect.fail(new Error("token endpoint unreachable"));
      }),
    );

    const first = yield* Effect.fork(refresh());
    const second = yield* Effect.fork(refresh());
    for (const fiber of [first, second]) {
      assert.equal(Exit.isFailure(yield* fiber.await), true);
    }
    assert.equal(runs, 1);

    assert.equal(Exit.isFailure(yield* Effect.exit(refresh())), true);
    assert.equal(runs, 2);
  }),
);
