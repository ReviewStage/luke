/**
 * pages.ts -- one task's pages, and one coding agent's on no task, bound: their one statement each, the tables they read, the topics that wake them, and who they admit.
 *
 * Each statement reads what `listPages` reads, under the same account and
 * rule of who may read it, the task's or the agent's, the instant in epoch
 * milliseconds, so a task or an agent the account does not reach is no
 * rows. It reads no clock, as Realtime requires.
 *
 * A task's pages are woken by a page shown on the task, an agent's by a page
 * it shows and by the agent's own row, all of which name the task or the
 * agent, and either by what admits the reader to it.
 */

import { queryBuilder } from "@repo/database/core/query";
import { readVisibleAgent } from "@repo/database/models/agent-store";
import { readTaskHeader } from "@repo/database/models/task-store";
import { agentVisibleTo, taskSeenBy } from "@repo/database/models/workspace-store";
import { agentTable } from "@repo/database/schemas/agent";
import { member } from "@repo/database/schemas/auth";
import { task } from "@repo/database/schemas/task";
import { taskPageVersion } from "@repo/database/schemas/task-page";
import { TOPIC } from "@repo/database/sync/notification";
import {
  agentSync,
  githubPersonalTokenSync,
  githubRepositoryReadSync,
  memberSync,
  taskPageVersionSync,
  taskSync,
} from "@repo/database/sync/tables";
import { AGENT_PAGES_READ, TASK_PAGES_READ } from "@repo/features/task-pages-live";
import { and, desc, eq, isNull } from "drizzle-orm";
import { Effect, Option } from "effect";
import { HOSTED_REFUSAL, hostedStoreOrUnavailable } from "../../http/http-effect.js";
import { bindLiveRead, liveRowsStatement } from "../live-read-binding.js";

/** The columns each page's newest version is read with. */
const NEWEST_COLUMNS = {
  pageId: taskPageVersion.pageId,
  title: taskPageVersion.title,
  version: taskPageVersion.version,
  at: taskPageVersion.at,
  shownBy: taskPageVersion.shownBy,
};

/** Each page of the task by its newest version, as `listPages` reads it. */
function taskPagesNewest(userId: string, taskId: string) {
  // Note that the newest version is picked by `distinct on`, as the held read picks it.
  return (
    queryBuilder
      .selectDistinctOn([taskPageVersion.pageId], NEWEST_COLUMNS)
      .from(taskPageVersion)
      .innerJoin(task, eq(task.id, taskPageVersion.taskId))
      // Note that membership is a join, as the record's live read reads it, rather than the held read's subquery.
      .innerJoin(
        member,
        and(eq(member.organizationId, task.organizationId), eq(member.userId, userId)),
      )
      .where(and(eq(taskPageVersion.taskId, taskId), taskSeenBy(userId)))
      .orderBy(taskPageVersion.pageId, desc(taskPageVersion.version))
      .as("newest")
  );
}

/** Each page of the coding agent on no task by its newest version, as `listPages` reads it, under the agent's rule of who may read it. */
function agentPagesNewest(userId: string, agentId: string) {
  return queryBuilder
    .selectDistinctOn([taskPageVersion.pageId], NEWEST_COLUMNS)
    .from(taskPageVersion)
    .innerJoin(agentTable, eq(agentTable.id, taskPageVersion.agentId))
    .where(
      and(
        isNull(taskPageVersion.taskId),
        eq(taskPageVersion.agentId, agentId),
        agentVisibleTo(userId),
      ),
    )
    .orderBy(taskPageVersion.pageId, desc(taskPageVersion.version))
    .as("newest");
}

/** The newest version of each page as Realtime is handed it, from the version subquery. */
function newestPages(newest: ReturnType<typeof taskPagesNewest>) {
  return liveRowsStatement(
    TASK_PAGES_READ.parts.pages,
    {
      ordered: false,
      columns: {
        id: newest.pageId,
        title: newest.title,
        version: newest.version,
        shownBy: newest.shownBy,
      },
      instants: { at: newest.at },
    },
    (selection) => queryBuilder.select(selection).from(newest),
  );
}

/** What admits the reader to a task's rows: the task one it reaches. */
const READS_ON_TASK = [
  taskSync,
  taskPageVersionSync,
  memberSync,
  githubPersonalTokenSync,
  githubRepositoryReadSync,
];

export const taskPagesRead = bindLiveRead(TASK_PAGES_READ, {
  reads: READS_ON_TASK,
  topics: ({ userId, id }) => [
    [TOPIC.TASK, id],
    [TOPIC.ACCOUNT, userId],
  ],
  statements: ({ userId, id }) => ({ pages: newestPages(taskPagesNewest(userId, id)) }),
  admit: ({ userId, id }) =>
    Effect.flatMap(hostedStoreOrUnavailable(readTaskHeader(userId, id)), (task) =>
      Option.isNone(task) ? Effect.fail(HOSTED_REFUSAL.NOT_FOUND) : Effect.void,
    ),
});

export const agentPagesRead = bindLiveRead(AGENT_PAGES_READ, {
  reads: [agentSync, ...READS_ON_TASK],
  topics: ({ userId, id }) => [
    [TOPIC.AGENT, id],
    [TOPIC.ACCOUNT, userId],
  ],
  statements: ({ userId, id }) => ({ pages: newestPages(agentPagesNewest(userId, id)) }),
  admit: ({ userId, id }) =>
    Effect.flatMap(hostedStoreOrUnavailable(readVisibleAgent(userId, id)), (agent) =>
      Option.isNone(agent) ? Effect.fail(HOSTED_REFUSAL.NOT_FOUND) : Effect.void,
    ),
});
