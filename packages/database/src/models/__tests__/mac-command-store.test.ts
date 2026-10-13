import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import type { MacCommandResult } from "@sidecar/hosted/mac-command-wire";
import { Clock, Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import { db } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { getTestDB } from "../../testing/index.js";
import {
  claimMacCommands,
  macCommandResult,
  macCommandsWaiting,
  macListeningSince,
  markMacListening,
  queueMacCommand,
  settleMacCommand,
  withdrawMacCommand,
} from "../mac-command-store.js";

/**
 * The commands an account's agents queue for its Mac, over a real dialect:
 * a command is claimed once and settled once, by its own account alone, a
 * row its call has stopped waiting for is never claimed, and a Mac counts
 * as listening only from its last read on.
 *
 * Synthetic accounts and commands throughout.
 */

const GRACE_SECONDS = 30;

const RESULT: MacCommandResult = {
  exitCode: 0,
  stdout: "main\n",
  stderr: "",
  truncated: false,
  timedOut: false,
};

const openAccounts = Effect.gen(function* () {
  const [owner, other] = [`user-${randomUUID()}`, `user-${randomUUID()}`];
  for (const id of [owner, other]) {
    yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
  }
  return { owner, other };
});

const command = (timeoutSeconds = 60) => ({
  id: randomUUID(),
  command: "git branch --show-current",
  timeoutSeconds,
});

it.layer(getTestDB())("the Mac command store", (it) => {
  it.effect(
    "a command is claimed and settled once, by its own account, and its result read by that account alone",
    () =>
      Effect.gen(function* () {
        const { owner, other } = yield* openAccounts;
        const queued = command();
        yield* queueMacCommand(owner, queued);

        const claimedByOther = yield* claimMacCommands(other, GRACE_SECONDS);
        const settledByOther = yield* settleMacCommand(other, queued.id, RESULT);
        const settledUnclaimed = yield* settleMacCommand(owner, queued.id, RESULT);
        const claimed = yield* claimMacCommands(owner, GRACE_SECONDS);
        const claimedAgain = yield* claimMacCommands(owner, GRACE_SECONDS);
        const settled = yield* settleMacCommand(owner, queued.id, RESULT);
        const settledAgain = yield* settleMacCommand(owner, queued.id, { ...RESULT, exitCode: 1 });

        assert.deepEqual(claimedByOther, []);
        assert.equal(settledByOther, false, "another account settles nothing");
        assert.equal(settledUnclaimed, false, "nothing is settled before a Mac claims it");
        assert.deepEqual(claimed, [queued]);
        assert.deepEqual(claimedAgain, [], "a claimed command is not handed out twice");
        assert.equal(settled, true);
        assert.equal(settledAgain, false, "the first result stands");
        assert.deepEqual(yield* macCommandResult(owner, queued.id), Option.some(RESULT));
        assert.deepEqual(yield* macCommandResult(other, queued.id), Option.none());
      }),
  );

  it.effect(
    "a command whose call stopped waiting is never claimed, and a withdrawn one is gone",
    () =>
      Effect.gen(function* () {
        const { owner } = yield* openAccounts;
        const stale = command(10);
        yield* queueMacCommand(owner, stale);
        yield* TestClock.adjust(`${10 + GRACE_SECONDS} seconds`);
        const fresh = command();
        yield* queueMacCommand(owner, fresh);
        const withdrawn = command();
        yield* queueMacCommand(owner, withdrawn);
        yield* withdrawMacCommand(owner, withdrawn.id);

        assert.equal(yield* macCommandsWaiting(owner, GRACE_SECONDS), true);
        assert.deepEqual(yield* claimMacCommands(owner, GRACE_SECONDS), [fresh]);
        assert.equal(yield* macCommandsWaiting(owner, GRACE_SECONDS), false);
      }),
  );

  it.effect("a Mac counts as listening from its last read on, for its own account", () =>
    Effect.gen(function* () {
      const { owner, other } = yield* openAccounts;
      const before = new Date(yield* Clock.currentTimeMillis);
      assert.equal(yield* macListeningSince(owner, before), false, "no Mac has read yet");

      yield* markMacListening(owner);
      yield* TestClock.adjust("1 minute");
      const later = new Date(yield* Clock.currentTimeMillis);

      assert.equal(yield* macListeningSince(owner, before), true);
      assert.equal(yield* macListeningSince(owner, later), false, "a read a minute ago is not now");
      assert.equal(yield* macListeningSince(other, before), false);
    }),
  );
});
