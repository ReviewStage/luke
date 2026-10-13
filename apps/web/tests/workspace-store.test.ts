import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@sidecar/database/core/query";
import type { WorkspaceSeams } from "@sidecar/database/models/workspace-seams";
import {
  ensurePersonalWorkspace,
  listWorkspaces,
  personalWorkspaceOf,
} from "@sidecar/database/models/workspace-store";
import { member, organization, user } from "@sidecar/database/schemas/auth";
import { personalWorkspace } from "@sidecar/database/schemas/personal-workspace";
import { getTestDB } from "@sidecar/database/testing";
import { eq } from "drizzle-orm";
import { Cause, DateTime, Effect, Option } from "effect";
import { openWorkspacePlugin } from "./support/workspace-plugin";
import { fakeWorkspaceSeams, joinWorkspace, WORKSPACE_ROLE } from "./support/workspaces";

/**
 * An account's workspaces over a real dialect: its personal one is made the
 * first time it is asked for and never again, a workspace a racing ensure
 * made and named the account's is adopted rather than doubled, one anyone
 * else made under the account's slug is never adopted, and a list
 * marks the account's own workspace and no teammate's as personal.
 *
 * The plugin's write is a fake over the same tables (`support/workspaces.ts`),
 * refusing a slug that is taken as the plugin does, on both dialects, and Better Auth's own plugin
 * over PGlite in the last case. Synthetic accounts throughout.
 */

/** The row naming the workspace the account's personal one, as a racing ensure writes it. */
const insertPersonalRow = (userId: string, organizationId: string) =>
  Effect.gen(function* () {
    const createdAt = yield* DateTime.nowAsDate;
    yield* Database.use((db) =>
      db.insert(personalWorkspace).values({ userId, organizationId, createdAt }),
    );
  });

const openUser = (name: string) =>
  Effect.gen(function* () {
    const userId = `user-${randomUUID()}`;
    yield* Database.use((db) =>
      db.insert(user).values({ id: userId, name, email: `${userId}@luke.test` }),
    );
    return userId;
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
    for (const teammate of teammates) yield* joinWorkspace(id, teammate, WORKSPACE_ROLE.MEMBER);
    return id;
  });

