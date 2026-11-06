import assert from "node:assert/strict";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { temporaryDirectoryScoped } from "@repo/runtime/testing";
import { Deferred, Effect, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";
import { entityDatabaseChosen } from "./entity-store-rollout.js";

/**
 * Whether a launch opens the SQLite store, as the deployment's rollout
 * answers it: a Mac whose last answer kept is on waits on a fresh one, so
 * turning the rollout off lands before the store opens, and stays on where
 * none comes; any other opens the sealed store at once and reads the rollout
 * behind it for the next launch. A state root of the test's own; synthetic
 * accounts.
 */

const DANA = "user-dana";
const RAVI = "user-ravi";

const files = Layer.merge(NodeFileSystem.layer, NodePath.layer);

/** A read of the rollout that fails, as one with no network. */
const FAILED = Effect.succeed(undefined);

/** One launch's choice for `accountId` over `directory`, the rollout answering as `read` does, and its read behind the store run to its end, as the next launch finds it. */
const launch = (directory: string, accountId: string, read: Effect.Effect<boolean | undefined>) =>
  Effect.gen(function* () {
    const choice = yield* entityDatabaseChosen({ directory, accountId, read });
    yield* choice.refreshed;
    return choice.on;
  });

it.effect.each([
  { kept: "nothing kept", keptFor: undefined, keptOn: false },
  { kept: "an answer of off kept", keptFor: DANA, keptOn: false },
  { kept: "another account's answer of on kept", keptFor: RAVI, keptOn: true },
])(
  "with $kept, a launch opens the sealed store without waiting on the rollout, and keeps its answer for the next",
  ({ keptFor, keptOn }) =>
    Effect.gen(function* () {
      const directory = yield* temporaryDirectoryScoped("entity-rollout-");
      if (keptFor !== undefined) yield* launch(directory, keptFor, Effect.succeed(keptOn));

      // Note that a rollout that never answers would hold the launch here if it waited on it.
      const now = yield* entityDatabaseChosen({
        directory,
        accountId: DANA,
        read: Effect.never,
      });
      yield* launch(directory, DANA, Effect.succeed(true));
      const next = yield* launch(directory, DANA, FAILED);

      assert.deepEqual([now.on, next], [false, true]);
    }).pipe(Effect.provide(files)),
);

it.effect(
  "with an answer of on kept, the rollout turned off lands before the store opens, and is kept",
  () =>
    Effect.gen(function* () {
      const directory = yield* temporaryDirectoryScoped("entity-rollout-");
      yield* launch(directory, DANA, Effect.succeed(true));

      const turnedOff = yield* launch(directory, DANA, Effect.succeed(false));
      const next = yield* entityDatabaseChosen({
        directory,
        accountId: DANA,
        read: Effect.never,
      });

      assert.deepEqual([turnedOff, next.on], [false, false]);
    }).pipe(Effect.provide(files)),
);

it.effect(
  "with an answer of on kept, a rollout that fails or does not answer within three seconds leaves the store on",
  () =>
    Effect.gen(function* () {
      const directory = yield* temporaryDirectoryScoped("entity-rollout-");
      yield* launch(directory, DANA, Effect.succeed(true));

      const failed = yield* launch(directory, DANA, FAILED);
      const asked = yield* Deferred.make<void>();
      const waiting = yield* Effect.forkChild(
        launch(directory, DANA, Effect.andThen(Deferred.succeed(asked, undefined), Effect.never)),
      );
      // Note that the launch reads its kept answer from disk before it asks, so the clock moves only once it waits on the rollout.
      yield* Deferred.await(asked);
      yield* Effect.yieldNow;
      yield* TestClock.adjust("3 seconds");

      assert.deepEqual([failed, yield* Fiber.join(waiting)], [true, true]);
    }).pipe(Effect.provide(files)),
);
