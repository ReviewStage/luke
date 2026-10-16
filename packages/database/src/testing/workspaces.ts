import { randomUUID } from "node:crypto";
import { WORKSPACE_ROLE, type WorkspaceRole } from "@luke/features/workspace-wire";
import { and, eq } from "drizzle-orm";
import { Cause, DateTime, Effect } from "effect";
import { Database } from "../core/query.js";
import {
  GITHUB_ACCOUNT_TYPE,
  GITHUB_INSTALLATION_STATUS,
} from "../github-installation-vocabulary.js";
import { createTask, type NewTask } from "../models/task-store.js";
import type { WorkspaceSeams } from "../models/workspace-seams.js";
import { member, organization } from "../schemas/auth.js";
import { githubInstallation } from "../schemas/github-installation.js";

/**
 * workspaces.ts -- workspaces for a test, the plugin's write faked over them, and a plan started in one.
 *
 * Every plan belongs to a workspace, a Better Auth `organization` the
 * account is a `member` of. A test that is about something else starts its
 * plans through `startTask`, which puts them in one workspace the account
 * owns, made the first time it is asked for. The rows are written straight
 * over the plugin's tables, as the plugin would leave them, since a test
 * stands no Better Auth, and `fakeWorkspaceSeams` is the plugin's
 * server-only create over the same tables; a test of the plugin's own write
 * is `workspace-store.test.ts`.
 */

/** A plan to start in the account's test workspace: what `createTask` takes, without the workspace. */
export type TestTask = Omit<NewTask, "organizationId">;

export { WORKSPACE_ROLE };

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

/** Takes the account out of the workspace, as the plugin's `removeMember` would. */
export const leaveWorkspace = (organizationId: string, userId: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    yield* db
      .delete(member)
      .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)));
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

/** The installation a test workspace stands for: GitHub's ids for it and its account, and the account's login. */
export interface TestInstallation {
  readonly installationId: number;
  readonly accountId: number;
  readonly accountLogin: string;
}

/** A new workspace the account owns with the installation connected to it, active; answers its id. */
export const openInstallationWorkspace = (ownerId: string, installation: TestInstallation) =>
  Effect.gen(function* () {
    const id = yield* openWorkspace(ownerId);
    const now = yield* DateTime.nowAsDate;
    yield* Database.use((db) =>
      db.insert(githubInstallation).values({
        organizationId: id,
        ...installation,
        accountType: GITHUB_ACCOUNT_TYPE.ORGANIZATION,
        status: GITHUB_INSTALLATION_STATUS.ACTIVE,
        createdAt: now,
        updatedAt: now,
      }),
    );
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
export const startTask = (userId: string, started: TestTask) =>
  Effect.flatMap(workspaceOf(userId), (organizationId) =>
    createTask(userId, { ...started, organizationId }),
  );
