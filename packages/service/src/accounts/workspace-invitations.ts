import {
  type LiveStatement,
  liveSelection,
  liveStatementOf,
} from "@repo/database/core/live-statement";
import { queryBuilder } from "@repo/database/core/query";
import { invitation, member } from "@repo/database/schemas/auth";
import { WORKSPACE_ROLE } from "@repo/features/workspace-wire";
import { and, eq, exists, sql } from "drizzle-orm";
import type { Option } from "effect";

const INVITATION_PENDING = "pending";

const MANAGING_ROLE_TEXT = `(^|,)\\s*(${WORKSPACE_ROLE.OWNER}|${WORKSPACE_ROLE.ADMIN})\\s*(,|$)`;

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
