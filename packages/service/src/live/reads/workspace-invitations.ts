/**
 * workspace-invitations.ts -- a workspace's pending invitations' live read bound, for an owner or an admin of it: its one statement, the tables it reads, the topic that wakes it, who it admits, and the origin beside it.
 *
 * The held read lists them through the organization plugin under the Mac's
 * session; a live read cannot, so it reads the plugin's own `invitation`
 * rows, the ones still pending, as the plugin keeps them, and none at all
 * once the reader no longer owns or administers the workspace, so a
 * subscription stays bound to the rule its endpoint checked
 * (`WORKSPACE_INVITATIONS_READ`). Note that the statement keeps no window
 * measured from the clock, as Realtime requires: an invitation past its
 * expiry is the desktop's to leave out, by its own clock, as the held read
 * leaves it out by the service's.
 *
 * A workspace the reader is not in is answered as not found, and one it
 * neither owns nor administers as not permitted. It is woken on the
 * workspace's topic by an invitation or a membership.
 */

import { queryBuilder } from "@repo/database/core/query";
import { workspaceOf } from "@repo/database/models/workspace-store";
import { invitation, member } from "@repo/database/schemas/auth";
import { TOPIC } from "@repo/database/sync/notification";
import { invitationSync, memberSync } from "@repo/database/sync/tables";
import { WORKSPACE_INVITATIONS_READ } from "@repo/features/workspace-live";
import { WORKSPACE_ROLE } from "@repo/features/workspace-wire";
import { and, eq, exists, sql } from "drizzle-orm";
import { Effect, Option } from "effect";
import { HOSTED_REFUSAL, hostedStoreOrUnavailable } from "../../http/http-effect.js";
import { bindLiveRead, liveRowsStatement } from "../live-read-binding.js";

/** The plugin's word for an invitation not yet accepted, rejected, or canceled. */
const INVITATION_PENDING = "pending";

/** The plugin's role text naming an owner or an admin, which may list several roles comma-separated. */
const MANAGING_ROLE_TEXT = `(^|,)\\s*(${WORKSPACE_ROLE.OWNER}|${WORKSPACE_ROLE.ADMIN})\\s*(,|$)`;

/** The roles that read and manage a workspace's invitations, as its endpoint admits them. */
const MANAGING_ROLES: ReadonlySet<string> = new Set([WORKSPACE_ROLE.OWNER, WORKSPACE_ROLE.ADMIN]);

/** Whether the reader owns or administers the workspace, as the statement checks it on every look. */
function managedBy(readerId: string, workspaceId: string) {
  return exists(
    queryBuilder
      .select({ one: member.id })
      .from(member)
      .where(
        and(
          eq(member.userId, readerId),
          eq(member.organizationId, workspaceId),
          sql`${member.role} ~ ${MANAGING_ROLE_TEXT}`,
        ),
      ),
  );
}

export const workspaceInvitationsRead = bindLiveRead(WORKSPACE_INVITATIONS_READ, {
  reads: [invitationSync, memberSync],
  topics: ({ workspaceId }) => [[TOPIC.WORKSPACE, workspaceId]],
  statements: ({ userId, workspaceId }) => ({
    invitations: liveRowsStatement(
      WORKSPACE_INVITATIONS_READ.parts.invitations,
      {
        ordered: false,
        columns: { id: invitation.id, email: invitation.email, role: invitation.role },
        instants: { expiresAt: invitation.expiresAt },
      },
      (selection) =>
        queryBuilder
          .select(selection)
          .from(invitation)
          .where(
            and(
              eq(invitation.organizationId, workspaceId),
              eq(invitation.status, INVITATION_PENDING),
              managedBy(userId, workspaceId),
            ),
          ),
    ),
  }),
  admit: ({ userId, workspaceId }) =>
    Effect.gen(function* () {
      const workspace = yield* hostedStoreOrUnavailable(workspaceOf(userId, workspaceId));
      if (Option.isNone(workspace)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
      if (!MANAGING_ROLES.has(workspace.value.role)) {
        return yield* Effect.fail(HOSTED_REFUSAL.NOT_PERMITTED);
      }
    }),
  beside: ({ request }) => Effect.succeed({ origin: new URL(request.url).origin }),
});
