/**
 * workspace-memories.ts -- a workspace's memories' live read bound: its one statement, the tables it reads, the topics that wake it, and who it admits.
 *
 * Every memory of the workspace, while the reader is a member of it, each
 * with the name of the member whose words it holds, null once that account
 * is gone, and whether the reader may forget it: its words are theirs, or
 * they own or administer the workspace, as `forgetMemory`'s caller settles
 * it (`WORKSPACE_MEMORIES_READ`). A workspace the reader is no member of is
 * answered as not found.
 *
 * It is woken on the workspace's memory topic by a memory kept, corrected,
 * or forgotten, and on the reader's own by their membership made, ended, or
 * given another role, which decides what they read and may forget. Note
 * that a teammate's rename wakes neither, since a member's row names only
 * their own topic and their workspaces': a keeper's new name shows at the
 * hold's end.
 */

import { queryBuilder } from "@repo/database/core/query";
import { roleAmong, workspaceReachableBy } from "@repo/database/models/workspace-store";
import { member, user } from "@repo/database/schemas/auth";
import { memory } from "@repo/database/schemas/memory";
import { TOPIC } from "@repo/database/sync/notification";
import { memberSync, memorySync, userSync } from "@repo/database/sync/tables";
import { WORKSPACE_MEMORIES_READ } from "@repo/features/memory-live";
import { WORKSPACE_ROLE } from "@repo/features/workspace-wire";
import { and, eq, exists, or, sql } from "drizzle-orm";
import { bindLiveRead, liveRowsStatement } from "../live-read-binding.js";
import { admitWorkspaceMember } from "./workspace-member.js";

/** Whether the reader may forget a memory: its words are theirs, or they own or administer the workspace. */
function forgettableBy(readerId: string, workspaceId: string) {
  const manages = exists(
    queryBuilder
      .select({ one: member.id })
      .from(member)
      .where(
        and(
          eq(member.organizationId, workspaceId),
          eq(member.userId, readerId),
          roleAmong([WORKSPACE_ROLE.OWNER, WORKSPACE_ROLE.ADMIN]),
        ),
      ),
  );
  // Note that a memory whose account is gone compares as unknown, so it reads forgettable only by those who manage it, as `forgetMemory` allows.
  return sql<boolean>`coalesce(${or(eq(memory.userId, readerId), manages)}, false)`;
}

export const workspaceMemoriesRead = bindLiveRead(WORKSPACE_MEMORIES_READ, {
  reads: [memorySync, memberSync, userSync],
  topics: ({ userId, workspaceId }) => [
    [TOPIC.MEMORY, workspaceId],
    [TOPIC.ACCOUNT, userId],
  ],
  statements: ({ userId, workspaceId }) => ({
    memories: liveRowsStatement(
      WORKSPACE_MEMORIES_READ.parts.memories,
      {
        ordered: false,
        columns: {
          id: memory.id,
          text: memory.text,
          keeperId: memory.userId,
          // Note that the keeper is left-joined, so their name is null once their account is gone, which the column alone does not say.
          keeperName: sql<string | null>`${user.name}`,
          forgettable: forgettableBy(userId, workspaceId),
        },
        instants: { createdAt: memory.createdAt, updatedAt: memory.updatedAt },
      },
      (selection) =>
        queryBuilder
          .select(selection)
          .from(memory)
          .leftJoin(user, eq(user.id, memory.userId))
          .where(
            and(eq(memory.organizationId, workspaceId), workspaceReachableBy(userId, workspaceId)),
          ),
    ),
  }),
  admit: admitWorkspaceMember,
});
