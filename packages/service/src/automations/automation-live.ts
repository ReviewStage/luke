import {
  type LiveStatement,
  liveSelection,
  liveStatementOf,
} from "@repo/database/core/live-statement";
import { queryBuilder } from "@repo/database/core/query";
import { AUTOMATION_COLUMNS, automationReadableBy } from "@repo/database/models/automation-store";
import { agentTable } from "@repo/database/schemas/agent";
import { automation, automationRun } from "@repo/database/schemas/automation";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { Option } from "effect";
import {
  awaitingLineAtIn,
  failureWordOf,
  latestTurnOf,
  sessionEndedOf,
} from "../live/agent-standing.js";

const LIVE_NO_TASK = sql<null>`null::text`;

export const AUTOMATION_RUNS_READ = 50;

function runAgentSelection(userId: string, latest: ReturnType<typeof latestTurnOf>) {
  return liveSelection(
    {
      agentId: agentTable.id,
      agentTitle: agentTable.title,
      ownKey: eq(agentTable.userId, userId),
      turnId: latest.id,
      turnStatus: latest.status,
      cancelRequested: isNotNull(latest.cancelRequestedAt),
      turnSessionEnded: sessionEndedOf(latest),
      failureWord: failureWordOf(latest),
    },
    {
      agentCreatedAt: agentTable.createdAt,
      turnQueuedAt: latest.queuedAt,
      turnSettledAt: latest.settledAt,
      awaitingLineAt: awaitingLineAtIn(agentTable.conversationId),
    },
  );
}

export interface AutomationsLiveStatements {
  readonly automations: LiveStatement;
}

export function automationsLiveStatements(
  userId: string,
  workspaceId: string,
): Option.Option<AutomationsLiveStatements> {
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
  const statement = queryBuilder
    .select({
      ...liveSelection(
        {
          ...columns,
          taskId: LIVE_NO_TASK,
          taskName: LIVE_NO_TASK,
          taskRepository: LIVE_NO_TASK,
          mine: eq(automation.userId, userId),
        },
        { nextRunAt, createdAt },
      ),
      ...liveSelection(
        {
          runId: lastRun.id,
          runFiring: lastRun.firing,
          runStatus: lastRun.status,
          runReason: lastRun.reason,
        },
        { runFiredAt: lastRun.firedAt, runSettledAt: lastRun.settledAt },
      ),
      ...runAgentSelection(userId, latest),
    })
    .from(automation)
    .leftJoinLateral(lastRun, sql`true`)
    .leftJoin(agentTable, eq(agentTable.id, lastRun.agentId))
    .leftJoinLateral(latest, sql`true`)
    .where(and(automationReadableBy(userId), eq(automation.organizationId, workspaceId)));
  return Option.map(liveStatementOf(statement), (automations) => ({ automations }));
}

export interface AutomationRunsLiveStatements {
  readonly runs: LiveStatement;
}

export function automationRunsLiveStatements(
  userId: string,
  automationId: string,
): Option.Option<AutomationRunsLiveStatements> {
  const newest = queryBuilder
    .select({ id: automationRun.id })
    .from(automationRun)
    .where(eq(automationRun.automationId, automationId))
    .orderBy(desc(automationRun.firedAt), desc(automationRun.id))
    .limit(AUTOMATION_RUNS_READ);
  const latest = latestTurnOf(agentTable.conversationId, "latest_turn");
  const statement = queryBuilder
    .select({
      ...liveSelection(
        {
          id: automationRun.id,
          firing: automationRun.firing,
          status: automationRun.status,
          reason: automationRun.reason,
        },
        { firedAt: automationRun.firedAt, settledAt: automationRun.settledAt },
      ),
      ...runAgentSelection(userId, latest),
    })
    .from(automationRun)
    .innerJoin(automation, eq(automation.id, automationRun.automationId))
    .leftJoin(agentTable, eq(agentTable.id, automationRun.agentId))
    .leftJoinLateral(latest, sql`true`)
    .where(
      and(
        eq(automation.id, automationId),
        automationReadableBy(userId),
        inArray(automationRun.id, newest),
      ),
    );
  return Option.map(liveStatementOf(statement), (runs) => ({ runs }));
}

export const AUTOMATION_WORKSPACE_RUNS_READ = 100;

export interface AutomationWorkspaceRunsLiveStatements {
  readonly runs: LiveStatement;
}

export function automationWorkspaceRunsLiveStatements(
  userId: string,
  workspaceId: string,
): Option.Option<AutomationWorkspaceRunsLiveStatements> {
  const readable = and(automationReadableBy(userId), eq(automation.organizationId, workspaceId));
  const newest = queryBuilder
    .select({ id: automationRun.id })
    .from(automationRun)
    .innerJoin(automation, eq(automation.id, automationRun.automationId))
    .where(readable)
    .orderBy(desc(automationRun.firedAt), desc(automationRun.id))
    .limit(AUTOMATION_WORKSPACE_RUNS_READ);
  const latest = latestTurnOf(agentTable.conversationId, "latest_turn");
  const statement = queryBuilder
    .select({
      ...liveSelection(
        {
          id: automationRun.id,
          firing: automationRun.firing,
          status: automationRun.status,
          reason: automationRun.reason,
          automationId: automation.id,
          automationName: automation.name,
        },
        { firedAt: automationRun.firedAt, settledAt: automationRun.settledAt },
      ),
      ...runAgentSelection(userId, latest),
    })
    .from(automationRun)
    .innerJoin(automation, eq(automation.id, automationRun.automationId))
    .leftJoin(agentTable, eq(agentTable.id, automationRun.agentId))
    .leftJoinLateral(latest, sql`true`)
    .where(and(readable, inArray(automationRun.id, newest)));
  return Option.map(liveStatementOf(statement), (runs) => ({ runs }));
}
