/**
 * task-list-rows.ts -- the task list's rows as its statements deliver them, for a host test.
 */

import { AGENT_BRIEF } from "@repo/features/agent-wire";
import { TASK_PRIORITY, TASK_STATUS } from "@repo/features/task-wire";
import type { AgentRow, PlanRow } from "../task-list-collections.js";

/** One plan as the plans statement delivers its row, unpinned, unassigned, and still to do. */
export function planListRow(id: string, name: string): PlanRow {
  return {
    id,
    workspaceId: "workspace-personal",
    name,
    repository: null,
    ownerId: "user-dana",
    ownerName: "Dana",
    assigneeId: null,
    assigneeName: null,
    pinnedAt: null,
    pinPosition: null,
    createdAt: 1_000,
    updatedAt: 2_000,
    status: TASK_STATUS.TODO,
    priority: TASK_PRIORITY.NONE,
    number: 1,
  };
}

/** One agent of the plan, or of none, as the agents statement delivers its row, started at `createdAt`, with no turn yet. */
export function agentListRow(planId: string | null, createdAt: number): AgentRow {
  return {
    id: "3f1d2c4b-5a6e-4f70-8a91-b2c3d4e5f607",
    planId,
    workspaceId: "workspace-personal",
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    contextWindow: null,
    title: "Invite flow",
    brief: AGENT_BRIEF.PLAN,
    repository: "acme/relay",
    starterId: "user-dana",
    starterName: "Dana",
    automationId: null,
    automationName: null,
    archivedAt: null,
    archivedBy: null,
    archiverName: null,
    disabledServers: null,
    published: null,
    startedFrom: null,
    pinnedAt: null,
    pinPosition: null,
    createdAt,
    turnId: null,
    turnStatus: null,
    cancelRequested: null,
    queuedAt: null,
    startedAt: null,
    settledAt: null,
    turnSessionEnded: null,
    awaitingLineAt: null,
  };
}
