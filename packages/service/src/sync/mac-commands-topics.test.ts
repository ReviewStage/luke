import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import {
  claimMacCommand,
  queueMacCommand,
  settleMacCommand,
  withdrawMacCommand,
} from "@luke/database/models/mac-command-store";
import { user } from "@luke/database/schemas/auth";
import { type SyncTopic, TOPIC } from "@luke/database/sync/notification";
import { expectTopicsFire, getTestDB } from "@luke/database/testing";
import { MAC_COMMAND_KIND } from "@luke/features/mac-command-wire";
import { Effect, Option } from "effect";
import { macCommandsLive } from "./live-queries.js";

/**
 * The Mac's live read of the commands it may claim (`macCommandsLive`) on
 * the migrated capture: a command queued, claimed, settled, and withdrawn,
 * each through its real writer, notifies the account's topic, which the
 * read is woken on, so a Mac holding the read hears an agent's command
 * within a coalesce window rather than at its next look.
 *
 * Synthetic accounts and commands throughout.
 */

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
  return id;
});

/** Runs the write, held to the topics it notifies, and fails unless one of them wakes the account's read. */
const wakesTheMac = <A, E, R>(
  write: Effect.Effect<A, E, R>,
  topics: readonly SyncTopic[],
  userId: string,
) =>
  Effect.gen(function* () {
    const fired = yield* expectTopicsFire(write, topics);
    const woken = macCommandsLive.topics({ userId, kinds: MAC_COMMAND_KIND.SHELL });
    assert.ok(
      topics.some(([kind, id]) => woken.some((topic) => topic[0] === kind && topic[1] === id)),
      "the Mac's read is woken by a topic the write notifies",
    );
    return fired;
  });

it.layer(getTestDB())("what moves the commands a Mac may claim notifies", (it) => {
  it.effect(
    "a command queued, claimed, settled, and withdrawn each notify the account, the queue under its own transaction",
    () =>
      Effect.gen(function* () {
        const userId = yield* openAccount;
        const account: readonly SyncTopic[] = [[TOPIC.ACCOUNT, userId]];
        const id = randomUUID();
        const kinds = [MAC_COMMAND_KIND.SHELL];

        const queued = yield* wakesTheMac(
          queueMacCommand(userId, {
            id,
            kind: MAC_COMMAND_KIND.SHELL,
            command: "git status",
            timeoutSeconds: 60,
          }),
          account,
          userId,
        );
        assert.equal(queued.txids.length, 1, "the queue notifies under one transaction");

        const claimed = yield* wakesTheMac(
          claimMacCommand(userId, id, new Date(0), kinds),
          account,
          userId,
        );
        assert.ok(Option.isSome(claimed.value), "the command was claimed");
        const settled = yield* wakesTheMac(
          settleMacCommand(userId, id, {
            exitCode: 0,
            stdout: "nothing to commit\n",
            stderr: "",
            truncated: false,
            timedOut: false,
          }),
          account,
          userId,
        );
        assert.ok(settled.value, "the result was kept");
        yield* wakesTheMac(withdrawMacCommand(userId, id), account, userId);
      }),
  );
});
