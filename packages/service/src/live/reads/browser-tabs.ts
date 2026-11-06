/**
 * browser-tabs.ts -- one task's Browser tabs, every one of its agents', and one coding agent's, bound: their one statement each, the tables they read, the topics that wake them, who they admit, and how often a held poll looks.
 *
 * Each statement delivers every tab `listBrowserTabs` lists the account,
 * the agent's pointer on each among it, under the same rule of who may read
 * it: a tab of an agent the account sees whole, its task included where it
 * is on one (`agentVisibleTo`), read through the agent's own row, never the
 * task the tab's row was written under, so a tab follows its agent. The
 * account is joined through its membership of the agent's workspace, as
 * Neon's guide authorizes a live read. It reads no clock, as Realtime
 * requires, so a takeover past its instant is delivered as it stands and
 * lapsed by the reader.
 *
 * A task's tabs are woken by a tab opened, moved, pointed at, taken over,
 * or closed under the task, and by the agents on the task, all of which
 * name the task; an agent's by the agent's own row. Note that a tab names
 * no agent's topic, its own row holding only its agent's conversation, so a
 * tab's move reaches an agent's reader on the watched look rather than by a
 * wake, which both reads take, since a window watches the pointer move.
 */

import { queryBuilder } from "@repo/database/core/query";
import { readVisibleAgent } from "@repo/database/models/agent-store";
import { readTaskHeader } from "@repo/database/models/task-store";
import { agentVisibleTo } from "@repo/database/models/workspace-store";
import { agentTable } from "@repo/database/schemas/agent";
import { agentBrowserTab } from "@repo/database/schemas/agent-browser-tab";
import { member } from "@repo/database/schemas/auth";
import { TOPIC } from "@repo/database/sync/notification";
import {
  agentBrowserTabSync,
  agentSync,
  githubPersonalTokenSync,
  githubRepositoryReadSync,
  memberSync,
  taskSync,
} from "@repo/database/sync/tables";
import { AGENT_BROWSER_TABS_READ, TASK_BROWSER_TABS_READ } from "@repo/features/browser-tabs-live";
import { and, eq, type SQL } from "drizzle-orm";
import { Effect, Option } from "effect";
import { HOSTED_REFUSAL, hostedStoreOrUnavailable } from "../../http/http-effect.js";
import { bindLiveRead, liveRowsStatement, WATCHED_LOOK } from "../live-read-binding.js";

/** The tabs of the agents `ofAgent` names, each as the wire's tab line reads it, to the account that sees each agent whole. */
function tabsStatement(userId: string, ofAgent: SQL) {
  return liveRowsStatement(
    TASK_BROWSER_TABS_READ.parts.tabs,
    {
      ordered: false,
      columns: {
        id: agentBrowserTab.id,
        agentId: agentTable.id,
        address: agentBrowserTab.address,
        title: agentBrowserTab.title,
        openedBy: agentBrowserTab.openedBy,
        openedByUserId: agentBrowserTab.openedByUserId,
        driverUserId: agentBrowserTab.driverUserId,
        cursorX: agentBrowserTab.cursorX,
        cursorY: agentBrowserTab.cursorY,
        cursorKind: agentBrowserTab.cursorKind,
        cursorViewportW: agentBrowserTab.cursorViewportW,
        cursorViewportH: agentBrowserTab.cursorViewportH,
      },
      instants: {
        heldUntil: agentBrowserTab.heldUntil,
        createdAt: agentBrowserTab.createdAt,
        lastActedAt: agentBrowserTab.lastActedAt,
        cursorAt: agentBrowserTab.cursorAt,
      },
    },
    (selection) =>
      queryBuilder
        .select(selection)
        .from(agentBrowserTab)
        // Note that a tab no coding agent's conversation names is listed to no one, as the held list reads it.
        .innerJoin(agentTable, eq(agentTable.conversationId, agentBrowserTab.conversationId))
        .innerJoin(
          member,
          and(eq(member.organizationId, agentTable.organizationId), eq(member.userId, userId)),
        )
        .where(and(ofAgent, agentVisibleTo(userId))),
  );
}

/** What the tabs are read through and admitted by: the tab, its agent, and what admits the reader to the agent's workspace and task. */
const TAB_READS = [
  agentBrowserTabSync,
  agentSync,
  taskSync,
  memberSync,
  githubPersonalTokenSync,
  githubRepositoryReadSync,
];

export const taskBrowserTabsRead = bindLiveRead(TASK_BROWSER_TABS_READ, {
  reads: TAB_READS,
  topics: ({ userId, id }) => [
    [TOPIC.TASK, id],
    [TOPIC.ACCOUNT, userId],
  ],
  statements: ({ userId, id }) => ({ tabs: tabsStatement(userId, eq(agentTable.taskId, id)) }),
  admit: ({ userId, id }) =>
    Effect.flatMap(hostedStoreOrUnavailable(readTaskHeader(userId, id)), (task) =>
      Option.isNone(task) ? Effect.fail(HOSTED_REFUSAL.NOT_FOUND) : Effect.void,
    ),
  look: WATCHED_LOOK,
});

export const agentBrowserTabsRead = bindLiveRead(AGENT_BROWSER_TABS_READ, {
  reads: TAB_READS,
  topics: ({ userId, id }) => [
    [TOPIC.AGENT, id],
    [TOPIC.ACCOUNT, userId],
  ],
  statements: ({ userId, id }) => ({ tabs: tabsStatement(userId, eq(agentTable.id, id)) }),
  admit: ({ userId, id }) =>
    Effect.flatMap(hostedStoreOrUnavailable(readVisibleAgent(userId, id)), (agent) =>
      Option.isNone(agent) ? Effect.fail(HOSTED_REFUSAL.NOT_FOUND) : Effect.void,
    ),
  look: WATCHED_LOOK,
});
