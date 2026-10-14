import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@sidecar/database/core/query";
import { type WorkspaceSeams, workspaceSeams } from "@sidecar/database/models/workspace-seams";
import {
  ensurePersonalWorkspace,
  listWorkspaces,
  personalWorkspaceOf,
} from "@sidecar/database/models/workspace-store";
import { member, organization, user } from "@sidecar/database/schemas/auth";
import { getTestDB, openMigratedPglite, sqlClientOverPglite } from "@sidecar/database/testing";
import { betterAuth } from "better-auth";
import { organization as organizationPlugin } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { Cause, DateTime, Effect, Option } from "effect";
import { authDatabaseAdapter } from "../server/auth-database";
import { DISABLED_AUTH_PATHS, ORGANIZATION_OPTIONS } from "../server/auth-policy";

/**
 * An account's workspaces over a real dialect: its personal one is made the
 * first time it is asked for and never again, a workspace a racing ensure
 * made under the account's slug is adopted rather than doubled, and a list
 * marks the account's own workspace and no teammate's as personal.
 *
 * The plugin's write is a fake over the same tables, refusing a slug that is
 * taken as the plugin does, on both dialects, and Better Auth's own plugin
 * over PGlite in the last case. Synthetic accounts throughout.
 */

const MEMBER_ROLE = {
  OWNER: "owner",
  MEMBER: "member",
} as const;

/** The plugin's server-only create, over the test's own database: the organization, then its owner. */
const fakeSeams = Effect.gen(function* () {
  const db = yield* Database;
  const seams: WorkspaceSeams = {
    createOrganization: (creation) =>
      Effect.gen(function* () {
        const taken = yield* db
          .select({ id: organization.id })
          .from(organization)
          .where(eq(organization.slug, creation.slug));
        if (taken.length > 0) {
          return yield* Effect.fail(
            new Cause.UnknownError(undefined, "Organization already exists"),
          );
        }
        const id = randomUUID();
        const now = yield* DateTime.nowAsDate;
        yield* db.insert(organization).values({
          id,
          name: creation.name,
          slug: creation.slug,
          metadata: JSON.stringify(creation.metadata),
          createdAt: now,
        });
        yield* joinWorkspace(id, creation.userId, MEMBER_ROLE.OWNER);
        return { id };
      }).pipe(
        Effect.catchTag("EffectDrizzleQueryError", (failure) =>
          Effect.fail(new Cause.UnknownError(failure, "Failed to create organization")),
        ),
        Effect.provideService(Database, db),
      ),
  };
  return seams;
});

const openUser = (name: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const userId = `user-${randomUUID()}`;
    yield* db.insert(user).values({ id: userId, name, email: `${userId}@luke.test` });
    return userId;
  });

const joinWorkspace = (organizationId: string, userId: string, role: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const now = yield* DateTime.nowAsDate;
    yield* db
      .insert(member)
      .values({ id: randomUUID(), organizationId, userId, role, createdAt: now });
  });

/** A shared workspace the owner made through the plugin, joined by each teammate. */
const openSharedWorkspace = (
  seams: WorkspaceSeams,
  name: string,
  owner: string,
  teammates: readonly string[],
) =>
  Effect.gen(function* () {
    const { id } = yield* seams.createOrganization({
      name,
      slug: `${name.toLowerCase()}-${randomUUID()}`,
      userId: owner,
      metadata: {},
    });
    for (const teammate of teammates) yield* joinWorkspace(id, teammate, MEMBER_ROLE.MEMBER);
    return id;
  });

