import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { count, eq } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { Effect } from "effect";
import { user } from "../server/db/auth-schema";
import { accountPreference, accountWorkspacePreference } from "../server/db/preferences-schema";
import { db } from "../server/db/query";
import { hostedUsage } from "../server/db/usage-schema";
import {
  deleteAccount,
  readAccountPreferences,
  writeAccountPreferences,
} from "../server/hosted/account-store";

import { testSqlClient } from "./support/sql-client";

/**
 * The account group's own reads and writes against a real Postgres dialect.
 * The delete is the one action root AGENTS.md treats as unrecoverable, so
 * what is pinned here is the unit as well as the answer: the dependent rows
 * of exactly the named account go with it, another account's stand, and a
 * rewritten snapshot replaces its per-provider rows whole rather than
 * merging into what stood.
 *
 * Synthetic accounts, provider ids, and project ids throughout.
 */

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
      workspaces: yield* rowsOwnedBy(accountWorkspacePreference.userId, userId),
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
      const written = yield* writeAccountPreferences(userId, {
        voice: "cedar",
        defaultWorkspaceProvider: "conductor",
        workspaceProjectDefaults: { conductor: "project-a", codex: "project-b" },
        workspaceAgentDefaults: {
          conductor: { agent: "claude", model: "opus", effort: "high" },
        },
      });

      const read = yield* readAccountPreferences(userId);
      assert.deepEqual(read?.preferences, {
        voice: "cedar",
        defaultWorkspaceProvider: "conductor",
        workspaceProjectDefaults: { conductor: "project-a", codex: "project-b" },
        workspaceAgentDefaults: {
          conductor: { agent: "claude", model: "opus", effort: "high" },
        },
      });
      assert.equal(read?.updatedAt.getTime(), written.getTime());
    }),
  );

  it.effect("a rewrite replaces the per-provider rows rather than merging into them", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      yield* writeAccountPreferences(userId, {
        workspaceProjectDefaults: { conductor: "project-a", codex: "project-b" },
      });
      yield* writeAccountPreferences(userId, {
        voice: "marin",
        workspaceProjectDefaults: { conductor: "project-c" },
      });

      const read = yield* readAccountPreferences(userId);
      assert.deepEqual(read?.preferences, {
        voice: "marin",
        workspaceProjectDefaults: { conductor: "project-c" },
      });
      assert.deepEqual(yield* countRows(userId), {
        preferences: 1,
        workspaces: 1,
        usage: 0,
      });
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
        yield* writeAccountPreferences(userId, {
          voice: "cedar",
          workspaceProjectDefaults: { conductor: "project-a" },
        });
        yield* db.insert(hostedUsage).values({ userId, day: "2099-01-01", calls: 3 });
      }

      yield* deleteAccount(erased);

      const remaining = yield* db.select({ id: user.id }).from(user).where(eq(user.id, erased));
      assert.equal(remaining.length, 0);
      assert.deepEqual(yield* countRows(erased), {
        preferences: 0,
        workspaces: 0,
        usage: 0,
      });
      assert.deepEqual(yield* countRows(kept), {
        preferences: 1,
        workspaces: 1,
        usage: 1,
      });
    }),
  );
});
