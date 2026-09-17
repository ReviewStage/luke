import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Cause, Effect, Exit, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { catchAllButInterrupt, unlessInterrupted, withFallback } from "./fallback.js";

it.effect("withFallback answers the fallback for a failure and for a defect alike", () =>
  Effect.gen(function* () {
    assert.equal(yield* withFallback(Effect.fail("refused"), "fallback"), "fallback");
    assert.equal(yield* withFallback(Effect.die(new Error("boom")), "fallback"), "fallback");
    assert.equal(yield* withFallback(Effect.succeed("answered"), "fallback"), "answered");
  }),
);

it.effect(
  "withFallback lets an interruption end the fiber rather than answering the fallback",
  () =>
    Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(
        withFallback(Effect.as(Effect.sleep("1 hour"), "answered"), "fallback"),
      );
      yield* TestClock.adjust("1 minute");
      yield* Fiber.interrupt(fiber);
      const exit = yield* Fiber.await(fiber);
      assert.equal(Exit.hasInterrupts(exit), true);
    }),
);

it.effect(
  "catchAllButInterrupt hands the failure and the defect on as the cause each came as",
  () =>
    Effect.gen(function* () {
      const seen: string[] = [];
      const recover = (cause: Cause.Cause<string>) =>
        Effect.sync(() => {
          seen.push(Cause.hasFails(cause) ? "failure" : Cause.hasDies(cause) ? "defect" : "other");
          return false;
        });
      assert.equal(yield* catchAllButInterrupt(Effect.fail("refused"), recover), false);
      assert.equal(yield* catchAllButInterrupt(Effect.die(new Error("boom")), recover), false);
      assert.deepEqual(seen, ["failure", "defect"]);

      const fiber = yield* Effect.forkChild(
        catchAllButInterrupt(Effect.andThen(Effect.sleep("1 hour"), Effect.fail("late")), recover),
      );
      yield* Fiber.interrupt(fiber);
      assert.equal(Exit.hasInterrupts(yield* Fiber.await(fiber)), true);
      assert.deepEqual(seen, ["failure", "defect"]);
    }),
);

it.effect("unlessInterrupted re-raises an interruption and hands everything else on", () =>
  Effect.gen(function* () {
    const handled = yield* unlessInterrupted(Cause.fail("refused"), () =>
      Effect.succeed("handled"),
    );
    assert.equal(handled, "handled");

    const fiber = yield* Effect.forkChild(
      Effect.catchCause(Effect.sleep("1 hour"), (cause) =>
        unlessInterrupted(cause, () => Effect.succeed("handled")),
      ),
    );
    yield* Fiber.interrupt(fiber);
    assert.equal(Exit.hasInterrupts(yield* Fiber.await(fiber)), true);
  }),
);
