/**
 * automations.ts -- a workspace's automations and runs, and one automation's runs, bound: their one statement each, the tables they read, the topic that wakes them, and who they admit.
 *
 * Each is the same rows and rule of who may read them as its held read
 * (`automations-app.ts`'s list and runs, through `listAutomations` and
 * `listAutomationRuns`): every automation of the workspace the account may
 * read, each with its newest run, the newest runs of those automations,
 * and an automation's newest runs, each run with the agent it started and
 * what that agent's status is read from (`agent-standing.ts`), in one
 * statement apiece, so a run and its agent move together. Every column
 * stands under the key its declaration reads it by and every instant as
 * epoch milliseconds. Nothing reads the clock: an agent's status, which
 * turns on it, is the reader's, and so is the order (`ordered: false`), as
 * the statements never wrote one.
 *
 * Each is woken on the workspace's topic by an automation made, changed,
 * or deleted, a run fired, started, or settled, the run's agent renamed or
 * its turn queued, started, or settled, and a membership of the workspace
 * moved, all of which name it. An automation's runs name no topic of their
 * automation, so its read serves the workspace the automation stands in,
 * read once as it is asked. Note that a line awaiting the agent's next turn
 * is written on its conversation's topic alone (`messagesSync`), because
 * every streamed step rewrites a journal and waking the workspace on each
 * would re-run every workspace-keyed read for nothing: the mark that line
 * moves shows with the next turn, or at the hold's end.
 */

import { queryBuilder } from "@repo/database/core/query";
import {
  AUTOMATION_COLUMNS,
  automationReadableBy,
  readAutomation,
} from "@repo/database/models/automation-store";
import { agentTable } from "@repo/database/schemas/agent";
import { automation, automationRun } from "@repo/database/schemas/automation";
import { TOPIC } from "@repo/database/sync/notification";
import {
  agentSync,
  automationRunSync,
  automationSync,
  conversationsSync,
  memberSync,
  messagesSync,
  turnsSync,
} from "@repo/database/sync/tables";
import type { AgentFailure } from "@repo/features/agent-wire";
import {
  AUTOMATION_RUNS_READ,
  AUTOMATION_WORKSPACE_RUNS_READ,
  AUTOMATIONS_READ,
} from "@repo/features/automation-live";
import { and, desc, eq, inArray, isNotNull, type SQLWrapper, sql } from "drizzle-orm";
import { Effect, Option } from "effect";
import { HOSTED_REFUSAL, hostedStoreOrUnavailable } from "../../http/http-effect.js";
import {
  awaitingLineAtIn,
  failureWordOf,
  latestTurnOf,
  sessionEndedOf,
} from "../agent-standing.js";
import { bindLiveRead, liveRowsStatement, outerJoined } from "../live-read-binding.js";

/** The most runs an automation's live history holds, as its held read answers them. */
export const AUTOMATION_RUNS_HELD = 50;

/** The most runs a workspace's live runs hold, newest first. */
const AUTOMATION_WORKSPACE_RUNS_HELD = 100;

/** The task an automation's row names, which is none: a typed null for the columns a released desktop still decodes. */
const LIVE_NO_TASK = sql<null>`null::text`;

/** The tables every automation read reads: the automations and their runs, each run's agent and what its status is read from, and the membership that admits the reader. */
const AUTOMATION_READS = [
  automationSync,
  automationRunSync,
  agentSync,
  turnsSync,
  messagesSync,
  conversationsSync,
  memberSync,
];

/** A run of a statement's columns: those selected as they are, and its instants as epoch milliseconds. */
interface ColumnGroup {
  readonly columns: Readonly<Record<string, SQLWrapper>>;
  readonly instants: Readonly<Record<string, SQLWrapper>>;
}

/**
 * The selection with its keys in the order the groups name them, each
 * group's columns before its instants. Note that the statement selected
 * each group so before it was declared, and a selection built whole names
 * every column before every instant, so this keeps its SQL as it was.
 */
function inGroupOrder<Selection extends Readonly<Record<string, unknown>>>(
  selection: Selection,
  groups: readonly ColumnGroup[],
): Selection {
  const keys = groups.flatMap((group) => [
    ...Object.keys(group.columns),
    ...Object.keys(group.instants),
  ]);
  // SAFETY: the groups name every key of the selection, which was built from them, once each.
  return Object.fromEntries(keys.map((key) => [key, selection[key]])) as unknown as Selection;
}

