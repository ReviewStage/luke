import { db } from "@sidecar/database/core/query";
import { GITHUB_INSTALLATION_STATUS } from "@sidecar/database/github-installation-vocabulary";
import type { WorkspaceSeams } from "@sidecar/database/models/workspace-seams";
import {
  roleOf,
  type Workspace,
  type WorkspaceStoreEffect,
} from "@sidecar/database/models/workspace-store";
import { member, organization, user } from "@sidecar/database/schemas/auth";
import { githubInstallation } from "@sidecar/database/schemas/github-installation";
import { personalWorkspace } from "@sidecar/database/schemas/personal-workspace";
import type { WorkspaceMember, WorkspaceRole } from "@sidecar/hosted/workspace-wire";
import { WORKSPACE_ROLE } from "@sidecar/hosted/workspace-wire";
import { and, asc, eq } from "drizzle-orm";
import { type Cause, Effect, Option, Result, Schema } from "effect";
import type { SqlClient } from "effect/unstable/sql";
import { SqlSchema } from "effect/unstable/sql";
import type { StoreFailure } from "./store-failure.js";

/**
 * workspace-members.ts -- who is in a workspace, and the joins, removals, and leavings that change it.
 *
 * A member is the organization plugin's `member` row, read here through
 * Drizzle as `workspace-store.ts` reads it. A join is the plugin's own
 * server-only `addMember`, handed in as a seam the way a workspace's
 * creation is. A removal and a leaving are the plugin's `removeMember` and
 * `leaveOrganization` in kind, but both take a session cookie a desktop's
 * bearer never carries, so the row is deleted here instead: no
 * organization hook is configured that the plugin's own delete would have
 * run. Who may do which is the caller's to decide from `membershipOf`.
 */

/** The order roles are listed in: owners, then admins, then members. */
const ROLE_ORDER: readonly WorkspaceRole[] = [
  WORKSPACE_ROLE.OWNER,
  WORKSPACE_ROLE.ADMIN,
  WORKSPACE_ROLE.MEMBER,
];

const findMembership = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, organizationId: Schema.String }),
  Result: Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    role: Schema.String,
    personalOf: Schema.NullOr(Schema.String),
    status: Schema.NullOr(Schema.String),
  }),
  execute: ({ userId, organizationId }) =>
    db
      .select({
        id: organization.id,
        name: organization.name,
        role: member.role,
        personalOf: personalWorkspace.userId,
        status: githubInstallation.status,
      })
      .from(member)
      .innerJoin(organization, eq(organization.id, member.organizationId))
      .leftJoin(personalWorkspace, eq(personalWorkspace.organizationId, organization.id))
      .leftJoin(githubInstallation, eq(githubInstallation.organizationId, organization.id))
      .where(and(eq(member.userId, userId), eq(member.organizationId, organizationId)))
      .limit(1),
});

const findActiveInstallationWorkspace = SqlSchema.findOneOption({
  Request: Schema.Number,
  Result: Schema.Struct({ organizationId: Schema.String }),
  execute: (installationId) =>
    db
      .select({ organizationId: githubInstallation.organizationId })
      .from(githubInstallation)
      .where(
        and(
          eq(githubInstallation.installationId, installationId),
          eq(githubInstallation.status, GITHUB_INSTALLATION_STATUS.ACTIVE),
        ),
      ),
});

const findMembers = SqlSchema.findAll({
  Request: Schema.String,
  Result: Schema.Struct({
    userId: Schema.String,
    name: Schema.String,
    email: Schema.String,
    role: Schema.String,
  }),
  execute: (organizationId) =>
    db
      .select({ userId: user.id, name: user.name, email: user.email, role: member.role })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(eq(member.organizationId, organizationId))
      .orderBy(asc(user.name), asc(user.id)),
});

const deleteMemberRow = SqlSchema.void({
  Request: Schema.Struct({ userId: Schema.String, organizationId: Schema.String }),
  execute: ({ userId, organizationId }) =>
    db
      .delete(member)
      .where(and(eq(member.userId, userId), eq(member.organizationId, organizationId))),
});

/** The workspace as the account sees it as a member, with its role and whether it is a personal one; nothing where it is not a member. */
export function membershipOf(
  userId: string,
  organizationId: string,
): WorkspaceStoreEffect<Option.Option<Workspace>> {
  return Effect.map(
    findMembership({ userId, organizationId }),
    Option.map((row) => ({
      id: row.id,
      name: row.name,
      personal: row.personalOf !== null,
      role: roleOf(row.role),
      active: row.status === null || row.status === GITHUB_INSTALLATION_STATUS.ACTIVE,
    })),
  );
}

/** The workspace of an active installation, by GitHub's id for it; nothing for one suspended, removed, or never synced. */
export function installationWorkspaceOf(
  installationId: number,
): WorkspaceStoreEffect<Option.Option<string>> {
  return Effect.map(
    findActiveInstallationWorkspace(installationId),
    Option.map((row) => row.organizationId),
  );
}

/** A workspace's members, owners first, then admins, then members, each by name. */
export function listMembers(
  organizationId: string,
): WorkspaceStoreEffect<readonly WorkspaceMember[]> {
  return Effect.map(findMembers(organizationId), (rows) => {
    const members = rows.map((row) => ({ ...row, role: roleOf(row.role) }));
    return ROLE_ORDER.flatMap((role) => members.filter((one) => one.role === role));
  });
}

/**
 * The account made a member of the workspace through the plugin, and its
 * standing as it then is, a member's. Where the plugin refused because a
 * racing join made it a member first, the standing is read all the same; a
 * refusal that left it outside is answered as it was.
 */
export function addMember(
  userId: string,
  organizationId: string,
  seams: WorkspaceSeams,
): Effect.Effect<Option.Option<Workspace>, StoreFailure | Cause.UnknownError, SqlClient.SqlClient> {
  return Effect.gen(function* () {
    const added = yield* Effect.result(seams.addMember({ userId, organizationId }));
    const standing = yield* membershipOf(userId, organizationId);
    if (Option.isNone(standing) && Result.isFailure(added)) {
      return yield* Effect.fail(added.failure);
    }
    return standing;
  });
}

/** The account's member row in the workspace deleted; an account not in it deletes nothing. */
export function removeMember(userId: string, organizationId: string): WorkspaceStoreEffect<void> {
  return deleteMemberRow({ userId, organizationId });
}
