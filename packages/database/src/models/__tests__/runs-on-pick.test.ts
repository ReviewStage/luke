/**
 * runs-on-pick.test.ts -- an account's last Runs on pick, over a real
 * dialect: none until a start names one, the last kept over the one before,
 * the preferences snapshot left as it stood, and one account's pick no
 * other's. Synthetic accounts throughout.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { CODING_AGENT_MACHINE } from "@luke/features/coding-agent-wire";
import { Effect, Option } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { getTestDB } from "../../testing/index.js";
import { readAccountPreferences, writeAccountPreferences } from "../account-store.js";
import { keepRunsOnPick, readRunsOnPick } from "../runs-on-pick.js";

const STUDIO = "6f0c1d0e-6b1a-4d43-9a49-2b7b6f1f0a11";

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
  return id;
});

it.layer(getTestDB())("an account's last Runs on pick", (it) => {
  it.effect("is none until kept, then the last one kept, leaving the snapshot as it stood", () =>
    Effect.gen(function* () {
      const userId = yield* openAccount;
      yield* writeAccountPreferences(userId, { preferences: { voice: "cedar" } });
      const before = yield* readAccountPreferences(userId);
      assert.deepEqual(yield* readRunsOnPick(userId), Option.none());

      yield* keepRunsOnPick(userId, { machine: CODING_AGENT_MACHINE.DEVICE, deviceId: STUDIO });
      yield* keepRunsOnPick(userId, { machine: CODING_AGENT_MACHINE.VERCEL });
      assert.deepEqual(
        yield* readRunsOnPick(userId),
        Option.some({ machine: CODING_AGENT_MACHINE.VERCEL }),
      );
      yield* keepRunsOnPick(userId, { machine: CODING_AGENT_MACHINE.DEVICE, deviceId: STUDIO });
      assert.deepEqual(
        yield* readRunsOnPick(userId),
        Option.some({ machine: CODING_AGENT_MACHINE.DEVICE, deviceId: STUDIO }),
      );
      assert.deepEqual(yield* readAccountPreferences(userId), before);
    }),
  );

  it.effect("is one account's alone", () =>
    Effect.gen(function* () {
      const owner = yield* openAccount;
      const other = yield* openAccount;
      yield* keepRunsOnPick(owner, { machine: CODING_AGENT_MACHINE.DEVICE, deviceId: STUDIO });

      assert.deepEqual(yield* readRunsOnPick(other), Option.none());
    }),
  );
});
