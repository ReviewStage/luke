import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { writeAccountPreferences } from "@repo/database/models/account-store";
import { keepRunsOnPick } from "@repo/database/models/runs-on-pick";
import { user } from "@repo/database/schemas/auth";
import { type SyncTopic, TOPIC } from "@repo/database/sync/notification";
import { expectTopicsFire, getTestDB } from "@repo/database/testing";
import { AGENT_MACHINE } from "@repo/features/agent-wire";
import { Effect } from "effect";
import { accountPreferencesRead } from "../live/reads/account-preferences.js";

/**
 * The account's preferences on the migrated capture: a default written
 * through its real writer notifies the account's topic, which the
 * preferences' live read is woken on, so a default chosen on another device
 * draws within a coalesce window; and a runs-on pick on a row that stands
 * notifies nothing, since every Start with Runs on writes one and would
 * otherwise wake every read of the account.
 *
 * Synthetic accounts throughout.
 */

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });
  return id;
});

it.layer(getTestDB())("what moves the account's preferences notifies", (it) => {
  it.effect("a default written notifies the account, which the preferences' read is woken on", () =>
    Effect.gen(function* () {
      const userId = yield* openAccount;
      const account: readonly SyncTopic[] = [[TOPIC.ACCOUNT, userId]];

      yield* expectTopicsFire(
        writeAccountPreferences(userId, {
          agent: { model: "anthropic/claude-opus-5.5", effort: "high" },
        }),
        account,
      );
      assert.deepEqual(accountPreferencesRead.topics({ userId }), account);
    }),
  );

  it.effect("a runs-on pick on an account whose row stands notifies nothing", () =>
    Effect.gen(function* () {
      const userId = yield* openAccount;
      yield* writeAccountPreferences(userId, { setupFinished: true });

      yield* expectTopicsFire(keepRunsOnPick(userId, { machine: AGENT_MACHINE.VERCEL }), []);
    }),
  );
});
