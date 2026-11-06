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

/**
 * task-list-live.ts -- the plan list written for Neon Realtime: the plans the account reaches, and every agent of them and with no plan, with what the list reads each agent's status from.
 *
 * Two statements, each the same rows and rule of who may read them as the
 * held read (`tasks-app.ts`'s collection, through `listTasks`,
 * `withTaskAgents`, and `listTasklessAgents`), with every archived plan
 * and agent among them, as the desktop asks for them: the plans with the
 * reader's own pin and read mark and the owner's name, and the agents with their newest
 * turn, the pilot that started each where one did, when the newest line
 * of the developer's awaiting its turn was written and whether that turn's session ended, when the newest turn to end
 * ended, what each last published, the harness its conversation runs on, the
 * Mac a local one runs on, and the names of the members each names. A third, the issues
 * the plans linked, answers no rows now that a plan links none, and stands
 * because a released desktop follows it. Every column stands
 * under the key `@repo/features/task-list-live` reads it by and every
 * instant as epoch milliseconds. Nothing here reads the clock: an agent's
 * status, which turns on it, is the reader's to read, and so is the order,
 * since Realtime keeps none.
 *
 * A reader past a sync id is read the same statements narrowed to the rows
 * what moved could move (`taskListDeltaStatements`): a plan whose own row,
 * pin, read mark, or block moved, that a moved plan blocks, or that names a
 * moved member, and an agent whose own row, pin, or read mark moved, whose turn or
 * conversation moved, whose plan moved, that names a moved member or Mac,
 * or that a moved pilot or run started. Each keeps its rule of who reads it,
 * so a key another workspace's write moved reads no row.
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
 * owner's name, whether it waits on an open task the account reaches
 * (`taskBlockedFor`), and whether an automation's run made it for itself
 * (`taskMadeByRun`), which the run names in the transaction that inserts the
 * task (`automation-runs.ts`'s `runTaskOf`), so the plan's own row moving
 * reads it. Note that `archivedAt` is still answered, as null, because
 * a desktop from before #4541 decodes a row without it as no row: no
 * plan is archived any more, and the column is dropped. The key goes with
 * the minimum supported desktop version, not with a service deploy, since a
 * desktop stays old far longer than a service build runs.
 */
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
 * its own presence read. Note too that a pilot is said by a column of its own.
 */
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
    .where(
      // An agent on a task is listed only where the account reaches the task too, as a read of it by its id is.
      and(agentVisibleTo(userId), narrowed),
    );
}

/** The plans what moved could move: their own rows, the reader's pins and read marks, a block either way, a plan a moved plan blocks, and a plan naming a moved member. */
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

/**
 * The agents what moved could move: their own rows and the reader's pins and read marks,
 * those whose turn or conversation moved, those of a moved plan, those
 * naming a moved member or Mac, and those a moved pilot or run started.
 */
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

/** The plan list written for Neon Realtime for the account; none where a statement names a value Realtime cannot carry. */
export function taskListLiveStatements(userId: string): Option.Option<TaskListLiveStatements> {
  return Option.all({
    plans: liveStatementOf(tasksStatement(userId)),
    agents: liveStatementOf(agentsStatement(userId)),
    issues: liveStatementOf(issuesStatement()),
  });
}

/** The plan list narrowed to the rows what moved past a reader's sync id could move; none where a statement names a value Realtime cannot carry. */
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
