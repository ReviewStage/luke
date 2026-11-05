import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import {
  GITHUB_ACCOUNT_TYPE,
  GITHUB_INSTALLATION_STATUS,
} from "@repo/database/github-installation-vocabulary";
import {
  deleteAccount,
  readAccountPreferences,
  writeAccountPreferences,
} from "@repo/database/models/account-store";
import { agentTable } from "@repo/database/schemas/agent";
import { member, organization, user } from "@repo/database/schemas/auth";
import { githubInstallation } from "@repo/database/schemas/github-installation";
import { personalWorkspace } from "@repo/database/schemas/personal-workspace";
import { accountPreference } from "@repo/database/schemas/preferences";
import { conversations } from "@repo/database/schemas/storage";
import { hostedUsage } from "@repo/database/schemas/usage";
import { getTestDB, openTaskAgent } from "@repo/database/testing";
import { AGENT_DEFAULT_CHOICE } from "@repo/features/models-wire";
import { count, eq, getColumnTable, or } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { Duration, Effect } from "effect";
import { TestClock } from "effect/testing";

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
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` });
  return userId;
});

/**
 * An organization with its first member as owner, as the plugin writes one,
 * and, for the account's first workspace, the row naming it the account's,
 * as `ensurePersonalWorkspace` writes it.
 */
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

/** The account's own rows in the table one owning column belongs to. */
const rowsOwnedBy = (column: PgColumn, userId: string) =>
  Effect.map(
    Database.use((db) =>
      db.select({ rows: count() }).from(getColumnTable(column)).where(eq(column, userId)),
    ),
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

it.layer(getTestDB())("the account group's seams over effect/sql", (it) => {
  it.effect("a written snapshot reads back whole, at the instant it was written", () =>
    Effect.gen(function* () {
      const userId = yield* openUser;
      // Note that a write answers the transaction it committed in beside the snapshot, which a read carries none of.
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
      // No preferences were ever written, so there is no snapshot for a Mac to take.
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
      // The instant is the preferences part's own, so a choice leaves it where it stood.
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
    "the delete takes the workspaces the account is the only member of, its first among them, and their GitHub connection, stamps their agents' conversations, and leaves a shared workspace with its other members",
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
        yield* db.insert(member).values({
          id: randomUUID(),
          organizationId: shared,
          userId: erased,
          role: "member",
          createdAt: new Date("2099-01-01T00:00:00.000Z"),
        });
        const now = new Date("2099-01-01T00:00:00.000Z");
        yield* db.insert(githubInstallation).values({
          installationId: 4_200,
          organizationId: first,
          accountId: 4_201,
          accountLogin: "acme",
          accountType: GITHUB_ACCOUNT_TYPE.ORGANIZATION,
          status: GITHUB_INSTALLATION_STATUS.ACTIVE,
          createdAt: now,
          updatedAt: now,
        });
        // A member who has since left ran this agent in the first workspace, so its conversation names them rather than the account.
        const formerAgent = yield* openTaskAgent(kept, first, null);
        const [former] = yield* db
          .select({ conversationId: agentTable.conversationId })
          .from(agentTable)
          .where(eq(agentTable.id, formerAgent));
        assert.ok(former !== undefined);

        yield* deleteAccount(erased);

        const standing = yield* db
          .select({ id: organization.id })
          .from(organization)
          .where(or(eq(organization.id, first), eq(organization.id, shared)));
        assert.deepEqual(standing, [{ id: shared }]);
        const installations = yield* db
          .select({ id: githubInstallation.installationId })
          .from(githubInstallation)
          .where(eq(githubInstallation.installationId, 4_200));
        assert.deepEqual(installations, []);
        const [stamped] = yield* db
          .select({ deletedAt: conversations.deletedAt })
          .from(conversations)
          .where(eq(conversations.id, former.conversationId));
        assert.ok(stamped?.deletedAt != null);
        const members = yield* db
          .select({ userId: member.userId })
          .from(member)
          .where(eq(member.organizationId, shared));
        assert.deepEqual(members, [{ userId: kept }]);
      }),
  );
});
