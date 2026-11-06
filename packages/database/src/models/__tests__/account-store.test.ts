import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { CHAPTERS_MODEL } from "@repo/features/chapters-model-choice";
import { LINK_OPEN } from "@repo/features/link-open";
import { AGENT_ENTER, COMMIT_AUTHOR, EXPERIMENT } from "@repo/settings";
import { eq, sql } from "drizzle-orm";
import { Effect } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { accountPreference } from "../../schemas/preferences.js";
import { getTestDB } from "../../testing/index.js";
import {
  accountExperimentOn,
  readAccountAccess,
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
 * stored value no build lists any more. The role is read off the account's
 * own row and no other's.
 *
 * Synthetic accounts throughout.
 */

// SAFETY: a model a later build dropped, which the column's type no longer names, stored as an older build would have.
const RETIRED_MODEL = "claude-retired-4-0" as typeof CHAPTERS_MODEL.HAIKU;

/** A place midway through a team's setup, as setup keeps it on the account. */
const SETUP_PLACE = '{"audience":"team","at":2,"team":"workspace-ada"}';

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });
  return id;
});

it.layer(getTestDB())("the account store's experiments", (it) => {
  it.effect("a write merges its keys over what stood, and the other parts' writes leave them", () =>
    Effect.gen(function* () {
      const userId = yield* openAccount;

      const turnedOn = yield* writeAccountPreferences(userId, {
        experiments: { [EXPERIMENT.MEMORY]: true },
      });
      assert.deepEqual(turnedOn.experiments, { [EXPERIMENT.MEMORY]: true });

      // An empty patch asks nothing of what stood.
      const untouched = yield* writeAccountPreferences(userId, { experiments: {} });
      assert.deepEqual(untouched.experiments, { [EXPERIMENT.MEMORY]: true });

      yield* writeAccountPreferences(userId, { preferences: {} });
      const afterShared = yield* readAccountPreferences(userId);
      assert.deepEqual(afterShared?.experiments, { [EXPERIMENT.MEMORY]: true });

      const turnedOff = yield* writeAccountPreferences(userId, {
        experiments: { [EXPERIMENT.MEMORY]: false },
      });
      assert.deepEqual(turnedOff.experiments, { [EXPERIMENT.MEMORY]: false });
    }),
  );

  it.effect("a stored key no build lists any more reads as nothing, and the rest still reads", () =>
    Effect.gen(function* () {
      const userId = yield* openAccount;
      yield* writeAccountPreferences(userId, { experiments: { [EXPERIMENT.MEMORY]: true } });
      const db = yield* Database;
      yield* db
        .update(accountPreference)
        // A key written by a build that listed an experiment this one no longer does.
        .set({
          experiments: sql`${JSON.stringify({ [EXPERIMENT.MEMORY]: true, graduated: true })}::jsonb`,
        })
        .where(eq(accountPreference.userId, userId));

      const read = yield* readAccountPreferences(userId);
      assert.deepEqual(read?.experiments, { [EXPERIMENT.MEMORY]: true });
    }),
  );

  it.effect("an experiments write is no snapshot a Mac would take over its own settings", () =>
    Effect.gen(function* () {
      const userId = yield* openAccount;
      const written = yield* writeAccountPreferences(userId, {
        experiments: { [EXPERIMENT.MEMORY]: true },
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
        assert.equal(yield* accountExperimentOn(userId, EXPERIMENT.PILOT), false);
        yield* writeAccountPreferences(userId, { experiments: { [EXPERIMENT.MEMORY]: true } });
        assert.equal(yield* accountExperimentOn(userId, EXPERIMENT.PILOT), false);
        yield* writeAccountPreferences(userId, { experiments: { [EXPERIMENT.PILOT]: true } });
        assert.equal(yield* accountExperimentOn(userId, EXPERIMENT.PILOT), true);
        assert.equal(yield* accountExperimentOn(yield* openAccount, EXPERIMENT.PILOT), false);
        yield* writeAccountPreferences(userId, { experiments: { [EXPERIMENT.PILOT]: false } });
        assert.equal(yield* accountExperimentOn(userId, EXPERIMENT.PILOT), false);
      }),
  );

  it.effect("one account's experiments are no other account's", () =>
    Effect.gen(function* () {
      const owner = yield* openAccount;
      const other = yield* openAccount;
      yield* writeAccountPreferences(owner, { experiments: { [EXPERIMENT.MEMORY]: true } });
      yield* writeAccountPreferences(other, { preferences: {} });

      assert.deepEqual((yield* readAccountPreferences(other))?.experiments, {});
      assert.deepEqual((yield* readAccountPreferences(owner))?.experiments, {
        [EXPERIMENT.MEMORY]: true,
      });
    }),
  );
});

it.layer(getTestDB())("the account store's own-part choices and setup", (it) => {
  it.effect(
    "are each written on their own, stand through a shared preferences write, move no instant, and are no other account's",
    () =>
      Effect.gen(function* () {
        const userId = yield* openAccount;
        const chosen = yield* writeAccountPreferences(userId, { linkOpen: LINK_OPEN.MAC_APP });
        assert.deepEqual(chosen.preferences, { linkOpen: LINK_OPEN.MAC_APP });
        assert.equal(chosen.updatedAt, undefined);
        yield* writeAccountPreferences(userId, { agentEnter: AGENT_ENTER.QUEUE });
        yield* writeAccountPreferences(userId, { commitAuthor: COMMIT_AUTHOR.APP });
        yield* writeAccountPreferences(userId, { setupFinished: true });
        // Note that the place is written by one machine and read by another, as setup resumed elsewhere reads it.
        yield* writeAccountPreferences(userId, { setupPlace: SETUP_PLACE });

        yield* writeAccountPreferences(userId, { preferences: {} });
        const read = yield* readAccountPreferences(userId);
        assert.deepEqual(read?.preferences, {
          linkOpen: LINK_OPEN.MAC_APP,
          agentEnter: AGENT_ENTER.QUEUE,
          commitAuthor: COMMIT_AUTHOR.APP,
          setupFinished: true,
          setupPlace: SETUP_PLACE,
        });
        assert.deepEqual(
          (yield* readAccountPreferences(yield* openAccount))?.preferences,
          undefined,
        );
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

        yield* writeAccountPreferences(userId, { preferences: {} });
        yield* writeAccountPreferences(userId, { experiments: { [EXPERIMENT.MEMORY]: true } });
        assert.equal((yield* readAccountPreferences(userId))?.chaptersModel, CHAPTERS_MODEL.OPUS);

        const other = yield* openAccount;
        yield* writeAccountPreferences(other, { preferences: {} });
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

it.layer(getTestDB())("the account store's access", (it) => {
  it.effect(
    "reads the role and the grant of support access on the account's own row, and no other account's",
    () =>
      Effect.gen(function* () {
        const admin = yield* openAccount;
        const member = yield* openAccount;
        const db = yield* Database;
        const until = new Date("2026-11-12T09:00:00.000Z");
        yield* db
          .update(user)
          .set({ role: "admin", supportAccessUntil: until })
          .where(eq(user.id, admin));

        assert.deepEqual(yield* readAccountAccess(admin), {
          role: "admin",
          supportAccessUntil: until,
        });
        // A new account holds the column's default and no grant, whatever another account was given.
        assert.deepEqual(yield* readAccountAccess(member), {
          role: "user",
          supportAccessUntil: undefined,
        });
      }),
  );

  it.effect("reads nothing where the row holds no role, or there is no such account", () =>
    Effect.gen(function* () {
      const userId = yield* openAccount;
      const db = yield* Database;
      yield* db.update(user).set({ role: null }).where(eq(user.id, userId));

      const nothing = { role: undefined, supportAccessUntil: undefined };
      assert.deepEqual(yield* readAccountAccess(userId), nothing);
      assert.deepEqual(yield* readAccountAccess(`user-${randomUUID()}`), nothing);
    }),
  );
});
