/**
 * workspace-members.ts -- a workspace's people's live read bound: its two statements, the tables they read, the topic that wakes it, and who it admits.
 *
 * The same rows and columns as `listMembers` and `listFormerMembers`, read
 * for the reader, and none at all once the reader is no longer a member, so
 * a subscription stays bound to the rule its endpoint checked
 * (`WORKSPACE_MEMBERS_READ`). A workspace the reader is no member of is
 * answered as not found.
 *
 * It is woken on the workspace's topic by a membership, a member's account,
 * and the work that names a former member. Note that a description
 * revision wakes nothing here, since it only decides who counts as a former
 * member and the change that moves that, its task deleted, wakes the
 * workspace through the task; nor does a former member renaming themselves,
 * who is in no membership the account's write looks up: both show at the
 * hold's end.
 */

import { queryBuilder } from "@repo/database/core/query";
import { workspaceReachableBy } from "@repo/database/models/workspace-store";
import { member, user } from "@repo/database/schemas/auth";
import { TOPIC } from "@repo/database/sync/notification";
import {
  agentSync,
  automationSync,
  descriptionRevisionSync,
  inboxItemSync,
  memberSync,
  taskSync,
  userSync,
} from "@repo/database/sync/tables";
import { WORKSPACE_MEMBERS_READ } from "@repo/features/workspace-live";
import { and, eq } from "drizzle-orm";
import { formerOf } from "../../accounts/workspace-members.js";
import { bindLiveRead, liveRowsStatement } from "../live-read-binding.js";
import { admitWorkspaceMember } from "./workspace-member.js";

export const workspaceMembersRead = bindLiveRead(WORKSPACE_MEMBERS_READ, {
  reads: [
    memberSync,
    userSync,
    taskSync,
    agentSync,
    automationSync,
    descriptionRevisionSync,
    inboxItemSync,
  ],
  topics: ({ workspaceId }) => [[TOPIC.WORKSPACE, workspaceId]],
  statements: ({ userId, workspaceId }) => {
    const reached = workspaceReachableBy(userId, workspaceId);
    return {
      members: liveRowsStatement(
        WORKSPACE_MEMBERS_READ.parts.members,
        {
          ordered: false,
          columns: {
            userId: user.id,
            name: user.name,
            email: user.email,
            role: member.role,
            image: user.image,
          },
        },
        (selection) =>
          queryBuilder
            .select(selection)
            .from(member)
            .innerJoin(user, eq(user.id, member.userId))
            .where(and(eq(member.organizationId, workspaceId), reached)),
      ),
      former: liveRowsStatement(
        WORKSPACE_MEMBERS_READ.parts.former,
        { ordered: false, columns: { userId: user.id, name: user.name, image: user.image } },
        (selection) =>
          queryBuilder
            .select(selection)
            .from(user)
            .where(and(formerOf(workspaceId), reached)),
      ),
    };
  },
  admit: admitWorkspaceMember,
});
