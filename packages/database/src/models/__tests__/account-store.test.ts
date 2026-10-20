import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { CHAPTERS_MODEL } from "@luke/features/chapters-model-choice";
import { LINK_OPEN } from "@luke/features/link-open";
import { EXPERIMENT } from "@luke/settings";
import { eq, sql } from "drizzle-orm";
import { Effect } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { accountPreference } from "../../schemas/preferences.js";
import { getTestDB } from "../../testing/index.js";
import {
  accountExperimentOn,
  chatEnabledFor,
  readAccountPreferences,
  writeAccountPreferences,
} from "../account-store.js";

/**
 * The experiments part of an account's snapshot, over a real dialect: a
 * write merges its keys over what stood rather than replacing them, the
 * other parts' writes leave it standing, a key no build lists reads as
 * nothing, it never moves the preferences' instant a Mac reads as a
 * snapshot to take, and one account's choices are no other's. The link
 * choice is a part of its own on the same terms: written alone, it moves no
 * instant, and the shared part's write leaves it standing. So is the
 * chapters model, which reads as Haiku until the account chooses and for a
 * stored value no build lists any more.
 *
 * Synthetic accounts throughout.
 */

// SAFETY: a model a later build dropped, which the column's type no longer names, stored as an older build would have.
const RETIRED_MODEL = "claude-retired-4-0" as typeof CHAPTERS_MODEL.HAIKU;

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
  return id;
});

it.layer(getTestDB())("the account store's experiments", (it) => {
  it.effect("a write merges its keys over what stood, and the other parts' writes leave them", () =>
    Effect.gen(function* () {
      const userId = yield* openAccount;

      const turnedOn = yield* writeAccountPreferences(userId, {
        experiments: { [EXPERIMENT.FACTORY]: true },
      });
      assert.deepEqual(turnedOn.experiments, { [EXPERIMENT.FACTORY]: true });

      // An empty patch asks nothing of what stood.
      const untouched = yield* writeAccountPreferences(userId, { experiments: {} });
      assert.deepEqual(untouched.experiments, { [EXPERIMENT.FACTORY]: true });

      yield* writeAccountPreferences(userId, { preferences: { voice: "cedar" } });
      const afterVoice = yield* readAccountPreferences(userId);
      assert.deepEqual(afterVoice?.experiments, { [EXPERIMENT.FACTORY]: true });
      assert.deepEqual(afterVoice?.preferences, { voice: "cedar" });

      const turnedOff = yield* writeAccountPreferences(userId, {
        experiments: { [EXPERIMENT.FACTORY]: false },
      });
      assert.deepEqual(turnedOff.experiments, { [EXPERIMENT.FACTORY]: false });
      assert.deepEqual(turnedOff.preferences, { voice: "cedar" });
    }),
  );

  it.effect("a stored key no build lists any more reads as nothing, and the rest still reads", () =>
    Effect.gen(function* () {
      const userId = yield* openAccount;
      yield* writeAccountPreferences(userId, { experiments: { [EXPERIMENT.FACTORY]: true } });
      const db = yield* Database;
      yield* db
        .update(accountPreference)
        // A key written by a build that listed an experiment this one no longer does.
        .set({
          experiments: sql`${JSON.stringify({ [EXPERIMENT.FACTORY]: true, graduated: true })}::jsonb`,
        })
        .where(eq(accountPreference.userId, userId));

      const read = yield* readAccountPreferences(userId);
      assert.deepEqual(read?.experiments, { [EXPERIMENT.FACTORY]: true });
    }),
  );

  it.effect("an experiments write is no snapshot a Mac would take over its own settings", () =>
    Effect.gen(function* () {
      const userId = yield* openAccount;
      const written = yield* writeAccountPreferences(userId, {
        experiments: { [EXPERIMENT.FACTORY]: true },
      });
      assert.equal(written.updatedAt, undefined);
      assert.deepEqual(written.preferences, {});
    }),
  );

  it.effect(
    "an experiment is off for an account until it turns it on, and off again once it turns it off, whatever its others",
    () =>
      Effect.gen(function* () {
        const userId = yield* openAccount;
        assert.equal(yield* accountExperimentOn(userId, EXPERIMENT.CHAT), false);
        yield* writeAccountPreferences(userId, { experiments: { [EXPERIMENT.FACTORY]: true } });
        assert.equal(yield* accountExperimentOn(userId, EXPERIMENT.CHAT), false);
        yield* writeAccountPreferences(userId, { experiments: { [EXPERIMENT.CHAT]: true } });
        assert.equal(yield* accountExperimentOn(userId, EXPERIMENT.CHAT), true);
        assert.equal(yield* accountExperimentOn(yield* openAccount, EXPERIMENT.CHAT), false);
        yield* writeAccountPreferences(userId, { experiments: { [EXPERIMENT.CHAT]: false } });
        assert.equal(yield* accountExperimentOn(userId, EXPERIMENT.CHAT), false);
      }),
  );

  it.effect("Chat is off for an account until it turns the Chat experiment on", () =>
    Effect.gen(function* () {
      const userId = yield* openAccount;
      assert.equal(yield* chatEnabledFor(userId), false);
      yield* writeAccountPreferences(userId, { experiments: { [EXPERIMENT.FACTORY]: true } });
      assert.equal(yield* chatEnabledFor(userId), false);
      yield* writeAccountPreferences(userId, { experiments: { [EXPERIMENT.CHAT]: true } });
      assert.equal(yield* chatEnabledFor(userId), true);
    }),
  );

  it.effect("one account's experiments are no other account's", () =>
    Effect.gen(function* () {
      const owner = yield* openAccount;
      const other = yield* openAccount;
      yield* writeAccountPreferences(owner, { experiments: { [EXPERIMENT.FACTORY]: true } });
      yield* writeAccountPreferences(other, { preferences: { voice: "cedar" } });

      assert.deepEqual((yield* readAccountPreferences(other))?.experiments, {});
      assert.deepEqual((yield* readAccountPreferences(owner))?.experiments, {
        [EXPERIMENT.FACTORY]: true,
      });
    }),
  );
});

