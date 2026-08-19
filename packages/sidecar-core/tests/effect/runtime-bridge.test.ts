import assert from "node:assert/strict";
import test from "node:test";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { ParseFailure } from "../../src/effect/errors.js";
import {
  fromPromise,
  fromPromiseWithError,
  runPromiseExit,
  runPromiseOrDie,
} from "../../src/effect/runtime-bridge.js";

test("runPromiseExit returns a success exit for a succeeding effect", async () => {
  const exit = await runPromiseExit(Effect.succeed(42));
  assert.equal(Exit.isSuccess(exit), true);
  if (Exit.isSuccess(exit)) {
    assert.equal(exit.value, 42);
  }
});

test("runPromiseExit returns a failure exit for a failing effect", async () => {
  const error = new Error("expected");
  const exit = await runPromiseExit(Effect.fail(error));
  assert.equal(Exit.isFailure(exit), true);
  if (Exit.isFailure(exit)) {
    assert.equal(exit.cause._tag, "Fail");
  }
});

test("runPromiseOrDie resolves the value for a succeeding effect", async () => {
  const value = await runPromiseOrDie(Effect.succeed("ok"));
  assert.equal(value, "ok");
});

test("runPromiseOrDie rejects when the effect fails", async () => {
  await assert.rejects(() => runPromiseOrDie(Effect.fail("nope")));
});

test("runPromiseOrDie rejects with the die defect", async () => {
  const error = new Error("boom");
  try {
    await runPromiseOrDie(Effect.die(error));
    assert.fail("Expected runPromiseOrDie to reject");
  } catch (thrown) {
    assert.equal(thrown, error);
  }
});

test("fromPromise resolves when the promise fulfills", async () => {
  const exit = await runPromiseExit(fromPromise(async () => "wire"));
  assert.equal(Exit.isSuccess(exit), true);
  if (Exit.isSuccess(exit)) {
    assert.equal(exit.value, "wire");
  }
});

test("fromPromise fails with UnknownException when the promise rejects", async () => {
  const exit = await runPromiseExit(
    fromPromise(async () => {
      throw new Error("network");
    }),
  );
  assert.equal(Exit.isFailure(exit), true);
  if (Exit.isFailure(exit)) {
    const failure = Cause.failureOption(exit.cause);
    assert.equal(failure._tag, "Some");
    if (failure._tag === "Some") {
      assert.equal(Cause.isUnknownException(failure.value), true);
    }
  }
});

test("fromPromiseWithError maps rejections through mapError", async () => {
  const exit = await runPromiseExit(
    fromPromiseWithError(
      async () => {
        throw new SyntaxError("bad json");
      },
      (unknown) => new ParseFailure({ cause: unknown }),
    ),
  );
  assert.equal(Exit.isFailure(exit), true);
  if (Exit.isFailure(exit)) {
    const failure = Cause.failureOption(exit.cause);
    assert.equal(failure._tag, "Some");
    if (failure._tag === "Some") {
      assert.equal(failure.value._tag, "ParseFailure");
    }
  }
});
