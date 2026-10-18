import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { member, organization, user } from "@luke/database/schemas/auth";
import { getTestDB } from "@luke/database/testing";
import { eq } from "drizzle-orm";
import { Effect, Exit } from "effect";
import { PREVIEW_DATABASE_ENVIRONMENT, preparePreviewDatabase } from "./preview-database.js";

/**
 * Whether a deployment's build cuts its Preview database down to the team,
 * over a real dialect: only a Preview's build with both variables set, never
 * one whose connection reaches production's endpoint, and never by naming a
 * connection string when it refuses. What the run itself keeps and removes
 * is `preview-fork.test.ts`'s.
 *
 * Synthetic accounts, workspaces, and connection strings throughout.
 */

const PRODUCTION_ENDPOINT = "ep-production-123456";
const BRANCH_ENDPOINT = "ep-preview-654321";
const PASSWORD = "npg_not-a-real-password";

/** A Neon connection string to the endpoint, pooled or direct. */
function connection(endpoint: string, pooled: boolean): string {
  const host = `${endpoint}${pooled ? "-pooler" : ""}.us-east-1.aws.neon.tech`;
  return `postgresql://neondb_owner:${PASSWORD}@${host}/neondb?sslmode=require`;
}

/** A Preview build's variables on its own branch's database, keeping the team's workspace by its slug. */
function previewBuild(teamSlug: string) {
  return {
    [PREVIEW_DATABASE_ENVIRONMENT.ENVIRONMENT]: "preview",
    [PREVIEW_DATABASE_ENVIRONMENT.WORKSPACES]: ` ${teamSlug} ,  `,
    [PREVIEW_DATABASE_ENVIRONMENT.PRODUCTION_ENDPOINT]: PRODUCTION_ENDPOINT,
    [PREVIEW_DATABASE_ENVIRONMENT.DATABASE_URL]: connection(BRANCH_ENDPOINT, true),
    [PREVIEW_DATABASE_ENVIRONMENT.DATABASE_URL_UNPOOLED]: connection(BRANCH_ENDPOINT, false),
  };
}

/** A team workspace with one member, and a customer's account with a workspace of its own; answers the team's slug and the customer's id. */
const openTeamAndCustomer = Effect.gen(function* () {
  const db = yield* Database;
  const at = new Date();
  const [teamOwner, customer] = [`user-${randomUUID()}`, `user-${randomUUID()}`];
  const teamSlug = `team-${randomUUID()}`;
  for (const id of [teamOwner, customer]) {
    yield* db.insert(user).values({ id, name: "Test User", email: `${id}@luke.test` });
  }
  for (const [slug, owner] of [
    [teamSlug, teamOwner],
    [`workspace-${randomUUID()}`, customer],
  ] as const) {
    const id = randomUUID();
    yield* db.insert(organization).values({ id, name: "Test Workspace", slug, createdAt: at });
    yield* db.insert(member).values({
      id: randomUUID(),
      organizationId: id,
      userId: owner,
      role: "owner",
      createdAt: at,
    });
  }
  return { teamSlug, customer };
});

/** Whether the account still stands. */
const stands = (userId: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const rows = yield* db.select({ id: user.id }).from(user).where(eq(user.id, userId));
    return rows.length > 0;
  });

it.layer(getTestDB())("a build that must leave its database as it stands", (it) => {
  it.effect(
    "leaves it for any build but a Preview's, and for a Preview's without both variables",
    () =>
      Effect.gen(function* () {
        const { teamSlug, customer } = yield* openTeamAndCustomer;
        const preview = previewBuild(teamSlug);
        for (const variables of [
          { ...preview, [PREVIEW_DATABASE_ENVIRONMENT.ENVIRONMENT]: "production" },
          { ...preview, [PREVIEW_DATABASE_ENVIRONMENT.ENVIRONMENT]: undefined },
          { ...preview, [PREVIEW_DATABASE_ENVIRONMENT.WORKSPACES]: " , " },
          { ...preview, [PREVIEW_DATABASE_ENVIRONMENT.PRODUCTION_ENDPOINT]: "" },
        ]) {
          yield* preparePreviewDatabase(variables);
          assert.ok(yield* stands(customer));
        }
      }),
  );

  it.effect(
    "refuses a Preview's build whose connection reaches production's endpoint, without naming the connection",
    () =>
      Effect.gen(function* () {
        const { teamSlug, customer } = yield* openTeamAndCustomer;
        const preview = previewBuild(teamSlug);
        for (const variables of [
          {
            ...preview,
            [PREVIEW_DATABASE_ENVIRONMENT.DATABASE_URL]: connection(PRODUCTION_ENDPOINT, true),
          },
          {
            ...preview,
            [PREVIEW_DATABASE_ENVIRONMENT.DATABASE_URL_UNPOOLED]: connection(
              PRODUCTION_ENDPOINT,
              false,
            ),
          },
          {
            ...preview,
            [PREVIEW_DATABASE_ENVIRONMENT.DATABASE_URL]: connection(PRODUCTION_ENDPOINT, true),
            [PREVIEW_DATABASE_ENVIRONMENT.PRODUCTION_ENDPOINT]: `${PRODUCTION_ENDPOINT}.us-east-1.aws.neon.tech`,
          },
          { ...preview, [PREVIEW_DATABASE_ENVIRONMENT.DATABASE_URL]: undefined },
        ]) {
          const exit = yield* Effect.exit(preparePreviewDatabase(variables));
          assert.ok(Exit.isFailure(exit));
          assert.ok(!JSON.stringify(exit).includes(PASSWORD), "a refusal names no connection");
          assert.ok(yield* stands(customer));
        }
      }),
  );

  it.effect("refuses a Preview's build whose database holds no workspace the slugs name", () =>
    Effect.gen(function* () {
      const { teamSlug, customer } = yield* openTeamAndCustomer;
      const exit = yield* Effect.exit(
        preparePreviewDatabase({
          ...previewBuild(teamSlug),
          [PREVIEW_DATABASE_ENVIRONMENT.WORKSPACES]: "missing",
        }),
      );
      assert.ok(Exit.isFailure(exit));
      assert.ok(yield* stands(customer));
    }),
  );
});

it.layer(getTestDB())("a Preview's build on its own branch", (it) => {
  it.effect("cuts the copy down to the workspaces named", () =>
    Effect.gen(function* () {
      const { teamSlug, customer } = yield* openTeamAndCustomer;
      yield* preparePreviewDatabase(previewBuild(teamSlug));
      assert.equal(yield* stands(customer), false);
    }),
  );
});
