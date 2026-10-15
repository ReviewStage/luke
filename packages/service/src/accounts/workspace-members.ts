import { Database } from "@luke/database/core/query";
import { roleOf, type WorkspaceStoreEffect } from "@luke/database/models/workspace-store";
import { member, user } from "@luke/database/schemas/auth";
import { pinnedPictureUrl } from "@luke/features/account-picture";
import type { WorkspaceMember, WorkspaceRole } from "@luke/features/workspace-wire";
import { WORKSPACE_ROLE } from "@luke/features/workspace-wire";
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
 * A member's sign-in picture is listed only where it is an address the
 * renderer may draw (`pinnedPictureUrl`), so the window shows a teammate's
 * face as it shows the account's own, and a picture anywhere else is left out
 * rather than handed to a renderer whose image policy would refuse it.
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
    image: Schema.NullOr(Schema.String),
  }),
  execute: (organizationId) =>
    Database.use((db) =>
      db
        .select({
          userId: user.id,
          name: user.name,
          email: user.email,
          role: member.role,
          image: user.image,
        })
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
    const members = rows.map(({ image, ...row }): WorkspaceMember => {
      const listed = { ...row, role: roleOf(row.role) };
      const pictureUrl = pinnedPictureUrl(image);
      return pictureUrl === undefined ? listed : { ...listed, pictureUrl };
    });
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
