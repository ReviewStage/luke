import {
  type LiveStatement,
  liveSelection,
  liveStatementOf,
} from "@luke/database/core/live-statement";
import { queryBuilder } from "@luke/database/core/query";
import {
  AUTOMATION_COLUMNS,
  AUTOMATION_WORKSPACE,
  automationReadableBy,
} from "@luke/database/models/automation-store";
import { automation, automationRun } from "@luke/database/schemas/automation";
import { codingAgent } from "@luke/database/schemas/coding-agent";
import { task } from "@luke/database/schemas/plan";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { Option } from "effect";
import { failureWordOf, latestTurnOf, lineAwaitsIn } from "../live/agent-standing.js";

/**
 * automation-live.ts -- a workspace's automations and one automation's runs, written for Neon Realtime.
 *
 * Each is the same rows and rule of who may read them as its held read
 * (`automations-app.ts`'s list and runs, through `listAutomations` and
 * `listAutomationRuns`): every automation of the workspace the account may
 * read, each with its newest run, and an automation's newest runs, each
 * run with the agent it started and what that agent's status is read from
 * (`agent-standing.ts`), in one statement apiece, so a run and its agent
 * move together. Every column stands under the key
 * `@luke/features/automation-live` reads it by and every instant as epoch
 * milliseconds. Nothing reads the clock: an agent's status, which turns on
 * it, is the reader's, and so is the order, since Realtime keeps none.
 */

/** The most runs an automation's live history holds, as its held read answers them. */
export const AUTOMATION_RUNS_READ = 50;

/** The agent a run started and what its status is read from, each under the key the wire reads it by: the agent and turn joined beside the run. */
function runAgentSelection(userId: string, latest: ReturnType<typeof latestTurnOf>) {
  return liveSelection(
    {
      agentId: codingAgent.id,
      agentTitle: codingAgent.title,
      ownKey: eq(codingAgent.userId, userId),
      turnId: latest.id,
      turnStatus: latest.status,
      cancelRequested: isNotNull(latest.cancelRequestedAt),
      lineAwaits: lineAwaitsIn(codingAgent.conversationId),
      failureWord: failureWordOf(latest),
    },
    { agentCreatedAt: codingAgent.createdAt },
  );
}

/** The statement a workspace's automations are subscribed to live. */
export interface AutomationsLiveStatements {
  readonly automations: LiveStatement;
}

/** Every automation of the workspace the account may read, each with its newest run and that run's agent, written for Realtime. */
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
      codingAgentId: automationRun.codingAgentId,
      firedAt: automationRun.firedAt,
      settledAt: automationRun.settledAt,
    })
    .from(automationRun)
    .where(eq(automationRun.automationId, automation.id))
    .orderBy(desc(automationRun.firedAt), desc(automationRun.id))
    .limit(1)
    .as("last_run");
  const latest = latestTurnOf(codingAgent.conversationId, "latest_turn");
  const {
    nextRunAt,
    createdAt,
    updatedAt: _updatedAt,
    taskRepository: _taskRepository,
    ...columns
  } = AUTOMATION_COLUMNS;
  const statement = queryBuilder
    .select({
      ...liveSelection(
        { ...columns, mine: eq(automation.userId, userId) },
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
    .leftJoin(task, eq(task.id, automation.taskId))
    .leftJoinLateral(lastRun, sql`true`)
    .leftJoin(codingAgent, eq(codingAgent.id, lastRun.codingAgentId))
    .leftJoinLateral(latest, sql`true`)
    .where(and(automationReadableBy(userId), eq(AUTOMATION_WORKSPACE, workspaceId)));
  return Option.map(liveStatementOf(statement), (automations) => ({ automations }));
}

/** The statement an automation's runs are subscribed to live. */
export interface AutomationRunsLiveStatements {
  readonly runs: LiveStatement;
}

/** The automation's newest runs the account may read, each with its agent, written for Realtime; the reader keeps the order. */
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
  const latest = latestTurnOf(codingAgent.conversationId, "latest_turn");
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
    .leftJoin(codingAgent, eq(codingAgent.id, automationRun.codingAgentId))
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