it.layer(getTestDB())("the account store's link choice", (it) => {
  it.effect("is written on its own, stands through a voice write, and moves no instant", () =>
    Effect.gen(function* () {
      const userId = yield* openAccount;
      const chosen = yield* writeAccountPreferences(userId, { linkOpen: LINK_OPEN.MAC_APP });
      assert.deepEqual(chosen.preferences, { linkOpen: LINK_OPEN.MAC_APP });
      assert.equal(chosen.updatedAt, undefined);

      yield* writeAccountPreferences(userId, { preferences: { voice: "cedar" } });
      const read = yield* readAccountPreferences(userId);
      assert.deepEqual(read?.preferences, { voice: "cedar", linkOpen: LINK_OPEN.MAC_APP });
      assert.deepEqual((yield* readAccountPreferences(yield* openAccount))?.preferences, undefined);
    }),
  );
});

it.layer(getTestDB())("the account store's chapters model", (it) => {
  it.effect(
    "is written on its own, read back, stands through other writes, and moves no instant",
    () =>
      Effect.gen(function* () {
        const userId = yield* openAccount;
        const chosen = yield* writeAccountPreferences(userId, {
          chaptersModel: CHAPTERS_MODEL.OPUS,
        });
        assert.equal(chosen.chaptersModel, CHAPTERS_MODEL.OPUS);
        assert.equal(chosen.updatedAt, undefined);

        yield* writeAccountPreferences(userId, { preferences: { voice: "cedar" } });
        yield* writeAccountPreferences(userId, { experiments: { [EXPERIMENT.FACTORY]: true } });
        assert.equal((yield* readAccountPreferences(userId))?.chaptersModel, CHAPTERS_MODEL.OPUS);

        const other = yield* openAccount;
        yield* writeAccountPreferences(other, { preferences: { voice: "cedar" } });
        assert.equal((yield* readAccountPreferences(other))?.chaptersModel, CHAPTERS_MODEL.HAIKU);
      }),
  );

  it.effect("a stored model no build lists any more reads as Haiku", () =>
    Effect.gen(function* () {
      const userId = yield* openAccount;
      yield* writeAccountPreferences(userId, { chaptersModel: CHAPTERS_MODEL.SONNET });
      const db = yield* Database;
      yield* db
        .update(accountPreference)
        .set({ chaptersModel: RETIRED_MODEL })
        .where(eq(accountPreference.userId, userId));

      assert.equal((yield* readAccountPreferences(userId))?.chaptersModel, CHAPTERS_MODEL.HAIKU);
    }),
  );
});
