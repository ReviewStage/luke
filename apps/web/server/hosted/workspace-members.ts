import { db } from "@sidecar/database/core/query";
import { roleOf, type WorkspaceStoreEffect } from "@sidecar/database/models/workspace-store";
import { member, user } from "@sidecar/database/schemas/auth";
import type { WorkspaceMember, WorkspaceRole } from "@sidecar/hosted/workspace-wire";
import { WORKSPACE_ROLE } from "@sidecar/hosted/workspace-wire";
import { and, asc, eq } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { SqlSchema } from "effect/unstable/sql";

/**
 * workspace-members.ts -- who is in a workspace, and the removals and leavings that change it.
 *
 * A member is the organization plugin's `member` row, read here through
 * Drizzle as `workspace-store.ts` reads it, since the plugin's own
 * `listMembers` takes a session cookie a desktop's bearer never carries. A
 * removal and a leaving are the plugin's `removeMember` and
 * `leaveOrganization` in kind, but both take the same cookie, so the row is
 * deleted here instead: no organization hook is configured that the
 * plugin's own delete would have run. Who may do which is the caller's to
 * decide.
 */

/** The order roles are listed in: owners, then admins, then members. */
const ROLE_ORDER: readonly WorkspaceRole[] = [
  WORKSPACE_ROLE.OWNER,
  WORKSPACE_ROLE.ADMIN,
  WORKSPACE_ROLE.MEMBER,
];

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

/** A workspace's members, owners first, then admins, then members, each by name. */
export function listMembers(
  organizationId: string,
): WorkspaceStoreEffect<readonly WorkspaceMember[]> {
  return Effect.map(findMembers(organizationId), (rows) => {
    const members = rows.map((row) => ({ ...row, role: roleOf(row.role) }));
    return ROLE_ORDER.flatMap((role) => members.filter((one) => one.role === role));
  });
}

/** The account's member row in the workspace deleted; an account not in it deletes nothing. */
export function removeMember(userId: string, organizationId: string): WorkspaceStoreEffect<void> {
  return deleteMemberRow({ userId, organizationId });
}
