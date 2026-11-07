/**
 * sidebar.ts -- the account's sidebar's live read bound: its four statements, the tables they read, and the topic that wakes it.
 *
 * The account's sections, the tasks and the agents it keeps in them, and
 * its pinned repositories: the same rows and rule of who may read them as
 * `listTaskSections` and `listRepositoryPins` (`SIDEBAR_READ`). A section
 * reads while its account reaches its workspace, an entry while its task or
 * its agent, on no task, is one the account reaches in its section's own
 * workspace.
 *
 * It is woken by a write to any of them or to what admits the account to a
 * workspace or a repository, all of which name the account. Note that a
 * task or an agent written itself wakes no sidebar, because a description's
 * save rewrites its task every few seconds and every member keeping it
 * would read again for nothing: a task moved or deleted leaves its sections
 * by its entries' own delete, and the rare change that hides an entry
 * without one shows at the hold's end.
 */

import { queryBuilder } from "@repo/database/core/query";
import { agentEntryStands } from "@repo/database/models/task-section-store";
import { taskReachableBy, workspaceReachableBy } from "@repo/database/models/workspace-store";
import { agentTable } from "@repo/database/schemas/agent";
import { repositoryPin } from "@repo/database/schemas/repository-pin";
import { task } from "@repo/database/schemas/task";
import {
  agentSectionEntry,
  taskSection,
  taskSectionEntry,
} from "@repo/database/schemas/task-section";
import { TOPIC } from "@repo/database/sync/notification";
import {
  agentSectionEntrySync,
  agentSync,
  githubPersonalTokenSync,
  githubRepositoryReadSync,
  memberSync,
  repositoryPinSync,
  taskSectionEntrySync,
  taskSectionSync,
  taskSync,
} from "@repo/database/sync/tables";
import { SIDEBAR_READ } from "@repo/features/sidebar-live";
import { and, eq } from "drizzle-orm";
import { bindLiveRead, liveRowsStatement } from "../live-read-binding.js";

export const sidebarRead = bindLiveRead(SIDEBAR_READ, {
  reads: [
    taskSectionSync,
    taskSectionEntrySync,
    agentSectionEntrySync,
    repositoryPinSync,
    taskSync,
    agentSync,
    memberSync,
    githubPersonalTokenSync,
    githubRepositoryReadSync,
  ],
  topics: ({ userId }) => [[TOPIC.ACCOUNT, userId]],
  statements: ({ userId }) => ({
    sections: liveRowsStatement(
      SIDEBAR_READ.parts.sections,
      {
        ordered: false,
        columns: {
          id: taskSection.id,
          workspaceId: taskSection.organizationId,
          title: taskSection.title,
          icon: taskSection.icon,
          position: taskSection.position,
        },
        instants: { createdAt: taskSection.createdAt },
      },
      (selection) =>
        queryBuilder
          .select(selection)
          .from(taskSection)
          .where(
            and(
              eq(taskSection.userId, userId),
              workspaceReachableBy(userId, taskSection.organizationId),
            ),
          ),
    ),
    entries: liveRowsStatement(
      SIDEBAR_READ.parts.entries,
      {
        ordered: false,
        columns: {
          taskId: taskSectionEntry.taskId,
          sectionId: taskSectionEntry.sectionId,
          position: taskSectionEntry.position,
        },
        instants: { addedAt: taskSectionEntry.addedAt },
      },
      (selection) =>
        queryBuilder
          .select(selection)
          .from(taskSectionEntry)
          .innerJoin(taskSection, eq(taskSection.id, taskSectionEntry.sectionId))
          .innerJoin(task, eq(task.id, taskSectionEntry.taskId))
          .where(
            and(
              eq(taskSectionEntry.userId, userId),
              eq(task.organizationId, taskSection.organizationId),
              taskReachableBy(userId),
            ),
          ),
    ),
    agentEntries: liveRowsStatement(
      SIDEBAR_READ.parts.agentEntries,
      {
        ordered: false,
        columns: {
          agentId: agentSectionEntry.agentId,
          sectionId: agentSectionEntry.sectionId,
          position: agentSectionEntry.position,
        },
        instants: { addedAt: agentSectionEntry.addedAt },
      },
      (selection) =>
        queryBuilder
          .select(selection)
          .from(agentSectionEntry)
          .innerJoin(taskSection, eq(taskSection.id, agentSectionEntry.sectionId))
          .innerJoin(agentTable, eq(agentTable.id, agentSectionEntry.agentId))
          .where(agentEntryStands(userId)),
    ),
    pins: liveRowsStatement(
      SIDEBAR_READ.parts.pins,
      {
        ordered: false,
        columns: { repository: repositoryPin.repository },
        instants: { pinnedAt: repositoryPin.pinnedAt },
      },
      (selection) =>
        queryBuilder.select(selection).from(repositoryPin).where(eq(repositoryPin.userId, userId)),
    ),
  }),
});
