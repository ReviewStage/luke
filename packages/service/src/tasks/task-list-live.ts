import {
  type LiveStatement,
  liveKeysIn,
  liveSelection,
  liveStatementOf,
} from "@repo/database/core/live-statement";
import { queryBuilder } from "@repo/database/core/query";
import { taskMadeByRun } from "@repo/database/models/run-tasks";
import { taskBlockedFor } from "@repo/database/models/task-block-store";
import {
  AGENT_WORKSPACE,
  agentVisibleTo,
  taskReachableBy,
} from "@repo/database/models/workspace-store";
import {
  agentPin,
  agentRead,
  conversations,
  device,
  taskPin,
  taskRead,
} from "@repo/database/schemas";
import { agentTable } from "@repo/database/schemas/agent";
import { user } from "@repo/database/schemas/auth";
import { automationRun } from "@repo/database/schemas/automation";
import { task } from "@repo/database/schemas/task";
import { taskBlock } from "@repo/database/schemas/task-block";
import { TOPIC } from "@repo/database/sync/notification";
import {
  agentPinSync,
  agentReadSync,
  agentSync,
  automationRunSync,
  conversationsSync,
  deviceSync,
  messagesSync,
  taskBlockSync,
  taskPinSync,
  taskReadSync,
  taskSync,
  turnsSync,
  userSync,
} from "@repo/database/sync/tables";
import { AGENT_BRIEF, AGENT_KIND } from "@repo/features/agent-wire";
import { and, eq, isNotNull, or, type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Option } from "effect";
import {
  awaitingLineAtIn,
  lastSettledAtIn,
  latestTurnOf,
  sessionEndedOf,
} from "../live/agent-standing.js";
import type { SyncMoved } from "../sync/live-query.js";

const starter = alias(user, "starter");
const archiver = alias(user, "archiver");
const assignee = alias(user, "assignee");
const starterPilot = alias(agentTable, "starter_pilot");

export interface TaskListLiveStatements {
  readonly plans: LiveStatement;
  readonly agents: LiveStatement;
  readonly issues: LiveStatement;
}

function tasksStatement(userId: string, narrowed: SQL = sql`true`) {
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
          blocked: taskBlockedFor(userId),
          madeByRun: taskMadeByRun(task.id),
          markedUnread: sql<boolean>`coalesce(${taskRead.markedUnread}, false)`,
        },
        {
          pinnedAt: taskPin.pinnedAt,
          readThrough: sql`coalesce(${taskRead.readThrough}, ${task.readThrough}, ${task.createdAt})`,
          completedAt: task.completedAt,
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
        },
      ),
    )
    .from(task)
    .leftJoin(taskPin, and(eq(taskPin.taskId, task.id), eq(taskPin.userId, userId)))
    .leftJoin(taskRead, and(eq(taskRead.taskId, task.id), eq(taskRead.userId, userId)))
    .leftJoin(user, eq(user.id, task.userId))
    .leftJoin(assignee, eq(assignee.id, task.assigneeId))
    .where(and(taskReachableBy(userId), narrowed));
}

function issuesStatement() {
  return queryBuilder
    .select(liveSelection({ id: task.id }))
    .from(task)
    .where(sql`false`);
}

