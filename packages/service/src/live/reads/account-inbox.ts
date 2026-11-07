/**
 * account-inbox.ts -- what waits on the account bound (`ACCOUNT_INBOX_READ`): its statements, the account's own automations' failed runs among them, the tables they read, and the topics that wake it.
 *
 * Every part but the failed runs is the inbox store's own live statement
 * (`accountInboxLiveStatements`), beside the held reads it mirrors; the
 * failed runs are written here, as the automation store's held read of them
 * reads them.
 */

import { queryBuilder } from "@repo/database/core/query";
import { memberOfAutomationWorkspace } from "@repo/database/models/automation-store";
import { automation, automationRun } from "@repo/database/schemas/automation";
import { TOPIC } from "@repo/database/sync/notification";
import {
  agentSync,
  automationRunSync,
  automationSync,
  githubPersonalTokenSync,
  githubRepositoryReadSync,
  inboxItemReadSync,
  inboxItemSync,
  memberSync,
  taskSync,
} from "@repo/database/sync/tables";
import { ACCOUNT_INBOX_REPOSITORYLESS } from "@repo/features/account-inbox-wire";
import { AUTOMATION_RUN_STATUS } from "@repo/features/automation-wire";
import { ACCOUNT_INBOX_READ } from "@repo/features/inbox-live";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { accountInboxLiveStatements } from "../../inbox/inbox-store.js";
import { bindLiveRead, liveRowsStatement, ownOrder } from "../live-read-binding.js";

/**
 * The account's own automations' runs that failed to start, each
 * automation's newest alone, in workspaces it is still a member of, every
 * one of them: a live statement reads no clock, so the reader keeps them to
 * its own last week. Note that the newest of each is taken by an order of
 * its own.
 */
function failedRunsStatement(userId: string) {
  return liveRowsStatement(
    ACCOUNT_INBOX_READ.parts.failedRuns,
    {
      ordered: false,
      columns: {
        id: automationRun.id,
        automationId: automationRun.automationId,
        automationName: automation.name,
        workspaceId: automation.organizationId,
        reason: automationRun.reason,
      },
      // Note that a failed run is settled, so it stands at its settling.
      instants: { failedAt: sql<Date>`${automationRun.settledAt}` },
    },
    (selection) =>
      ownOrder(
        queryBuilder
          .selectDistinctOn([automationRun.automationId], selection)
          .from(automationRun)
          .innerJoin(automation, eq(automation.id, automationRun.automationId))
          .where(
            and(
              eq(automation.userId, userId),
              memberOfAutomationWorkspace(userId),
              eq(automationRun.status, AUTOMATION_RUN_STATUS.FAILED),
            ),
          )
          .orderBy(
            asc(automationRun.automationId),
            desc(automationRun.settledAt),
            desc(automationRun.id),
          ),
      ),
  );
}

/**
 * What waits on the account across its workspaces, its tasks and
 * automations holding items, and its own automations' failed runs, woken
 * by an item written in any of its workspaces, which names every member
 * (`inboxItemSync`), by its own read marks, by its own automations and
 * their runs, and by what admits it to a workspace or a repository, all of
 * which name the account. Note that a task or an agent written itself
 * wakes no account's inbox, because a description's save rewrites its task every
 * few seconds and every member would read again for nothing: the rare
 * change the inbox shows of either, a task's assignee or an agent's title,
 * shows at the hold's end. An agent with no repository is carried only to a
 * reader that asks (`ACCOUNT_INBOX_REPOSITORYLESS`), since a build before it
 * fails its whole read on one null.
 */
export const accountInboxRead = bindLiveRead(ACCOUNT_INBOX_READ, {
  reads: [
    inboxItemSync,
    inboxItemReadSync,
    taskSync,
    agentSync,
    automationSync,
    automationRunSync,
    memberSync,
    githubPersonalTokenSync,
    githubRepositoryReadSync,
  ],
  topics: ({ userId }) => [[TOPIC.ACCOUNT, userId]],
  statements: ({ userId, repositoryless }) => ({
    ...accountInboxLiveStatements(userId, repositoryless === ACCOUNT_INBOX_REPOSITORYLESS.INCLUDE),
    failedRuns: failedRunsStatement(userId),
  }),
});
