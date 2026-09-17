import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Cause, Effect, Exit, Fiber, Option } from "effect";
import {
  ADAPTER_FAILURE,
  AdapterFailure,
  clearsObservedState,
  endsPass,
  tolerateItemFailureEffect,
} from "./adapter-failure.js";

it.effect(
  "a rate limit ends the pass without clearing it, and one resource's transient failure is tolerated alone",
  () =>
    Effect.gen(function* () {
      assert.equal(endsPass(ADAPTER_FAILURE.RATE_LIMITED), true);
      assert.equal(endsPass(ADAPTER_FAILURE.TRANSIENT), false);
      assert.equal(
        yield* tolerateItemFailureEffect(
          Effect.fail(
            new AdapterFailure({
              failure: ADAPTER_FAILURE.TRANSIENT,
              message: "one status read failed",
            }),
          ),
        ),
        undefined,
      );
      const rateLimited = new AdapterFailure({
        failure: ADAPTER_FAILURE.RATE_LIMITED,
        message: "the provider is rate limiting",
      });
      const exit = yield* Effect.exit(tolerateItemFailureEffect(Effect.fail(rateLimited)));
      assert.equal(Exit.isFailure(exit), true);
      const failure = Exit.isFailure(exit) ? Cause.findErrorOption(exit.cause) : Option.none();
      assert.equal(Option.isSome(failure) && failure.value, rateLimited);
    }),
);

it("every failure kind has an answer, so a new one cannot arrive undecided", () => {
  const answers = Object.values(ADAPTER_FAILURE).map((failure) => [
    failure,
    clearsObservedState(failure),
  ]);
  assert.deepEqual(answers, [
    [ADAPTER_FAILURE.UNAUTHORIZED, true],
    [ADAPTER_FAILURE.UNAVAILABLE, true],
    [ADAPTER_FAILURE.TRANSIENT, false],
    [ADAPTER_FAILURE.RATE_LIMITED, false],
  ]);
});

it.effect(
  "an interrupted item ends the pass with the interruption rather than standing as one resource missing",
  () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        Effect.gen(function* () {
          const fiber = yield* Effect.forkChild(tolerateItemFailureEffect(Effect.never));
          yield* Effect.yieldNow;
          yield* Fiber.interrupt(fiber);
          return yield* Fiber.await(fiber);
        }),
      );
      assert.equal(Exit.isSuccess(exit), true);
      const itemExit = Exit.isSuccess(exit) ? exit.value : undefined;
      assert.ok(itemExit !== undefined);
      assert.equal(Exit.hasInterrupts(itemExit), true);
    }),
);
