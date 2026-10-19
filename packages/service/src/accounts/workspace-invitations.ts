import {
  type LiveStatement,
  liveSelection,
  liveStatementOf,
} from "@luke/database/core/live-statement";
import { queryBuilder } from "@luke/database/core/query";
import { invitation, member } from "@luke/database/schemas/auth";
import { WORKSPACE_ROLE } from "@luke/features/workspace-wire";
import { and, eq, exists, sql } from "drizzle-orm";
import type { Option } from "effect";

/**
 * workspace-invitations.ts -- a workspace's pending invitations written for Neon Realtime, for an owner or an admin of it.
 *
 * The held read lists them through the organization plugin under the Mac's
 * session; a live read cannot, so it reads the plugin's own `invitation`
 * rows, the ones still pending, as the plugin keeps them. Note that the
 * statement keeps no window measured from the clock, as Realtime requires:
 * an invitation past its expiry is the desktop's to leave out, by its own
 * clock, as the held read leaves it out by the service's.
 */

/** The plugin's word for an invitation not yet accepted, rejected, or canceled. */
const INVITATION_PENDING = "pending";

/** The plugin's role text naming an owner or an admin, which may list several roles comma-separated. */
const MANAGING_ROLE_TEXT = `(^|,)\\s*(${WORKSPACE_ROLE.OWNER}|${WORKSPACE_ROLE.ADMIN})\\s*(,|$)`;

/**
 * A workspace's pending invitations, read for `readerId`, and none at all
 * once the reader no longer owns or administers it, so a subscription stays
 * bound to the rule its endpoint checked. Each column under the key
 * `live-wire.ts` reads it by. None where a value cannot be carried.
 */
export function workspaceInvitationsLiveStatement(
  readerId: string,
  organizationId: string,
): Option.Option<LiveStatement> {
  const manages = exists(
    queryBuilder
      .select({ one: member.id })
      .from(member)
      .where(
        and(
          eq(member.userId, readerId),
          eq(member.organizationId, organizationId),
          sql`${member.role} ~ ${MANAGING_ROLE_TEXT}`,
        ),
      ),
  );
  return liveStatementOf(
    queryBuilder
      .select(
        liveSelection(
          { id: invitation.id, email: invitation.email, role: invitation.role },
          { expiresAt: invitation.expiresAt },
        ),
      )
      .from(invitation)
      .where(
        and(
          eq(invitation.organizationId, organizationId),
          eq(invitation.status, INVITATION_PENDING),
          manages,
        ),
      ),
  );
}
