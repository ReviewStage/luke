import assert from "node:assert/strict";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { temporaryDirectoryScoped } from "@repo/runtime/testing";
import { Effect, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";
import { entityDatabaseChosen } from "./entity-store-rollout.js";

/**
 * Whether a launch opens the SQLite store, as the deployment's rollout
 * answers it: the answer read now where the service gives one, and where it
 * does not, within its wait or at all, the last answer kept for the same
 * account, or off. A state root of the test's own; synthetic accounts.
 */

const DANA = "user-dana";
const RAVI = "user-ravi";

const files = Layer.merge(NodeFileSystem.layer, NodePath.layer);

/** A read of the rollout that fails, as one with no network. */
const FAILED = Effect.succeed(undefined);

it.effect.each([
  { answer: true, chosen: true },
  { answer: false, chosen: false },
])("a rollout that answers $answer opens the store as it says", ({ answer, chosen }) =>
  Effect.gen(function* () {
    const directory = yield* temporaryDirectoryScoped("entity-rollout-");

    const now = yield* entityDatabaseChosen({
      directory,
      accountId: DANA,
      read: Effect.succeed(answer),
    });
    const offline = yield* entityDatabaseChosen({ directory, accountId: DANA, read: FAILED });

    assert.deepEqual([now, offline], [chosen, chosen]);
  }).pipe(Effect.provide(files)),
);

it.effect.each([
  { kept: "this account's answer of on", keptFor: DANA, chosen: true },
  { kept: "another account's answer of on", keptFor: RAVI, chosen: false },
  { kept: "no answer", keptFor: undefined, chosen: false },
])(
  "a rollout that does not answer, beside $kept, opens the store as that says",
  ({ keptFor, chosen }) =>
    Effect.gen(function* () {
      const directory = yield* temporaryDirectoryScoped("entity-rollout-");
      if (keptFor !== undefined) {
        yield* entityDatabaseChosen({ directory, accountId: keptFor, read: Effect.succeed(true) });
      }

      const failed = yield* entityDatabaseChosen({ directory, accountId: DANA, read: FAILED });

      assert.equal(failed, chosen);
    }).pipe(Effect.provide(files)),
);

it.effect("a rollout that does not answer within three seconds gives way to the kept answer", () =>
  Effect.gen(function* () {
    const directory = yield* temporaryDirectoryScoped("entity-rollout-");
    yield* entityDatabaseChosen({ directory, accountId: DANA, read: Effect.succeed(true) });

    const waiting = yield* Effect.forkChild(
      entityDatabaseChosen({ directory, accountId: DANA, read: Effect.never }),
    );
    yield* TestClock.adjust("3 seconds");

    assert.equal(yield* Fiber.join(waiting), true);
  }).pipe(Effect.provide(files)),
);
