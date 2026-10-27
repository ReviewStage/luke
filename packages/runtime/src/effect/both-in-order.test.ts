import assert from "node:assert/strict";
import { describe, it } from "@effect/vitest";
import { Deferred, Effect } from "effect";
import { bothInOrder } from "./both-in-order.js";

describe("bothInOrder", () => {
  it.effect("runs the two at once, so the first may wait on what the second does", () =>
    Effect.gen(function* () {
      const handed = yield* Deferred.make<string>();
      const answered = yield* bothInOrder(
        Deferred.await(handed),
        Effect.as(Deferred.succeed(handed, "from the second"), 2),
      );
      assert.deepEqual(answered, ["from the second", 2]);
    }),
  );

  it.effect("answers the first's failure where both fail, though the second failed sooner", () =>
    Effect.gen(function* () {
      const secondFailed = yield* Deferred.make<void>();
      const first = Effect.andThen(Deferred.await(secondFailed), Effect.fail("first"));
      const second = Effect.andThen(
        Deferred.succeed(secondFailed, undefined),
        Effect.fail("second"),
      );
      assert.equal(yield* Effect.flip(bothInOrder(first, second)), "first");
    }),
  );

  it.effect("answers the second's failure where the first succeeds", () =>
    Effect.gen(function* () {
      assert.equal(
        yield* Effect.flip(bothInOrder(Effect.succeed(1), Effect.fail("second"))),
        "second",
      );
    }),
  );
});