/** The agent a run started and what its status is read from, each under the key its row reads it by: the agent and turn joined beside the run, null where it started none. */
function runAgentColumns(userId: string, latest: ReturnType<typeof latestTurnOf>) {
  return {
    columns: {
      agentId: outerJoined(agentTable.id),
      agentTitle: agentTable.title,
      ownKey: sql<boolean | null>`${eq(agentTable.userId, userId)}`,
      turnId: outerJoined(latest.id),
      turnStatus: outerJoined(latest.status),
      cancelRequested: sql<boolean | null>`${isNotNull(latest.cancelRequestedAt)}`,
      turnSessionEnded: sessionEndedOf(latest),
      failureWord: sql<AgentFailure | null>`${failureWordOf(latest)}`,
    },
    instants: {
      agentCreatedAt: outerJoined(agentTable.createdAt),
      turnQueuedAt: outerJoined(latest.queuedAt),
      turnSettledAt: latest.settledAt,
      awaitingLineAt: awaitingLineAtIn(agentTable.conversationId),
    },
  };
}

export const automationsRead = bindLiveRead(AUTOMATIONS_READ, {
  reads: AUTOMATION_READS,
  topics: ({ workspaceId }) => [[TOPIC.WORKSPACE, workspaceId]],
  statements: ({ userId, workspaceId }) => {
    const lastRun = queryBuilder
      .select({
        id: automationRun.id,
        firing: automationRun.firing,
        status: automationRun.status,
        reason: automationRun.reason,
        agentId: automationRun.agentId,
        firedAt: automationRun.firedAt,
        settledAt: automationRun.settledAt,
      })
      .from(automationRun)
      .where(eq(automationRun.automationId, automation.id))
      .orderBy(desc(automationRun.firedAt), desc(automationRun.id))
      .limit(1)
      .as("last_run");
    const latest = latestTurnOf(agentTable.conversationId, "latest_turn");
    const { nextRunAt, createdAt, updatedAt: _updatedAt, ...columns } = AUTOMATION_COLUMNS;
    const own = {
      columns: {
        ...columns,
        // Note that the row reads a workspace as one a released desktop may hold none of, which keeps its place among the columns.
        organizationId: sql<string | null>`${automation.organizationId}`,
        // Note that no automation stands on a task, and the row still carries the task's columns
        // as nulls because a released desktop decodes them as required.
        taskId: LIVE_NO_TASK,
        taskName: LIVE_NO_TASK,
        taskRepository: LIVE_NO_TASK,
        mine: sql<boolean>`${eq(automation.userId, userId)}`,
      },
      instants: { nextRunAt, createdAt },
    };
    const run = {
      columns: {
        runId: outerJoined(lastRun.id),
        runFiring: outerJoined(lastRun.firing),
        runStatus: outerJoined(lastRun.status),
        runReason: lastRun.reason,
      },
      instants: { runFiredAt: outerJoined(lastRun.firedAt), runSettledAt: lastRun.settledAt },
    };
    const agent = runAgentColumns(userId, latest);
    return {
      automations: liveRowsStatement(
        AUTOMATIONS_READ.parts.automations,
        {
          ordered: false,
          columns: { ...own.columns, ...run.columns, ...agent.columns },
          instants: { ...own.instants, ...run.instants, ...agent.instants },
        },
        (selection) =>
          queryBuilder
            .select(inGroupOrder(selection, [own, run, agent]))
            .from(automation)
            .leftJoinLateral(lastRun, sql`true`)
            .leftJoin(agentTable, eq(agentTable.id, lastRun.agentId))
            .leftJoinLateral(latest, sql`true`)
            .where(and(automationReadableBy(userId), eq(automation.organizationId, workspaceId))),
      ),
    };
  },
  // Note that a workspace of no shape reads as none, but one left empty is refused, as the held list refuses it.
  admit: ({ workspaceId }) =>
    workspaceId === "" ? Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST) : Effect.void,
});

