import { randomUUID } from "node:crypto";
import { WORKSPACE_ROLE, type WorkspaceRole } from "@repo/features/workspace-wire";
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

export type TestTask = Omit<NewTask, "organizationId">;

export { WORKSPACE_ROLE };

const TEST_WORKSPACE_NAME = "Test Workspace";

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

export const leaveWorkspace = (organizationId: string, userId: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    yield* db
      .delete(member)
      .where(and(eq(member.organizationId, organizationId), eq(member.userId, userId)));
  });

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

export interface TestInstallation {
  readonly installationId: number;
  readonly accountId: number;
  readonly accountLogin: string;
}

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

export const unreachedWorkspaceSeams: WorkspaceSeams = {
  createOrganization: () =>
    Effect.fail(new Cause.UnknownError(undefined, "No workspace is made in this test")),
};

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

export const startTask = (userId: string, started: TestTask) =>
  Effect.flatMap(workspaceOf(userId), (organizationId) =>
    createTask(userId, { ...started, organizationId }),
  );