function agentsStatement(userId: string, narrowed: SQL = sql`true`) {
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
          brief: sql<string>`case when ${agentTable.prompt} is not null then ${AGENT_BRIEF.PROMPT} when ${agentTable.descriptionSnapshot} is not null then ${AGENT_BRIEF.DESCRIPTION} else ${AGENT_BRIEF.BLANK} end`,
          repository: agentTable.repository,
          starterId: agentTable.userId,
          starterName: starter.name,
          starterPilotId: starterPilot.id,
          starterPilotTaskId: starterPilot.taskId,
          starterPilotTitle: starterPilot.title,
          starterPilotModel: starterPilot.model,
          automationId: agentTable.automationId,
          automationName: sql<string | null>`${agentTable.automationOrigin} ->> 'name'`,
          runId: agentTable.automationRunId,
          runAutomationId: automationRun.automationId,
          archivedBy: agentTable.archivedBy,
          archiverName: archiver.name,
          disabledServers: agentTable.disabledServers,
          published: agentTable.published,
          startedFrom: agentTable.startedFrom,
          source: agentTable.source,
          runtime: conversations.runtime,
          machine: agentTable.machine,
          deviceId: agentTable.deviceId,
          deviceName: device.name,
          pinPosition: agentPin.position,
          turnId: latest.id,
          turnStatus: latest.status,
          cancelRequested: isNotNull(latest.cancelRequestedAt),
          turnSessionEnded: sessionEndedOf(latest),
          pilot: sql<boolean>`${agentTable.kind} = ${AGENT_KIND.PILOT}`,
          markedUnread: sql<boolean>`coalesce(${agentRead.markedUnread}, false)`,
        },
        {
          archivedAt: agentTable.archivedAt,
          pinnedAt: agentPin.pinnedAt,
          readThrough: sql`coalesce(${agentRead.readThrough}, ${agentTable.readThrough}, ${agentTable.createdAt})`,
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
    .leftJoin(agentRead, and(eq(agentRead.agentId, agentTable.id), eq(agentRead.userId, userId)))
    .leftJoin(starter, eq(starter.id, agentTable.userId))
    .leftJoin(
      starterPilot,
      and(
        eq(starterPilot.id, agentTable.startedByAgentId),
        eq(starterPilot.kind, AGENT_KIND.PILOT),
      ),
    )
    .leftJoin(automationRun, eq(automationRun.id, agentTable.automationRunId))
    .leftJoin(archiver, eq(archiver.id, sql`${agentTable.archivedBy} ->> 'userId'`))
    .leftJoin(conversations, eq(conversations.id, agentTable.conversationId))
    .leftJoin(device, eq(device.id, agentTable.deviceId))
    .leftJoinLateral(latest, sql`true`)
    .where(and(agentVisibleTo(userId), narrowed));
}

function movedPlans(moved: SyncMoved): SQL {
  const plans = moved.keys(taskSync, task.id);
  const members = moved.keys(userSync, user.id);
  const blockedByMoved = sql`(${queryBuilder
    .select({ id: taskBlock.blockedTaskId })
    .from(taskBlock)
    .where(liveKeysIn(taskBlock.blockerTaskId, plans))})`;
  return (
    or(
      liveKeysIn(task.id, [
        ...plans,
        ...moved.keys(taskPinSync, taskPin.taskId),
        ...moved.keys(taskReadSync, taskRead.taskId),
        ...moved.keys(taskBlockSync, taskBlock.blockedTaskId),
      ]),
      sql`${task.id} in ${blockedByMoved}`,
      liveKeysIn(task.userId, members),
      liveKeysIn(task.assigneeId, members),
    ) ?? sql`false`
  );
}

function movedAgents(moved: SyncMoved): SQL {
  const agents = moved.keys(agentSync, agentTable.id);
  const members = moved.keys(userSync, user.id);
  return (
    or(
      liveKeysIn(agentTable.id, [
        ...agents,
        ...moved.keys(agentPinSync, agentPin.agentId),
        ...moved.keys(agentReadSync, agentRead.agentId),
        ...moved.topics(turnsSync, TOPIC.AGENT),
      ]),
      liveKeysIn(agentTable.conversationId, [
        ...moved.topics(messagesSync, TOPIC.CONVERSATION),
        ...moved.topics(conversationsSync, TOPIC.CONVERSATION),
      ]),
      liveKeysIn(agentTable.taskId, moved.keys(taskSync, task.id)),
      liveKeysIn(agentTable.userId, members),
      liveKeysIn(sql`${agentTable.archivedBy} ->> 'userId'`, members),
      liveKeysIn(agentTable.deviceId, moved.keys(deviceSync, device.id)),
      liveKeysIn(agentTable.startedByAgentId, agents),
      liveKeysIn(agentTable.automationRunId, moved.keys(automationRunSync, automationRun.id)),
    ) ?? sql`false`
  );
}

export function taskListLiveStatements(userId: string): Option.Option<TaskListLiveStatements> {
  return Option.all({
    plans: liveStatementOf(tasksStatement(userId)),
    agents: liveStatementOf(agentsStatement(userId)),
    issues: liveStatementOf(issuesStatement()),
  });
}

export function taskListDeltaStatements(
  userId: string,
  moved: SyncMoved,
): Option.Option<TaskListLiveStatements> {
  return Option.all({
    plans: liveStatementOf(tasksStatement(userId, movedPlans(moved))),
    agents: liveStatementOf(agentsStatement(userId, movedAgents(moved))),
    issues: liveStatementOf(issuesStatement()),
  });
}