it.layer(getTestDB())("an account's workspaces over effect/unstable/sql", (it) => {
  it.effect(
    "an account's first ensure makes its personal workspace and the second makes none",
    () =>
      Effect.gen(function* () {
        const seams = yield* fakeWorkspaceSeams;
        const userId = yield* openUser("Ada Lovelace");
        assert.deepEqual(yield* personalWorkspaceOf(userId), Option.none());

        const first = yield* ensurePersonalWorkspace(userId, seams);
        const second = yield* ensurePersonalWorkspace(userId, seams);

        assert.ok(Option.isSome(first));
        assert.deepEqual(second, first);
        assert.deepEqual(yield* personalWorkspaceOf(userId), first);
        assert.deepEqual(yield* listWorkspaces(userId), [
          {
            id: first.value,
            name: "Ada Lovelace",
            personal: true,
            role: WORKSPACE_ROLE.OWNER,
            github: null,
          },
        ]);
      }),
  );

  it.effect("a personal workspace a racing ensure made first is adopted, not doubled", () =>
    Effect.gen(function* () {
      const plugin = yield* fakeWorkspaceSeams;
      const database = yield* Database;
      const userId = yield* openUser("Grace Hopper");
      const raced: string[] = [];
      // The racing ensure makes the workspace and names it the account's while this one asks the plugin, which then refuses the slug.
      const racing: WorkspaceSeams = {
        createOrganization: (creation) =>
          Effect.gen(function* () {
            const { id } = yield* plugin.createOrganization(creation);
            yield* insertPersonalRow(userId, id).pipe(
              Effect.orDie,
              Effect.provideService(Database, database),
            );
            raced.push(id);
            return yield* Effect.fail(new Cause.UnknownError(undefined, "Organization exists"));
          }),
      };

      const ensured = yield* ensurePersonalWorkspace(userId, racing);

      assert.deepEqual(ensured, Option.some(raced[0]));
      assert.deepEqual(yield* listWorkspaces(userId), [
        {
          id: raced[0],
          name: "Grace Hopper",
          personal: true,
          role: WORKSPACE_ROLE.OWNER,
          github: null,
        },
      ]);
    }),
  );

  it.effect(
    "an organization someone else made under the account's personal slug is never adopted",
    () =>
      Effect.gen(function* () {
        const seams = yield* fakeWorkspaceSeams;
        const victim = yield* openUser("Grace Hopper");
        const mallory = yield* openUser("Mallory");
        const squatted = yield* seams.createOrganization({
          name: "Grace Hopper",
          slug: `personal-${victim}`,
          userId: mallory,
          metadata: { personal: true },
        });

        const ensured = yield* ensurePersonalWorkspace(victim, seams);

        assert.ok(Option.isSome(ensured));
        assert.notEqual(ensured.value, squatted.id);
        assert.deepEqual(yield* listWorkspaces(victim), [
          {
            id: ensured.value,
            name: "Grace Hopper",
            personal: true,
            role: WORKSPACE_ROLE.OWNER,
            github: null,
          },
        ]);
      }),
  );

  it.effect(
    "a list marks the account's own workspace personal, first, and the shared ones by name",
    () =>
      Effect.gen(function* () {
        const seams = yield* fakeWorkspaceSeams;
        const owner = yield* openUser("Owner");
        const teammate = yield* openUser("Teammate");
        const ownerPersonal = yield* ensurePersonalWorkspace(owner, seams);
        const teammatePersonal = yield* ensurePersonalWorkspace(teammate, seams);
        assert.ok(Option.isSome(ownerPersonal) && Option.isSome(teammatePersonal));
        const zeta = yield* openSharedWorkspace(seams, "Zeta", owner, [teammate]);
        const acme = yield* openSharedWorkspace(seams, "Acme", teammate, [owner]);

        assert.deepEqual(yield* listWorkspaces(owner), [
          {
            id: ownerPersonal.value,
            name: "Owner",
            personal: true,
            role: WORKSPACE_ROLE.OWNER,
            github: null,
          },
          { id: acme, name: "Acme", personal: false, role: WORKSPACE_ROLE.MEMBER, github: null },
          { id: zeta, name: "Zeta", personal: false, role: WORKSPACE_ROLE.OWNER, github: null },
        ]);
        assert.deepEqual(yield* listWorkspaces(teammate), [
          {
            id: teammatePersonal.value,
            name: "Teammate",
            personal: true,
            role: WORKSPACE_ROLE.OWNER,
            github: null,
          },
          { id: acme, name: "Acme", personal: false, role: WORKSPACE_ROLE.OWNER, github: null },
          { id: zeta, name: "Zeta", personal: false, role: WORKSPACE_ROLE.MEMBER, github: null },
        ]);
      }),
  );

  it.effect("an account gone has no personal workspace to make", () =>
    Effect.gen(function* () {
      const seams = yield* fakeWorkspaceSeams;
      const gone = `user-${randomUUID()}`;

      assert.deepEqual(yield* ensurePersonalWorkspace(gone, seams), Option.none());
      assert.deepEqual(yield* listWorkspaces(gone), []);
    }),
  );
});

const PERSONAL_COLUMNS = { slug: organization.slug, metadata: organization.metadata };

it.effect(
  "the plugin makes the personal workspace the account owns, and one squatting its slug is never adopted",
  () =>
    Effect.gen(function* () {
      const { seams, database } = yield* openWorkspacePlugin;
      yield* Effect.gen(function* () {
        const ada = yield* openUser("Ada Lovelace");
        const grace = yield* openUser("Grace Hopper");
        const squatted = yield* seams.createOrganization({
          name: "Grace Hopper",
          slug: `personal-${grace}`,
          userId: ada,
          metadata: { personal: true },
        });

        const adas = yield* ensurePersonalWorkspace(ada, seams);
        const graces = yield* ensurePersonalWorkspace(grace, seams);

        assert.ok(Option.isSome(adas));
        assert.ok(Option.isSome(graces));
        assert.notEqual(graces.value, squatted.id);
        assert.deepEqual(
          yield* Database.use((db) =>
            db.select(PERSONAL_COLUMNS).from(organization).where(eq(organization.id, adas.value)),
          ),
          [{ slug: `personal-${ada}`, metadata: '{"personal":true}' }],
        );
        assert.deepEqual(
          yield* Database.use((db) =>
            db
              .select({ userId: member.userId, role: member.role })
              .from(member)
              .where(eq(member.organizationId, adas.value)),
          ),
          [{ userId: ada, role: WORKSPACE_ROLE.OWNER }],
        );
        const [gracesSlug] = yield* Database.use((db) =>
          db
            .select({ slug: organization.slug })
            .from(organization)
            .where(eq(organization.id, graces.value)),
        );
        assert.ok(gracesSlug?.slug.startsWith(`personal-${grace}-`));
        assert.deepEqual(yield* listWorkspaces(grace), [
          {
            id: graces.value,
            name: "Grace Hopper",
            personal: true,
            role: WORKSPACE_ROLE.OWNER,
            github: null,
          },
        ]);
      }).pipe(Effect.provide(database));
    }),
);
