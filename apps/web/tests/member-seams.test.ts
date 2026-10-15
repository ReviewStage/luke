import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { OrganizationRefused } from "@luke/database/models/workspace-seams";
import { openGithubUser } from "@luke/service/testing/github-app-fake";
import { Effect, Exit, Option } from "effect";
import { memberIdOf } from "../server/hosted/workspace-members";
import { openWorkspacePlugin } from "./support/workspace-plugin";

/**
 * The member writes as Better Auth's organization plugin answers them, under
 * a real session over PGlite: a write the plugin refuses comes back as its
 * refusal, by the status it carried, so a route can tell a session the
 * plugin did not take from a write it would not make. Synthetic accounts.
 */

/** The failure an effect ended on, failing the test where it succeeded. */
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

        // The plugin's own word on it, whichever client error it chose: not the session's refusal.
        assert.ok(refused instanceof OrganizationRefused);
        assert.ok(refused.status >= 400 && refused.status < 500 && refused.status !== 401);
        assert.ok(unsigned instanceof OrganizationRefused);
        assert.equal(unsigned.status, 401);
      }).pipe(Effect.provide(plugin.database));
    }),
);