it.layer(getTestDB())("an account's workspaces over the test database", (it) => {
  it.effect(
    "an account's first ensure makes its personal workspace and the second makes none",
    () =>
      Effect.gen(function* () {
        const seams = yield* fakeSeams;
        const userId = yield* openUser("Ada Lovelace");
        assert.deepEqual(yield* personalWorkspaceOf(userId), Option.none());

        const first = yield* ensurePersonalWorkspace(userId, seams);
        const second = yield* ensurePersonalWorkspace(userId, seams);

        assert.ok(Option.isSome(first));
        assert.deepEqual(second, first);
        assert.deepEqual(yield* personalWorkspaceOf(userId), first);
        assert.deepEqual(yield* listWorkspaces(userId), [
          { id: first.value, name: "Ada Lovelace", personal: true },
        ]);
      }),
  );

  it.effect("a personal workspace a racing ensure already made is adopted, not doubled", () =>
    Effect.gen(function* () {
      const seams = yield* fakeSeams;
      const userId = yield* openUser("Grace Hopper");
      const raced = yield* seams.createOrganization({
        name: "Grace Hopper",
        slug: `personal-${userId}`,
        userId,
        metadata: { personal: true },
      });

      const ensured = yield* ensurePersonalWorkspace(userId, seams);

      assert.deepEqual(ensured, Option.some(raced.id));
      assert.deepEqual(yield* listWorkspaces(userId), [
        { id: raced.id, name: "Grace Hopper", personal: true },
      ]);
    }),
  );

  it.effect(
    "a list marks the account's own workspace personal, first, and the shared ones by name",
    () =>
      Effect.gen(function* () {
        const seams = yield* fakeSeams;
        const owner = yield* openUser("Owner");
        const teammate = yield* openUser("Teammate");
        const ownerPersonal = yield* ensurePersonalWorkspace(owner, seams);
        const teammatePersonal = yield* ensurePersonalWorkspace(teammate, seams);
        assert.ok(Option.isSome(ownerPersonal) && Option.isSome(teammatePersonal));
        const zeta = yield* openSharedWorkspace(seams, "Zeta", owner, [teammate]);
        const acme = yield* openSharedWorkspace(seams, "Acme", teammate, [owner]);

        assert.deepEqual(yield* listWorkspaces(owner), [
          { id: ownerPersonal.value, name: "Owner", personal: true },
          { id: acme, name: "Acme", personal: false },
          { id: zeta, name: "Zeta", personal: false },
        ]);
        assert.deepEqual(yield* listWorkspaces(teammate), [
          { id: teammatePersonal.value, name: "Teammate", personal: true },
          { id: acme, name: "Acme", personal: false },
          { id: zeta, name: "Zeta", personal: false },
        ]);
      }),
  );

  it.effect("an account gone has no personal workspace to make", () =>
    Effect.gen(function* () {
      const seams = yield* fakeSeams;
      const gone = `user-${randomUUID()}`;

      assert.deepEqual(yield* ensurePersonalWorkspace(gone, seams), Option.none());
      assert.deepEqual(yield* listWorkspaces(gone), []);
    }),
  );
});

/** Better Auth with the organization plugin over a migrated PGlite of its own, which the store reads through the same database. */
const openPluginDatabase = Effect.gen(function* () {
  const client = yield* Effect.acquireRelease(Effect.promise(openMigratedPglite), (opened) =>
    Effect.promise(() => opened.close()),
  );
  const plugin = betterAuth({
    database: authDatabaseAdapter(drizzle({ client })),
    baseURL: "http://127.0.0.1",
    secret: "workspace-store-test-secret-with-enough-length",
    disabledPaths: [...DISABLED_AUTH_PATHS],
    plugins: [organizationPlugin(ORGANIZATION_OPTIONS)],
  });
  return { seams: workspaceSeams(plugin.api), database: sqlClientOverPglite(client) };
});

const PERSONAL_COLUMNS = { slug: organization.slug, metadata: organization.metadata };

it.effect(
  "the plugin makes the personal workspace the account owns, and refuses a second the store adopts",
  () =>
    Effect.gen(function* () {
      const { seams, database } = yield* openPluginDatabase;
      yield* Effect.gen(function* () {
        const db = yield* Database;
        const ada = yield* openUser("Ada Lovelace");
        const grace = yield* openUser("Grace Hopper");
        const raced = yield* seams.createOrganization({
          name: "Grace Hopper",
          slug: `personal-${grace}`,
          userId: grace,
          metadata: { personal: true },
        });

        const adas = yield* ensurePersonalWorkspace(ada, seams);
        const graces = yield* ensurePersonalWorkspace(grace, seams);

        assert.ok(Option.isSome(adas));
        assert.deepEqual(graces, Option.some(raced.id));
        assert.deepEqual(
          yield* db
            .select(PERSONAL_COLUMNS)
            .from(organization)
            .where(eq(organization.id, adas.value)),
          [{ slug: `personal-${ada}`, metadata: '{"personal":true}' }],
        );
        assert.deepEqual(
          yield* db
            .select({ userId: member.userId, role: member.role })
            .from(member)
            .where(eq(member.organizationId, adas.value)),
          [{ userId: ada, role: MEMBER_ROLE.OWNER }],
        );
        assert.deepEqual(yield* listWorkspaces(grace), [
          { id: raced.id, name: "Grace Hopper", personal: true },
        ]);
      }).pipe(Effect.provide(database));
    }),
);
