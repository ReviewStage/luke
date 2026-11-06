import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { OrganizationRefused } from "@repo/database/models/workspace-seams";
import { organization } from "@repo/database/schemas/auth";
import { eq } from "drizzle-orm";
import { Effect, Exit, Option } from "effect";
import { openGithubUser } from "../testing/github-app-fake.js";
import { openWorkspacePlugin } from "../testing/workspace-plugin.js";
import { memberIdOf } from "./workspace-members.js";

const failureOf = <E>(exit: Exit.Exit<void, E>): E => {
  if (Exit.isSuccess(exit)) return assert.fail("the plugin made a write it should have refused");
  const failure = exit.cause.reasons.find((reason) => reason._tag === "Fail");
  return failure?._tag === "Fail" ? failure.error : assert.fail("not a refusal");
};

it.effect(
  "a member's removal of the owner is the plugin's refusal, and a write with no session its 401",
  () =>
    Effect.gen(function* () {
      const plugin = yield* openWorkspacePlugin;
      yield* Effect.gen(function* () {
        const ada = yield* openGithubUser();
        const grace = yield* openGithubUser();
        const acme = yield* Effect.promise(() =>
          plugin.api.createOrganization({ body: { name: "Acme", slug: "acme", userId: ada } }),
        );
        yield* Effect.promise(() =>
          plugin.api.addMember({
            body: { userId: grace, organizationId: acme.id, role: "member" },
          }),
        );
        const ownerMemberId = Option.getOrThrow(yield* memberIdOf(ada, acme.id));
        const headers = new Headers({
          authorization: `Bearer ${yield* plugin.sessionBearerOf(grace)}`,
        });

        const refused = failureOf(
          yield* Effect.exit(
            plugin.members.removeMember({
              headers,
              organizationId: acme.id,
              memberId: ownerMemberId,
            }),
          ),
        );
        const unsigned = failureOf(
          yield* Effect.exit(
            plugin.members.leaveOrganization({ headers: new Headers(), organizationId: acme.id }),
          ),
        );

        assert.ok(refused instanceof OrganizationRefused);
        assert.ok(refused.status >= 400 && refused.status < 500 && refused.status !== 401);
        assert.ok(unsigned instanceof OrganizationRefused);
        assert.equal(unsigned.status, 401);
      }).pipe(Effect.provide(plugin.database));
    }),
);

it.effect("a member's rename is the plugin's refusal, and an admin's renames the workspace", () =>
  Effect.gen(function* () {
    const plugin = yield* openWorkspacePlugin;
    yield* Effect.gen(function* () {
      const ada = yield* openGithubUser();
      const grace = yield* openGithubUser();
      const alan = yield* openGithubUser();
      const acme = yield* Effect.promise(() =>
        plugin.api.createOrganization({ body: { name: "Acme", slug: "acme", userId: ada } }),
      );
      for (const [userId, role] of [
        [grace, "admin"],
        [alan, "member"],
      ] as const) {
        yield* Effect.promise(() =>
          plugin.api.addMember({ body: { userId, organizationId: acme.id, role } }),
        );
      }
      const sessionOf = (userId: string) =>
        Effect.map(
          plugin.sessionBearerOf(userId),
          (bearer) => new Headers({ authorization: `Bearer ${bearer}` }),
        );

      const refused = failureOf(
        yield* Effect.exit(
          plugin.members.updateOrganization({
            headers: yield* sessionOf(alan),
            organizationId: acme.id,
            data: { name: "Alan's" },
          }),
        ),
      );
      yield* plugin.members.updateOrganization({
        headers: yield* sessionOf(grace),
        organizationId: acme.id,
        data: { name: "Acme Labs" },
      });
      const stored = yield* Database.use((db) =>
        db
          .select({ name: organization.name, slug: organization.slug })
          .from(organization)
          .where(eq(organization.id, acme.id)),
      );

      assert.ok(refused instanceof OrganizationRefused);
      assert.equal(refused.status, 403);
      assert.deepEqual(stored, [{ name: "Acme Labs", slug: "acme" }]);
    }).pipe(Effect.provide(plugin.database));
  }),
);

it.effect(
  "a member's photo is the plugin's refusal, an admin's sets the logo alone, and null removes it",
  () =>
    Effect.gen(function* () {
      const plugin = yield* openWorkspacePlugin;
      yield* Effect.gen(function* () {
        const ada = yield* openGithubUser();
        const grace = yield* openGithubUser();
        const alan = yield* openGithubUser();
        const acme = yield* Effect.promise(() =>
          plugin.api.createOrganization({ body: { name: "Acme", slug: "acme", userId: ada } }),
        );
        for (const [userId, role] of [
          [grace, "admin"],
          [alan, "member"],
        ] as const) {
          yield* Effect.promise(() =>
            plugin.api.addMember({ body: { userId, organizationId: acme.id, role } }),
          );
        }
        const sessionOf = (userId: string) =>
          Effect.map(
            plugin.sessionBearerOf(userId),
            (bearer) => new Headers({ authorization: `Bearer ${bearer}` }),
          );
        const stored = Database.use((db) =>
          db
            .select({ name: organization.name, slug: organization.slug, logo: organization.logo })
            .from(organization)
            .where(eq(organization.id, acme.id)),
        );
        const photo = "data:image/png;base64,iVBORw0KGgo=";

        const refused = failureOf(
          yield* Effect.exit(
            plugin.members.updateOrganization({
              headers: yield* sessionOf(alan),
              organizationId: acme.id,
              data: { logo: photo },
            }),
          ),
        );
        const afterMember = yield* stored;
        yield* plugin.members.updateOrganization({
          headers: yield* sessionOf(grace),
          organizationId: acme.id,
          data: { logo: photo },
        });
        const afterAdmin = yield* stored;
        yield* plugin.members.updateOrganization({
          headers: yield* sessionOf(grace),
          organizationId: acme.id,
          data: { logo: null },
        });

        assert.ok(refused instanceof OrganizationRefused);
        assert.equal(refused.status, 403);
        assert.deepEqual(afterMember, [{ name: "Acme", slug: "acme", logo: null }]);
        assert.deepEqual(afterAdmin, [{ name: "Acme", slug: "acme", logo: photo }]);
        assert.deepEqual(yield* stored, [{ name: "Acme", slug: "acme", logo: null }]);
      }).pipe(Effect.provide(plugin.database));
    }),
);
