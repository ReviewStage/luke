import {
  type LiveStatement,
  liveSelection,
  liveStatementOf,
} from "@luke/database/core/live-statement";
import { queryBuilder } from "@luke/database/core/query";
import {
  AGENT_WORKSPACE,
  agentReachableBy,
  agentSeenBy,
  taskReachableBy,
} from "@luke/database/models/workspace-store";
import { agentPin, taskIssue, taskPin } from "@luke/database/schemas";
import { user } from "@luke/database/schemas/auth";
import { codingAgent } from "@luke/database/schemas/coding-agent";
import { task } from "@luke/database/schemas/task";
import { CODING_AGENT_BRIEF } from "@luke/features/coding-agent-wire";
import { and, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Option } from "effect";
import { awaitingLineAtIn, latestTurnOf, sessionEndedOf } from "../live/agent-standing.js";

/**
 * task-list-live.ts -- the plan list written for Neon Realtime: the plans the account reaches, every agent of them and with no plan, with what the list reads each agent's status from, and the issues the plans link.
 *
 * Three statements, each the same rows and rule of who may read them as the
 * held read (`tasks-app.ts`'s collection, through `listTasks`,
 * `withTaskAgents`, and `listTasklessAgents`), with every archived plan
 * and agent among them, as the desktop asks for them: the plans with the
 * reader's own pin and the owner's name, and the agents with their newest
 * turn, when the newest line of the developer's awaiting its turn was
 * written and whether that turn's session ended, what each last
 * published, and the names of the members each names; and the issues the
 * plans link, as their tags name them. Every column stands
 * under the key `@luke/features/task-list-live` reads it by and every
 * instant as epoch milliseconds. Nothing here reads the clock: an agent's
 * status, which turns on it, is the reader's to read, and so is the order,
 * since Realtime keeps none.
 */

const starter = alias(user, "starter");
const archiver = alias(user, "archiver");
const assignee = alias(user, "assignee");

/** The statements the plan list is subscribed to live. */
export interface TaskListLiveStatements {
  readonly plans: LiveStatement;
  readonly agents: LiveStatement;
  readonly issues: LiveStatement;
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
          assigneeId: task.assigneeId,
          assigneeName: assignee.name,
          pinPosition: taskPin.position,
          status: task.status,
          priority: task.priority,
          number: task.number,
          creatorActor: task.creatorActor,
          creatorAgentId: task.creatorAgentId,
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
    .leftJoin(assignee, eq(assignee.id, task.assigneeId))
    .where(taskReachableBy(userId));
}

/**
 * The issues every plan the account reaches links, archived plans' among
 * them, each as a card's tag names it, with when it was linked, which the
 * reader orders a plan's tags by. Note that it is a statement of its own
 * rather than an aggregate on each plan's row, because `jsonb_agg` is only
 * stable and Realtime refuses any function that is not immutable.
 */
function issuesStatement(userId: string) {
  return queryBuilder
    .select(
      liveSelection(
        {
          id: taskIssue.id,
          planId: taskIssue.taskId,
          provider: taskIssue.provider,
          key: taskIssue.key,
          url: taskIssue.url,
          relation: taskIssue.relation,
        },
        { createdAt: taskIssue.createdAt },
      ),
    )
    .from(taskIssue)
    .innerJoin(task, eq(task.id, taskIssue.taskId))
    .where(taskReachableBy(userId));
}

/**
 * Every agent of a plan the account reaches, and every agent with no plan
 * in its workspaces, archived ones among them, each with its newest turn by
 * the order turns were queued, as `findLatestTurns` reads it.
 */
function agentsStatement(userId: string) {
  const latest = latestTurnOf(codingAgent.conversationId, "latest_turn");
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
          brief: sql<string>`case when ${codingAgent.prompt} is not null then ${CODING_AGENT_BRIEF.PROMPT} when ${codingAgent.planSnapshot} is not null then ${CODING_AGENT_BRIEF.PLAN} else ${CODING_AGENT_BRIEF.BLANK} end`,
          repository: codingAgent.repository,
          starterId: codingAgent.userId,
          starterName: starter.name,
          automationId: codingAgent.automationId,
          automationName: sql<string | null>`${codingAgent.automationOrigin} ->> 'name'`,
          archivedBy: codingAgent.archivedBy,
          archiverName: archiver.name,
          disabledServers: codingAgent.disabledServers,
          published: codingAgent.published,
          startedFrom: codingAgent.startedFrom,
          pinPosition: agentPin.position,
          turnId: latest.id,
          turnStatus: latest.status,
          cancelRequested: isNotNull(latest.cancelRequestedAt),
          turnSessionEnded: sessionEndedOf(latest),
        },
        {
          archivedAt: codingAgent.archivedAt,
          pinnedAt: agentPin.pinnedAt,
          createdAt: codingAgent.createdAt,
          queuedAt: latest.queuedAt,
          startedAt: latest.startedAt,
          settledAt: latest.settledAt,
          awaitingLineAt: awaitingLineAtIn(codingAgent.conversationId),
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
        // An agent on a task is listed only where the account sees it too, as the held list reads it.
        and(isNotNull(codingAgent.taskId), taskReachableBy(userId), agentSeenBy(userId)),
        and(isNull(codingAgent.taskId), agentReachableBy(userId)),
      ),
    );
}

/** The plan list written for Neon Realtime for the account; none where a statement names a value Realtime cannot carry. */
export function taskListLiveStatements(userId: string): Option.Option<TaskListLiveStatements> {
  return Option.all({
    plans: liveStatementOf(tasksStatement(userId)),
    agents: liveStatementOf(agentsStatement(userId)),
    issues: liveStatementOf(issuesStatement(userId)),
  });
}
