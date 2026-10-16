import { Database } from "@luke/database/core/query";
import { roleOf, type WorkspaceStoreEffect } from "@luke/database/models/workspace-store";
import { member, user } from "@luke/database/schemas/auth";
import { automation } from "@luke/database/schemas/automation";
import { codingAgent } from "@luke/database/schemas/coding-agent";
import { inboxItem } from "@luke/database/schemas/inbox";
import { plan } from "@luke/database/schemas/plan";
import { planRevision } from "@luke/database/schemas/plan-revision";
import { pinnedPictureUrl } from "@luke/features/account-picture";
import { AUTOMATION_SCOPE } from "@luke/features/automation-wire";
import type { FormerMember, WorkspaceMember, WorkspaceRole } from "@luke/features/workspace-wire";
import { WORKSPACE_ROLE } from "@luke/features/workspace-wire";
import { and, asc, eq, inArray, isNotNull, notInArray, or } from "drizzle-orm";
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
 *
 * The plugin keeps no row for a membership that ended, so who left is read
 * off the workspace's own work: an account that created one of its tasks,
 * started one of its agents, saved a version of one of its tasks, or
 * answered one of its Inbox items, and is no longer a member. Each is named
 * by the name and picture their account holds now, which the window draws
 * grayed wherever their work names them; nobody the workspace's work does
 * not name is ever listed, and an account that is gone is not named at all.
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

const findFormer = SqlSchema.findAll({
  Request: Schema.String,
  Result: Schema.Struct({
    userId: Schema.String,
    name: Schema.String,
    image: Schema.NullOr(Schema.String),
  }),
  execute: (organizationId) =>
    Database.use((db) => {
      const tasks = db
        .select({ id: plan.id })
        .from(plan)
        .where(eq(plan.organizationId, organizationId));
      return db
        .select({ userId: user.id, name: user.name, image: user.image })
        .from(user)
        .where(
          and(
            or(
              inArray(
                user.id,
                db
                  .select({ id: plan.userId })
                  .from(plan)
                  .where(eq(plan.organizationId, organizationId)),
              ),
              inArray(
                user.id,
                db
                  .select({ id: codingAgent.userId })
                  .from(codingAgent)
                  .where(eq(codingAgent.organizationId, organizationId)),
              ),
              // Note that only the workspace's own automations count, since a personal one is read by its maker alone.
              inArray(
                user.id,
                db
                  .select({ id: automation.userId })
                  .from(automation)
                  .where(
                    and(
                      eq(automation.organizationId, organizationId),
                      eq(automation.scope, AUTOMATION_SCOPE.WORKSPACE),
                    ),
                  ),
              ),
              inArray(
                user.id,
                db
                  .select({ id: planRevision.userId })
                  .from(planRevision)
                  .where(and(inArray(planRevision.planId, tasks), isNotNull(planRevision.userId))),
              ),
              inArray(
                user.id,
                db
                  .select({ id: inboxItem.answeredBy })
                  .from(inboxItem)
                  // Note that an item is the workspace's by its own column, since an agent with no task holds items too.
                  .where(
                    and(
                      eq(inboxItem.organizationId, organizationId),
                      isNotNull(inboxItem.answeredBy),
                    ),
                  ),
              ),
            ),
            notInArray(
              user.id,
              db
                .select({ id: member.userId })
                .from(member)
                .where(eq(member.organizationId, organizationId)),
            ),
          ),
        )
        .orderBy(asc(user.name), asc(user.id));
    }),
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

/** Who the workspace's work still names but who is no longer a member of it, by name, with their picture where the window may draw it. */
export function listFormerMembers(
  organizationId: string,
): WorkspaceStoreEffect<readonly FormerMember[]> {
  return Effect.map(findFormer(organizationId), (rows) =>
    rows.map(({ image, ...row }): FormerMember => {
      const pictureUrl = pinnedPictureUrl(image);
      return pictureUrl === undefined ? row : { ...row, pictureUrl };
    }),
  );
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
