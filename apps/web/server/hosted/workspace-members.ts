import { db } from "@sidecar/database/core/query";
import { GITHUB_INSTALLATION_STATUS } from "@sidecar/database/github-installation-vocabulary";
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
import { Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/unstable/sql";

/**
 * workspace-members.ts -- who is in a workspace, and the account's own standing in it.
 *
 * A member is the organization plugin's `member` row, read here through
 * Drizzle as `workspace-store.ts` reads it, since the plugin's own
 * `listMembers` takes a session cookie a desktop's bearer never carries.
 * Who may read the members is the caller's to decide from `membershipOf`.
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

/** A workspace's members, owners first, then admins, then members, each by name. */
export function listMembers(
  organizationId: string,
): WorkspaceStoreEffect<readonly WorkspaceMember[]> {
  return Effect.map(findMembers(organizationId), (rows) => {
    const members = rows.map((row) => ({ ...row, role: roleOf(row.role) }));
    return ROLE_ORDER.flatMap((role) => members.filter((one) => one.role === role));
  });
}
