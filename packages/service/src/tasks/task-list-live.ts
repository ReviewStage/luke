import {
  type LiveStatement,
  liveSelection,
  liveStatementOf,
} from "@luke/database/core/live-statement";
import { queryBuilder } from "@luke/database/core/query";
import { taskBlockedFor } from "@luke/database/models/task-block-store";
import {
  AGENT_WORKSPACE,
  agentVisibleTo,
  taskReachableBy,
} from "@luke/database/models/workspace-store";
import { agentPin, conversations, device, taskPin } from "@luke/database/schemas";
import { agentTable } from "@luke/database/schemas/agent";
import { user } from "@luke/database/schemas/auth";
import { task } from "@luke/database/schemas/task";
import { AGENT_BRIEF, AGENT_KIND } from "@luke/features/agent-wire";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Option } from "effect";
import {
  awaitingLineAtIn,
  lastSettledAtIn,
  latestTurnOf,
  quietTurnOf,
  sessionEndedOf,
} from "../live/agent-standing.js";

/**
 * task-list-live.ts -- the plan list written for Neon Realtime: the plans the account reaches, and every agent of them and with no plan, with what the list reads each agent's status from.
 *
 * Two statements, each the same rows and rule of who may read them as the
 * held read (`tasks-app.ts`'s collection, through `listTasks`,
 * `withTaskAgents`, and `listTasklessAgents`), with every archived plan
 * and agent among them, as the desktop asks for them: the plans with the
 * reader's own pin and the owner's name, and the agents with their newest
 * turn, the pilot that started each where one did, when the newest line
 * of the developer's awaiting its turn was written and whether that turn's session ended, when the newest turn to end
 * ended, what each last published, the harness its conversation runs on, the
 * Mac a local one runs on, and the names of the members each names. A third, the issues
 * the plans linked, answers no rows now that a plan links none, and stands
 * because a released desktop follows it. Every column stands
 * under the key `@luke/features/task-list-live` reads it by and every
 * instant as epoch milliseconds. Nothing here reads the clock: an agent's
 * status, which turns on it, is the reader's to read, and so is the order,
 * since Realtime keeps none.
 */

const starter = alias(user, "starter");
const archiver = alias(user, "archiver");
const assignee = alias(user, "assignee");
const starterPilot = alias(agentTable, "starter_pilot");

/** The statements the plan list is subscribed to live. */
export interface TaskListLiveStatements {
  readonly plans: LiveStatement;
  readonly agents: LiveStatement;
  readonly issues: LiveStatement;
}

/**
 * The plans the account reaches, each with the reader's own pin, its
 * owner's name, and whether it waits on an open task the account reaches
 * (`taskBlockedFor`). Note that `archivedAt` is still answered, as null, because
 * a desktop from before #4541 decodes a row without it as no row: no
 * plan is archived any more, and the column is dropped. The key goes with
 * the minimum supported desktop version, not with a service deploy, since a
 * desktop stays old far longer than a service build runs.
 */
