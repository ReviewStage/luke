import { randomUUID } from "node:crypto";
import { Database } from "@sidecar/database/core/query";
import { createPlan, type NewPlan } from "@sidecar/database/models/plan-store";
import type { WorkspaceSeams } from "@sidecar/database/models/workspace-seams";
import { member, organization } from "@sidecar/database/schemas/auth";
import { and, eq } from "drizzle-orm";
import { Cause, DateTime, Effect } from "effect";

/**
 * workspaces.ts -- workspaces for a test, the plugin's write faked over them, and a plan started in one.
 *
 * Every plan belongs to a workspace, a Better Auth `organization` the
 * account is a `member` of. A test that is about something else starts its
 * plans through `startPlan`, which puts them in one workspace the account
 * owns, made the first time it is asked for. The rows are written straight
 * over the plugin's tables, as the plugin would leave them, since a test
 * stands no Better Auth, and `fakeWorkspaceSeams` is the plugin's
 * server-only create over the same tables; a test of the plugin's own write
 * is `workspace-store.test.ts`.
 */

/** A plan to start in the account's test workspace: what `createPlan` takes, without the workspace. */
export type TestPlan = Omit<NewPlan, "organizationId">;

export const WORKSPACE_ROLE = {
  OWNER: "owner",
  MEMBER: "member",
} as const;

type WorkspaceRole = (typeof WORKSPACE_ROLE)[keyof typeof WORKSPACE_ROLE];

/** What a test workspace is called; the column is not null and no test reads it. */
const TEST_WORKSPACE_NAME = "Test Workspace";

/** Adds the account to the workspace under the role, as the plugin's `addMember` would. */
export const joinWorkspace = (
  organizationId: string,
  userId: string,
  role: WorkspaceRole = WORKSPACE_ROLE.MEMBER,
) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const now = yield* DateTime.nowAsDate;
    yield* db
      .insert(member)
      .values({ id: randomUUID(), organizationId, userId, role, createdAt: now });
  });

/** A new workspace the account owns, answering its id. */
export const openWorkspace = (ownerId: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const id = randomUUID();
    const now = yield* DateTime.nowAsDate;
    yield* db
      .insert(organization)
      .values({ id, name: TEST_WORKSPACE_NAME, slug: `workspace-${id}`, createdAt: now });
    yield* joinWorkspace(id, ownerId, WORKSPACE_ROLE.OWNER);
    return id;
  });

/**
 * The plugin's server-only create, over the test's own database: the
 * organization, then its owner, refusing a slug that is taken as the plugin
 * does.
 */
export const fakeWorkspaceSeams = Effect.gen(function* () {
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
        yield* joinWorkspace(id, creation.userId, WORKSPACE_ROLE.OWNER);
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

/** The workspace the account owns that its test plans start in, made the first time it is asked for. */
const workspaceOf = (userId: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const [owned] = yield* db
      .select({ organizationId: member.organizationId })
      .from(member)
      .where(and(eq(member.userId, userId), eq(member.role, WORKSPACE_ROLE.OWNER)))
      .limit(1);
    if (owned !== undefined) return owned.organizationId;
    return yield* openWorkspace(userId);
  });

/** Starts a plan under the account in its test workspace. */
export const startPlan = (userId: string, started: TestPlan) =>
  Effect.flatMap(workspaceOf(userId), (organizationId) =>
    createPlan(userId, { ...started, organizationId }),
  );
