import { Database } from "@sidecar/database/core/query";
import { roleOf, type WorkspaceStoreEffect } from "@sidecar/database/models/workspace-store";
import { member, user } from "@sidecar/database/schemas/auth";
import type { WorkspaceMember, WorkspaceRole } from "@sidecar/features/workspace-wire";
import { WORKSPACE_ROLE } from "@sidecar/features/workspace-wire";
import { and, asc, eq } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";

/**
 * workspace-members.ts -- who is in a workspace, read off the organization plugin's own rows.
 *
 * A member is the plugin's `member` row, read here through Drizzle as
 * `workspace-store.ts` reads it, since the list is read under the Mac's
 * OAuth token, which no plugin call takes. Removing a member and leaving
 * are the plugin's own calls under the Mac's session (`workspace-seams.ts`);
 * the one thing read here for them is the member id the plugin removes by.
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
    Database.use((db) =>
      db
        .select({ userId: user.id, name: user.name, email: user.email, role: member.role })
        .from(member)
        .innerJoin(user, eq(user.id, member.userId))
        .where(eq(member.organizationId, organizationId))
        .orderBy(asc(user.name), asc(user.id)),
    ),
});

const findMemberId = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, organizationId: Schema.String }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, organizationId }) =>
    Database.use((db) =>
      db
        .select({ id: member.id })
        .from(member)
        .where(and(eq(member.userId, userId), eq(member.organizationId, organizationId)))
        .limit(1),
    ),
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

/** The plugin's member id for the account in the workspace, or none where it is not a member. */
export function memberIdOf(
  userId: string,
  organizationId: string,
): WorkspaceStoreEffect<Option.Option<string>> {
  return Effect.map(
    findMemberId({ userId, organizationId }),
    Option.map((row) => row.id),
  );
}
