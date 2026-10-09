import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { count, eq } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { Duration, Effect } from "effect";
import { TestClock } from "effect/testing";
import { user } from "../server/db/auth-schema";
import { accountPreference } from "../server/db/preferences-schema";
import { db } from "../server/db/query";
import { hostedUsage } from "../server/db/usage-schema";
import {
  deleteAccount,
  readAccountPreferences,
  writeAccountPreferences,
} from "../server/hosted/account-store";
import { CODING_AGENT_DEFAULT_CHOICE } from "../server/hosted/model-catalog";

import { testSqlClient } from "./support/sql-client";

/**
 * The account group's own reads and writes against a real Postgres dialect.
 * The delete is the one action root AGENTS.md treats as unrecoverable, so
 * what is pinned here is the unit as well as the answer: the dependent rows
 * of exactly the named account go with it, another account's stand, and a
 * rewritten snapshot replaces what stood whole rather than merging into it.
 * The coding agents' default is the snapshot's other part: written on its
 * own or beside the preferences, each part replacing only itself, and the
 * catalog's default where none was ever chosen.
 *
 * Synthetic accounts throughout.
 */

const SONNET_AT_MAX = { model: "anthropic/claude-sonnet-5.5", effort: "max" } as const;

const openUser = Effect.gen(function* () {
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
  return userId;
});

/** The account's own rows in the table one owning column belongs to. */
const rowsOwnedBy = (column: PgColumn, userId: string) =>
  Effect.map(
    db.select({ rows: count() }).from(column.table).where(eq(column, userId)),
    (rows) => rows[0]?.rows ?? 0,
  );

/** How many of the account's rows stand in each table the delete reaches. */
const countRows = (userId: string) =>
  Effect.gen(function* () {
    return {
      preferences: yield* rowsOwnedBy(accountPreference.userId, userId),
      usage: yield* rowsOwnedBy(hostedUsage.userId, userId),
    };
  });

it.layer(testSqlClient)("the account group's seams over effect/unstable/sql", (it) => {
  it.effect("an account that stored nothing reads as nothing", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      assert.equal(yield* readAccountPreferences(userId), undefined);
    }),
  );

  it.effect("a written snapshot reads back whole, at the instant it was written", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      const written = yield* writeAccountPreferences(userId, { preferences: { voice: "cedar" } });

      const read = yield* readAccountPreferences(userId);
      assert.deepEqual(read?.preferences, { voice: "cedar" });
      assert.equal(read?.updatedAt?.getTime(), written.updatedAt?.getTime());
      assert.deepEqual(read, written);
    }),
  );

  it.effect("a rewrite replaces the snapshot rather than merging into it", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      yield* writeAccountPreferences(userId, { preferences: { voice: "cedar" } });
      yield* writeAccountPreferences(userId, { preferences: {} });

      const read = yield* readAccountPreferences(userId);
      assert.deepEqual(read?.preferences, {});
      assert.deepEqual(yield* countRows(userId), { preferences: 1, usage: 0 });
    }),
  );

  it.effect("an account that never chose a coding-agent default reads the catalog's", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      yield* writeAccountPreferences(userId, { preferences: { voice: "cedar" } });

      const read = yield* readAccountPreferences(userId);
      assert.deepEqual(read?.codingAgent, CODING_AGENT_DEFAULT_CHOICE);
    }),
  );

  it.effect("each part of the snapshot is written on its own and leaves the other standing", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      const chosen = yield* writeAccountPreferences(userId, { codingAgent: SONNET_AT_MAX });
      assert.deepEqual(chosen.codingAgent, SONNET_AT_MAX);
      assert.deepEqual(chosen.preferences, {});
      // No preferences were ever written, so there is no snapshot for a Mac to take.
      assert.equal(chosen.updatedAt, undefined);
      assert.equal((yield* readAccountPreferences(userId))?.updatedAt, undefined);

      yield* writeAccountPreferences(userId, { preferences: { voice: "cedar" } });
      const afterPreferences = yield* readAccountPreferences(userId);
      assert.deepEqual(afterPreferences?.codingAgent, SONNET_AT_MAX);
      assert.deepEqual(afterPreferences?.preferences, { voice: "cedar" });
      assert.ok(afterPreferences?.updatedAt instanceof Date);

      yield* TestClock.adjust(Duration.minutes(1));
      yield* writeAccountPreferences(userId, { codingAgent: CODING_AGENT_DEFAULT_CHOICE });
      const afterChoice = yield* readAccountPreferences(userId);
      assert.deepEqual(afterChoice?.codingAgent, CODING_AGENT_DEFAULT_CHOICE);
      assert.deepEqual(afterChoice?.preferences, { voice: "cedar" });
      // The instant is the preferences part's own, so a choice leaves it where it stood.
      assert.equal(afterChoice?.updatedAt?.getTime(), afterPreferences?.updatedAt?.getTime());
      assert.deepEqual(yield* countRows(userId), { preferences: 1, usage: 0 });
    }),
  );

  it.effect("a half-written coding-agent default reads as the catalog's", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      yield* db.insert(accountPreference).values({ userId, codingAgentModel: SONNET_AT_MAX.model });
      const read = yield* readAccountPreferences(userId);
      assert.deepEqual(read?.codingAgent, CODING_AGENT_DEFAULT_CHOICE);
    }),
  );

  it.effect("a value the vocabulary does not name is left out of the snapshot", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      yield* db.insert(accountPreference).values({ userId, voice: "not-a-voice" });
      const read = yield* readAccountPreferences(userId);
      assert.deepEqual(read?.preferences, {});
    }),
  );

  it.effect("the delete takes the account's dependent rows and leaves another's standing", () =>
    Effect.gen(function* () {
      const erased = yield* openUser;
      const kept = yield* openUser;
      for (const userId of [erased, kept]) {
        yield* writeAccountPreferences(userId, { preferences: { voice: "cedar" } });
        yield* db.insert(hostedUsage).values({ userId, day: "2099-01-01", calls: 3 });
      }

      yield* deleteAccount(erased);

      const remaining = yield* db.select({ id: user.id }).from(user).where(eq(user.id, erased));
      assert.equal(remaining.length, 0);
      assert.deepEqual(yield* countRows(erased), { preferences: 0, usage: 0 });
      assert.deepEqual(yield* countRows(kept), { preferences: 1, usage: 1 });
    }),
  );
});
