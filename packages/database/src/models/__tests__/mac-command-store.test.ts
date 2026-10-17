import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { macCommandsLiveRowsSchema, macCommandsOfLiveRows } from "@luke/features/live-wire";
import type { MacCommandResult } from "@luke/features/mac-command-wire";
import { Clock, Effect, Option, Schema } from "effect";
import { SqlClient } from "effect/sql";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { getTestDB } from "../../testing/index.js";
import {
  claimMacCommand,
  claimMacCommands,
  macCommandResult,
  macCommandsLiveStatement,
  queueMacCommand,
  settleMacCommand,
} from "../mac-command-store.js";

/**
 * The commands an account's agents queue for its Mac, over a real dialect:
 * a command is claimed once and settled once, by its own account alone, a
 * row its call has stopped waiting for is never claimed, and a Mac counts
 * as listening only from its last read on. The live statement delivers what
 * a Mac following over Neon Realtime would claim: the account's unclaimed
 * commands and no one else's.
 *
 * Synthetic accounts and commands throughout.
 */

/** The instant the clock reads now, which every command these tests queue is at or after. */
const now = Effect.map(Clock.currentTimeMillis, (millis) => new Date(millis));

const RESULT: MacCommandResult = {
  exitCode: 0,
  stdout: "main\n",
  stderr: "",
  truncated: false,
  timedOut: false,
};

const openAccounts = Effect.gen(function* () {
  const db = yield* Database;
  const [owner, other] = [`user-${randomUUID()}`, `user-${randomUUID()}`];
  for (const id of [owner, other]) {
    yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
  }
  return { owner, other };
});

/** The account's unclaimed commands as a Mac following them over Realtime decodes them, the statement run as Realtime runs it. */
const liveCommandsOf = (userId: string) =>
  Effect.gen(function* () {
    const statement = Option.getOrThrow(macCommandsLiveStatement(userId));
    const sql = yield* SqlClient.SqlClient;
    const commands = yield* sql.unsafe(statement.sql, [...statement.params]);
    return macCommandsOfLiveRows(
      yield* Schema.decodeUnknownEffect(macCommandsLiveRowsSchema)({ commands }),
    );
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
        const since = yield* now;
        const queued = command();
        yield* queueMacCommand(owner, queued);

        const claimedByOther = yield* claimMacCommands(other, since);
        const settledByOther = yield* settleMacCommand(other, queued.id, RESULT);
        const settledUnclaimed = yield* settleMacCommand(owner, queued.id, RESULT);
        const claimed = yield* claimMacCommands(owner, since);
        const claimedAgain = yield* claimMacCommands(owner, since);
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
    "the live statement delivers the account's unclaimed commands, the earliest first, and one claimed by its id leaves it, claimed once and by its own account alone",
    () =>
      Effect.gen(function* () {
        const { owner, other } = yield* openAccounts;
        const since = yield* now;
        const [first, second] = [command(), command(30)];
        yield* queueMacCommand(owner, first);
        yield* queueMacCommand(owner, second);
        yield* queueMacCommand(other, command());

        assert.deepEqual(
          (yield* liveCommandsOf(owner)).map(({ id }) => id).toSorted(),
          [first.id, second.id].toSorted(),
        );
        assert.equal((yield* liveCommandsOf(other)).length, 1, "another account's are its own");

        const byOther = yield* claimMacCommand(other, first.id, since);
        const claimed = yield* claimMacCommand(owner, first.id, since);
        const again = yield* claimMacCommand(owner, first.id, since);

        assert.deepEqual(byOther, Option.none(), "another account claims nothing");
        assert.deepEqual(claimed, Option.some(first));
        assert.deepEqual(again, Option.none(), "a claimed command is not handed out twice");
        assert.deepEqual(yield* liveCommandsOf(owner), [second]);
      }),
  );

  it.effect("a command queued before the claim window began is never claimed by its id", () =>
    Effect.gen(function* () {
      const { owner } = yield* openAccounts;
      const queued = command();
      yield* queueMacCommand(owner, queued);
      const later = new Date((yield* Clock.currentTimeMillis) + 1);

      assert.deepEqual(yield* claimMacCommand(owner, queued.id, later), Option.none());
      assert.deepEqual(yield* liveCommandsOf(owner), [queued], "it still waits, unclaimed");
    }),
  );
});