/**
 * The newest runs of the workspace's automations the account may read. Note
 * that the newest are chosen among the readable automations' runs alone, so
 * a teammate's busy personal automation never crowds the account's own out
 * of the window.
 */
export const automationWorkspaceRunsRead = bindLiveRead(AUTOMATION_WORKSPACE_RUNS_READ, {
  reads: AUTOMATION_READS,
  topics: ({ workspaceId }) => [[TOPIC.WORKSPACE, workspaceId]],
  statements: ({ userId, workspaceId }) => {
    const readable = and(automationReadableBy(userId), eq(automation.organizationId, workspaceId));
    const newest = queryBuilder
      .select({ id: automationRun.id })
      .from(automationRun)
      .innerJoin(automation, eq(automation.id, automationRun.automationId))
      .where(readable)
      .orderBy(desc(automationRun.firedAt), desc(automationRun.id))
      .limit(AUTOMATION_WORKSPACE_RUNS_HELD);
    const latest = latestTurnOf(agentTable.conversationId, "latest_turn");
    const own = {
      columns: {
        id: automationRun.id,
        firing: automationRun.firing,
        status: automationRun.status,
        reason: automationRun.reason,
        automationId: automation.id,
        automationName: automation.name,
      },
      instants: { firedAt: automationRun.firedAt, settledAt: automationRun.settledAt },
    };
    const agent = runAgentColumns(userId, latest);
    return {
      runs: liveRowsStatement(
        AUTOMATION_WORKSPACE_RUNS_READ.parts.runs,
        {
          ordered: false,
          columns: { ...own.columns, ...agent.columns },
          instants: { ...own.instants, ...agent.instants },
        },
        (selection) =>
          queryBuilder
            .select(inGroupOrder(selection, [own, agent]))
            .from(automationRun)
            .innerJoin(automation, eq(automation.id, automationRun.automationId))
            .leftJoin(agentTable, eq(agentTable.id, automationRun.agentId))
            .leftJoinLateral(latest, sql`true`)
            .where(and(readable, inArray(automationRun.id, newest))),
      ),
    };
  },
  admit: ({ workspaceId }) =>
    workspaceId === "" ? Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST) : Effect.void,
});

export const automationRunsRead = bindLiveRead(AUTOMATION_RUNS_READ, {
  reads: AUTOMATION_READS,
  topics: ({ workspaceId }) => [[TOPIC.WORKSPACE, workspaceId]],
  statements: ({ userId, id }) => {
    const newest = queryBuilder
      .select({ id: automationRun.id })
      .from(automationRun)
      .where(eq(automationRun.automationId, id))
      .orderBy(desc(automationRun.firedAt), desc(automationRun.id))
      .limit(AUTOMATION_RUNS_HELD);
    const latest = latestTurnOf(agentTable.conversationId, "latest_turn");
    const own = {
      columns: {
        id: automationRun.id,
        firing: automationRun.firing,
        status: automationRun.status,
        reason: automationRun.reason,
      },
      instants: { firedAt: automationRun.firedAt, settledAt: automationRun.settledAt },
    };
    const agent = runAgentColumns(userId, latest);
    return {
      runs: liveRowsStatement(
        AUTOMATION_RUNS_READ.parts.runs,
        {
          ordered: false,
          columns: { ...own.columns, ...agent.columns },
          instants: { ...own.instants, ...agent.instants },
        },
        (selection) =>
          queryBuilder
            .select(inGroupOrder(selection, [own, agent]))
            .from(automationRun)
            .innerJoin(automation, eq(automation.id, automationRun.automationId))
            .leftJoin(agentTable, eq(agentTable.id, automationRun.agentId))
            .leftJoinLateral(latest, sql`true`)
            .where(
              and(
                eq(automation.id, id),
                automationReadableBy(userId),
                inArray(automationRun.id, newest),
              ),
            ),
      ),
    };
  },
  // Note that the automation is read once, as it is asked, for the workspace whose topic its runs wake on.
  serve: Effect.fnUntraced(function* ({ userId, id }) {
    const read = yield* hostedStoreOrUnavailable(readAutomation(userId, id));
    if (Option.isNone(read)) return yield* Effect.fail(HOSTED_REFUSAL.NOT_FOUND);
    return { workspaceId: read.value.organizationId };
  }),
});
