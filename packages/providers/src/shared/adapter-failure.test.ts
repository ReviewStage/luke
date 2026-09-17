import assert from "node:assert/strict";
import { Cause, Effect, Exit, Fiber, Option } from "effect";
import { test } from "vitest";
import {
  ADAPTER_FAILURE,
  AdapterFailure,
  clearsObservedState,
  endsPass,
  tolerateItemFailureEffect,
} from "./adapter-failure.js";

test("a rejected credential and nothing to observe with both clear observed state", () => {
  assert.equal(clearsObservedState(ADAPTER_FAILURE.UNAUTHORIZED), true);
  assert.equal(clearsObservedState(ADAPTER_FAILURE.UNAVAILABLE), true);
});

test("a failure that says nothing about the credential leaves the snapshot standing", () => {
  assert.equal(clearsObservedState(ADAPTER_FAILURE.TRANSIENT), false);
  assert.equal(clearsObservedState(ADAPTER_FAILURE.RATE_LIMITED), false);
});

test("a rate limit ends the pass without clearing it, and one resource's transient failure is tolerated alone", async () => {
  assert.equal(endsPass(ADAPTER_FAILURE.RATE_LIMITED), true);
  assert.equal(endsPass(ADAPTER_FAILURE.TRANSIENT), false);
  assert.equal(
    await Effect.runPromise(
      tolerateItemFailureEffect(
        Effect.fail(
          new AdapterFailure({
            failure: ADAPTER_FAILURE.TRANSIENT,
            message: "one status read failed",
          }),
        ),
      ),
    ),
    undefined,
  );
  const rateLimited = new AdapterFailure({
    failure: ADAPTER_FAILURE.RATE_LIMITED,
    message: "the provider is rate limiting",
  });
  const exit = await Effect.runPromiseExit(tolerateItemFailureEffect(Effect.fail(rateLimited)));
  assert.equal(Exit.isFailure(exit), true);
  const failure = Exit.isFailure(exit) ? Cause.findErrorOption(exit.cause) : Option.none();
  assert.equal(Option.isSome(failure) && failure.value, rateLimited);
});

test("every failure kind has an answer, so a new one cannot arrive undecided", () => {
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

test("a failure carries its kind under its own tag", () => {
  const failure = new AdapterFailure({
    failure: ADAPTER_FAILURE.TRANSIENT,
    message: "the provider did not answer",
  });
  assert.equal(failure._tag, "AdapterFailure");
  assert.equal(failure.failure, ADAPTER_FAILURE.TRANSIENT);
  assert.equal(failure.message, "the provider did not answer");
});

test("an interrupted item ends the pass with the interruption rather than standing as one resource missing", async () => {
  const exit = await Effect.runPromiseExit(
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
});