function tasksStatement(userId: string) {
  return queryBuilder
    .select(
      liveSelection(
        {
          id: task.id,
          archivedAt: sql<null>`null::bigint`,
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
          parentTaskId: task.parentTaskId,
          mode: task.mode,
          mergePolicy: task.mergePolicy,
          blocked: taskBlockedFor(userId),
        },
        {
          pinnedAt: taskPin.pinnedAt,
          completedAt: task.completedAt,
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
 * The issues the plans linked: none, since a plan links none. A released
 * desktop still follows the statement and decodes its rows, so it stands,
 * answering no rows.
 */
function issuesStatement() {
  return queryBuilder
    .select(liveSelection({ id: task.id }))
    .from(task)
    .where(sql`false`);
}

/**
 * Every agent of a plan the account reaches, and every agent with no plan
 * in its workspaces, archived ones among them, each with its newest turn by
 * the order turns were queued, as `findLatestTurns` reads it, the harness
 * its conversation runs on, and the Mac it runs on by its name, as
 * `devicesNamed` reads them. Note that the Mac's last beat is not read,
 * because a beat wakes nothing (`deviceSync`) and a window judges a Mac by
 * its own presence read.
 */
function agentsStatement(userId: string) {
  const latest = latestTurnOf(agentTable.conversationId, "latest_turn");
  return queryBuilder
    .select(
      liveSelection(
        {
          id: agentTable.id,
          planId: agentTable.taskId,
          workspaceId: AGENT_WORKSPACE,
          model: agentTable.model,
          effort: agentTable.effort,
          contextWindow: agentTable.contextWindow,
          title: agentTable.title,
          kind: agentTable.kind,
          brief: sql<string>`case when ${agentTable.prompt} is not null then ${AGENT_BRIEF.PROMPT} when ${agentTable.planSnapshot} is not null then ${AGENT_BRIEF.PLAN} else ${AGENT_BRIEF.BLANK} end`,
          repository: agentTable.repository,
          starterId: agentTable.userId,
          starterName: starter.name,
          starterPilotId: starterPilot.id,
          starterPilotTaskId: starterPilot.taskId,
          starterPilotTitle: starterPilot.title,
          starterPilotModel: starterPilot.model,
          automationId: agentTable.automationId,
          automationName: sql<string | null>`${agentTable.automationOrigin} ->> 'name'`,
          archivedBy: agentTable.archivedBy,
          archiverName: archiver.name,
          disabledServers: agentTable.disabledServers,
          published: agentTable.published,
          startedFrom: agentTable.startedFrom,
          runtime: conversations.runtime,
          machine: agentTable.machine,
          deviceId: agentTable.deviceId,
          deviceName: device.name,
          pinPosition: agentPin.position,
          turnId: latest.id,
          turnStatus: latest.status,
          cancelRequested: isNotNull(latest.cancelRequestedAt),
          turnSessionEnded: sessionEndedOf(latest),
          quietTurn: quietTurnOf(agentTable.kind, agentTable.conversationId, latest),
        },
        {
          archivedAt: agentTable.archivedAt,
          pinnedAt: agentPin.pinnedAt,
          createdAt: agentTable.createdAt,
          cancelRequestedAt: latest.cancelRequestedAt,
          queuedAt: latest.queuedAt,
          startedAt: latest.startedAt,
          settledAt: latest.settledAt,
          awaitingLineAt: awaitingLineAtIn(agentTable.conversationId),
          lastSettledAt: lastSettledAtIn(agentTable.conversationId),
        },
      ),
    )
    .from(agentTable)
    .leftJoin(agentPin, and(eq(agentPin.agentId, agentTable.id), eq(agentPin.userId, userId)))
    .leftJoin(starter, eq(starter.id, agentTable.userId))
    .leftJoin(
      starterPilot,
      and(
        eq(starterPilot.id, agentTable.startedByAgentId),
        eq(starterPilot.kind, AGENT_KIND.PILOT),
      ),
    )
    .leftJoin(archiver, eq(archiver.id, sql`${agentTable.archivedBy} ->> 'userId'`))
    .leftJoin(conversations, eq(conversations.id, agentTable.conversationId))
    .leftJoin(device, eq(device.id, agentTable.deviceId))
    .leftJoinLateral(latest, sql`true`)
    .where(
      // An agent on a task is listed only where the account reaches the task too, as a read of it by its id is.
      agentVisibleTo(userId),
    );
}

/** The plan list written for Neon Realtime for the account; none where a statement names a value Realtime cannot carry. */
export function taskListLiveStatements(userId: string): Option.Option<TaskListLiveStatements> {
  return Option.all({
    plans: liveStatementOf(tasksStatement(userId)),
    agents: liveStatementOf(agentsStatement(userId)),
    issues: liveStatementOf(issuesStatement()),
  });
}
