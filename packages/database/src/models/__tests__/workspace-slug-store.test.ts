import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { eq } from "drizzle-orm";
import { Effect, Option } from "effect";
import { Database } from "../../core/query.js";
import { organization, user } from "../../schemas/auth.js";
import { getTestDB, openWorkspace } from "../../testing/index.js";
import {
  formerSlugHeld,
  setWorkspaceSlug,
  WorkspaceSlugTaken,
  workspaceIdOfSlug,
} from "../workspace-slug-store.js";
import { listWorkspaces } from "../workspace-store.js";

/**
 * A workspace's slug changed over a real dialect: the slug it leaves stays
 * its own, read back to its members alone, so another workspace is refused
 * it, whatever its case, while the workspace itself takes it back.
 *
 * Synthetic accounts and workspaces throughout.
 */

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });
  return id;
});

const slugOf = (organizationId: string) =>
  Effect.map(
    Database.use((db) =>
      db
        .select({ slug: organization.slug })
        .from(organization)
        .where(eq(organization.id, organizationId)),
    ),
    ([row]) => row?.slug,
  );

it.layer(getTestDB())("a workspace's slug", (it) => {
  it.effect(
    "the slug a workspace leaves stays its own: it names the workspace to its members alone, is refused to another workspace, and is taken back by itself",
    () =>
      Effect.gen(function* () {
        const [ada, bob] = [yield* openAccount, yield* openAccount];
        const acme = yield* openWorkspace(ada);
        const beta = yield* openWorkspace(bob);
        const first = yield* slugOf(acme);
        assert.ok(first !== undefined);

        yield* setWorkspaceSlug(acme, "acme");
        yield* setWorkspaceSlug(acme, "acme-labs");
        const listed = yield* listWorkspaces(ada);
        const outsiders = yield* listWorkspaces(bob);
        const named = {
          byOld: yield* workspaceIdOfSlug(ada, "ACME"),
          byCurrent: yield* workspaceIdOfSlug(ada, "acme-labs"),
          toOutsider: yield* workspaceIdOfSlug(bob, "acme"),
        };
        const takeOld = yield* Effect.flip(setWorkspaceSlug(beta, "ACME"));
        const takeCurrent = yield* Effect.flip(setWorkspaceSlug(beta, "acme-labs"));
        yield* setWorkspaceSlug(acme, "acme");

        assert.deepEqual(
          listed.map(({ slug, formerSlugs }) => ({ slug, formerSlugs })),
          [{ slug: "acme-labs", formerSlugs: ["acme", first].toSorted() }],
        );
        assert.deepEqual(
          outsiders.map(({ formerSlugs }) => formerSlugs),
          [undefined],
        );
        assert.deepEqual(named, {
          byOld: Option.some(acme),
          byCurrent: Option.some(acme),
          toOutsider: Option.none(),
        });
        assert.ok(takeOld instanceof WorkspaceSlugTaken);
        assert.ok(takeCurrent instanceof WorkspaceSlugTaken);
        assert.equal(yield* slugOf(beta), `workspace-${beta}`);
        assert.equal(yield* slugOf(acme), "acme");
        assert.equal(yield* formerSlugHeld("Acme-Labs"), true);
        assert.equal(yield* formerSlugHeld("acme"), false);
      }),
  );
});
