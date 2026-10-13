import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Cause, Effect, Exit, Scope } from "effect";
import { TestClock } from "effect/testing";
import { ConstraintError, SqlError } from "effect/unstable/sql/SqlError";
import { causeKind, failureKind } from "./failure-kind.js";
import { serialQueue } from "./serial-queue.js";

/** Words a failure may carry that no log line may: a credential and a transcript's own. */
const SECRET = "sk-fixture-secret-0123456789 and the developer said ship it";

it.effect(
  "a defect a serial queue was handed is named by its error's kind, never its message",
  () =>
    Effect.gen(function* () {
      const kinds: string[] = [];
      const home = yield* Scope.make();
      const queue = yield* Effect.provideService(
        serialQueue({ onDefect: (cause) => Effect.sync(() => void kinds.push(causeKind(cause))) }),
        Scope.Scope,
        home,
      );

      queue.offerUnsafe(Effect.die(new TypeError(SECRET)));
      queue.offerUnsafe(Effect.die(SECRET));
      yield* TestClock.adjust("1 millis");
      assert.deepEqual(kinds, ["TypeError", "unnamed"]);

      yield* Scope.close(home, Exit.void);
    }),
);

it.effect(
  "a store failure is named by its tag and its reason's, never by the statement's words",
  () =>
    Effect.sync(() => {
      const refused = new SqlError({
        reason: new ConstraintError({ cause: new Error(SECRET), message: SECRET }),
      });
      assert.equal(failureKind(refused), "SqlError: ConstraintError");
      assert.equal(causeKind(Cause.fail(refused)), "SqlError: ConstraintError");
    }),
);

it.effect("an error whose name was given a sentence is not named by it", () =>
  Effect.sync(() => {
    const named = new Error("refused");
    named.name = SECRET;
    assert.equal(failureKind(named), "unnamed");
  }),
);

it.effect("a cause that holds only an interruption is named an interrupt", () =>
  Effect.sync(() => {
    assert.equal(causeKind(Cause.interrupt()), "Interrupt");
  }),
);
