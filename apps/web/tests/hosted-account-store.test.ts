import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import {
  deleteAccount,
  readAccountPreferences,
  writeAccountPreferences,
} from "@repo/database/models/account-store";
import { member, organization, user } from "@repo/database/schemas/auth";
import { personalWorkspace } from "@repo/database/schemas/personal-workspace";
import { accountPreference } from "@repo/database/schemas/preferences";
import { hostedUsage } from "@repo/database/schemas/usage";
import { getTestDB } from "@repo/database/testing";
import { AGENT_DEFAULT_CHOICE } from "@repo/features/models-wire";
import { count, eq, getColumnTable, or } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { Duration, Effect } from "effect";
import { TestClock } from "effect/testing";

const SONNET_AT_MAX = { model: "anthropic/claude-sonnet-5.5", effort: "max" } as const;

const openUser = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` });
  return userId;
});

const openWorkspace = (input: { name: string; slug: string; owner: string; first: boolean }) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const id = randomUUID();
    const now = new Date("2099-01-01T00:00:00.000Z");
    yield* db
      .insert(organization)
      .values({ id, name: input.name, slug: input.slug, createdAt: now });
    yield* db.insert(member).values({
      id: randomUUID(),
      organizationId: id,
      userId: input.owner,
      role: "owner",
      createdAt: now,
    });
    if (input.first) {
      yield* db
        .insert(personalWorkspace)
        .values({ userId: input.owner, organizationId: id, createdAt: now });
    }
    return id;
  });

const rowsOwnedBy = (column: PgColumn, userId: string) =>
  Effect.map(
    Database.use((db) =>
      db.select({ rows: count() }).from(getColumnTable(column)).where(eq(column, userId)),
    ),
    (rows) => rows[0]?.rows ?? 0,
  );

const countRows = (userId: string) =>
  Effect.gen(function* () {
    return {
      preferences: yield* rowsOwnedBy(accountPreference.userId, userId),
      usage: yield* rowsOwnedBy(hostedUsage.userId, userId),
    };
  });

it.layer(getTestDB())("the account group's seams over effect/sql", (it) => {
  it.effect("a written snapshot reads back whole, at the instant it was written", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      const { txid: _committedIn, ...written } = yield* writeAccountPreferences(userId, {
        preferences: {},
      });

      const read = yield* readAccountPreferences(userId);
      assert.ok(read?.updatedAt instanceof Date);
      assert.equal(read?.updatedAt?.getTime(), written.updatedAt?.getTime());
      assert.deepEqual(read, written);
    }),
  );

  it.effect("each part of the snapshot is written on its own and leaves the other standing", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      const chosen = yield* writeAccountPreferences(userId, { agent: SONNET_AT_MAX });
      assert.deepEqual(chosen.agent, SONNET_AT_MAX);
      assert.deepEqual(chosen.preferences, {});
      assert.equal(chosen.updatedAt, undefined);
      assert.equal((yield* readAccountPreferences(userId))?.updatedAt, undefined);

      yield* writeAccountPreferences(userId, { preferences: {} });
      const afterPreferences = yield* readAccountPreferences(userId);
      assert.deepEqual(afterPreferences?.agent, SONNET_AT_MAX);
      assert.ok(afterPreferences?.updatedAt instanceof Date);

      yield* TestClock.adjust(Duration.minutes(1));
      yield* writeAccountPreferences(userId, { agent: AGENT_DEFAULT_CHOICE });
      const afterChoice = yield* readAccountPreferences(userId);
      assert.deepEqual(afterChoice?.agent, AGENT_DEFAULT_CHOICE);
      assert.equal(afterChoice?.updatedAt?.getTime(), afterPreferences?.updatedAt?.getTime());
      assert.deepEqual(yield* countRows(userId), { preferences: 1, usage: 0 });
    }),
  );

  it.effect("the delete takes the account's dependent rows and leaves another's standing", () =>
    Effect.gen(function* () {
      const db = yield* Database;
      const erased = yield* openUser;
      const kept = yield* openUser;
      for (const userId of [erased, kept]) {
        yield* writeAccountPreferences(userId, { preferences: {} });
        yield* db.insert(hostedUsage).values({ userId, day: "2099-01-01", calls: 3 });
      }

      yield* deleteAccount(erased);

      const remaining = yield* db.select({ id: user.id }).from(user).where(eq(user.id, erased));
      assert.equal(remaining.length, 0);
      assert.deepEqual(yield* countRows(erased), { preferences: 0, usage: 0 });
      assert.deepEqual(yield* countRows(kept), { preferences: 1, usage: 1 });
    }),
  );

  it.effect(
    "the delete leaves the account's first workspace standing, as any it owns, and takes only its member rows",
    () =>
      Effect.gen(function* () {
        const db = yield* Database;
        const erased = yield* openUser;
        const kept = yield* openUser;
        const first = yield* openWorkspace({
          name: "Test User",
          slug: `personal-${erased}`,
          owner: erased,
          first: true,
        });
        const shared = yield* openWorkspace({
          name: "Acme",
          slug: `acme-${randomUUID()}`,
          owner: kept,
          first: false,
        });
        for (const organizationId of [first, shared]) {
          yield* db.insert(member).values({
            id: randomUUID(),
            organizationId,
            userId: organizationId === first ? kept : erased,
            role: "member",
            createdAt: new Date("2099-01-01T00:00:00.000Z"),
          });
        }

        yield* deleteAccount(erased);

        const standing = yield* db
          .select({ id: organization.id })
          .from(organization)
          .where(or(eq(organization.id, first), eq(organization.id, shared)));
        assert.equal(standing.length, 2);
        const membersOf = (organizationId: string) =>
          db
            .select({ userId: member.userId })
            .from(member)
            .where(eq(member.organizationId, organizationId));
        assert.deepEqual(yield* membersOf(first), [{ userId: kept }]);
        assert.deepEqual(yield* membersOf(shared), [{ userId: kept }]);
      }),
  );
});
