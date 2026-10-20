import {
  type LiveStatement,
  liveSelection,
  liveStatementOf,
} from "@luke/database/core/live-statement";
import { queryBuilder } from "@luke/database/core/query";
import { newestAwaitingLineAt } from "@luke/database/models/message-reads";
import {
  AGENT_WORKSPACE,
  agentReachableBy,
  taskReachableBy,
} from "@luke/database/models/workspace-store";
import { agentPin, taskPin } from "@luke/database/schemas";
import { user } from "@luke/database/schemas/auth";
import { codingAgent } from "@luke/database/schemas/coding-agent";
import { turns } from "@luke/database/schemas/storage";
import { task } from "@luke/database/schemas/task";
import { and, desc, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Option } from "effect";
import { BRAIN_REQUEST_FAILURE } from "../core.js";

/**
 * task-list-live.ts -- the plan list written for Neon Realtime: the plans the account reaches, and every agent of them and with no plan, with what the list reads each agent's status from.
 *
 * Two statements, each the same rows and rule of who may read them as the
 * held read (`tasks-app.ts`'s collection, through `listTasks`,
 * `withTaskAgents`, and `listTasklessAgents`), with every archived plan
 * and agent among them, as the desktop asks for them: the plans with the
 * reader's own pin and the owner's name, and the agents with their newest
 * turn, when the newest line of the developer's awaiting its turn was
 * written and whether that turn's session ended, what each last
 * published, and the names of the members each names. Every column stands
 * under the key `@luke/features/task-list-live` reads it by and every
 * instant as epoch milliseconds. Nothing here reads the clock: an agent's
 * status, which turns on it, is the reader's to read, and so is the order,
 * since Realtime keeps none.
 */

const starter = alias(user, "starter");
const archiver = alias(user, "archiver");

/** The statements the plan list is subscribed to live. */
export interface TaskListLiveStatements {
  readonly plans: LiveStatement;
  readonly agents: LiveStatement;
}

/** The plans the account reaches, archived ones among them, each with the reader's own pin and its owner's name. */
function tasksStatement(userId: string) {
  return queryBuilder
    .select(
      liveSelection(
        {
          id: task.id,
          workspaceId: task.organizationId,
          name: task.name,
          repository: task.repository,
          ownerId: task.userId,
          ownerName: user.name,
          pinPosition: taskPin.position,
          issueId: task.issueId,
          status: task.status,
          priority: task.priority,
          number: task.number,
        },
        {
          pinnedAt: taskPin.pinnedAt,
          archivedAt: task.archivedAt,
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
        },
      ),
    )
    .from(task)
    .leftJoin(taskPin, and(eq(taskPin.taskId, task.id), eq(taskPin.userId, userId)))
    .leftJoin(user, eq(user.id, task.userId))
    .where(taskReachableBy(userId));
}

/**
 * Every agent of a plan the account reaches, and every agent with no plan
 * in its workspaces, archived ones among them, each with its newest turn by
 * the order turns were queued, as `findLatestTurns` reads it.
 */
function agentsStatement(userId: string) {
  const latest = queryBuilder
    .select({
      id: turns.id,
      status: turns.status,
      cancelRequestedAt: turns.cancelRequestedAt,
      queuedAt: turns.queuedAt,
      startedAt: turns.startedAt,
      settledAt: turns.settledAt,
      failure: turns.failure,
    })
    .from(turns)
    .where(eq(turns.conversationId, codingAgent.conversationId))
    .orderBy(desc(turns.queuedAt), desc(turns.id))
    .limit(1)
    .as("latest_turn");
  return queryBuilder
    .select(
      liveSelection(
        {
          id: codingAgent.id,
          planId: codingAgent.taskId,
          workspaceId: AGENT_WORKSPACE,
          model: codingAgent.model,
          effort: codingAgent.effort,
          contextWindow: codingAgent.contextWindow,
          title: codingAgent.title,
          prompted: isNotNull(codingAgent.prompt),
          repository: codingAgent.repository,
          starterId: codingAgent.userId,
          starterName: starter.name,
          automationId: codingAgent.automationId,
          automationName: sql<string | null>`${codingAgent.automationOrigin} ->> 'name'`,
          archivedBy: codingAgent.archivedBy,
          archiverName: archiver.name,
          disabledServers: codingAgent.disabledServers,
          published: codingAgent.published,
          pinPosition: agentPin.position,
          turnId: latest.id,
          turnStatus: latest.status,
          cancelRequested: isNotNull(latest.cancelRequestedAt),
          turnSessionEnded: sql<
            boolean | null
          >`${latest.failure} = ${BRAIN_REQUEST_FAILURE.SESSION_ENDED}`,
        },
        {
          archivedAt: codingAgent.archivedAt,
          pinnedAt: agentPin.pinnedAt,
          createdAt: codingAgent.createdAt,
          queuedAt: latest.queuedAt,
          startedAt: latest.startedAt,
          settledAt: latest.settledAt,
          awaitingLineAt: newestAwaitingLineAt(codingAgent.conversationId),
        },
      ),
    )
    .from(codingAgent)
    .leftJoin(task, eq(task.id, codingAgent.taskId))
    .leftJoin(
      agentPin,
      and(eq(agentPin.codingAgentId, codingAgent.id), eq(agentPin.userId, userId)),
    )
    .leftJoin(starter, eq(starter.id, codingAgent.userId))
    .leftJoin(archiver, eq(archiver.id, sql`${codingAgent.archivedBy} ->> 'userId'`))
    .leftJoinLateral(latest, sql`true`)
    .where(
      or(
        and(isNotNull(codingAgent.taskId), taskReachableBy(userId)),
        and(isNull(codingAgent.taskId), agentReachableBy(userId)),
      ),
    );
}

/** The plan list written for Neon Realtime for the account; none where a statement names a value Realtime cannot carry. */
export function taskListLiveStatements(userId: string): Option.Option<TaskListLiveStatements> {
  return Option.all({
    plans: liveStatementOf(tasksStatement(userId)),
    agents: liveStatementOf(agentsStatement(userId)),
  });
}
