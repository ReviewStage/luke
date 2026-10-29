import assert from "node:assert/strict";
import {
  TASK_MODE,
  TASK_STATUS,
  type TaskStatus,
  type TaskSummary,
} from "@luke/features/task-wire";
import { test } from "vitest";
import { waitingChildTasks } from "./pilot-breakdown.js";

/**
 * pilot-breakdown.test.ts -- which of a pilot task's child tasks wait to
 * start.
 */

const PARENT = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const OTHER = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";

function child(
  name: string,
  number: number,
  status: TaskStatus,
  extra: Partial<TaskSummary> = {},
): TaskSummary {
  return {
    id: `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`,
    workspaceId: "workspace",
    name,
    createdAt: number,
    updatedAt: number,
    repository: "acme/app",
    parentTaskId: PARENT,
    status,
    number,
    ...extra,
  };
}

test("a pilot task waits on its children in todo with no agent, in the order made, and a task worked by its agents waits on none", () => {
  const started = {
    total: 1,
    working: 1,
    agents: [],
    pullRequestTotal: 0,
    pullRequests: [],
  };
  const tasks = [
    child("Approve button", 12, TASK_STATUS.TODO),
    child("Sidebar nesting", 11, TASK_STATUS.TODO),
    child("Merge switch", 13, TASK_STATUS.TODO, { agents: started }),
    child("Blocked mark", 14, TASK_STATUS.IN_PROGRESS),
    child("Schema", 15, TASK_STATUS.BACKLOG),
    child("Elsewhere", 16, TASK_STATUS.TODO, { parentTaskId: OTHER }),
  ];
  const names = (waiting: readonly TaskSummary[]) => waiting.map((each) => each.name);
  assert.deepEqual(names(waitingChildTasks({ id: PARENT, mode: TASK_MODE.PILOT }, tasks)), [
    "Sidebar nesting",
    "Approve button",
  ]);
  assert.deepEqual(names(waitingChildTasks({ id: PARENT, mode: TASK_MODE.AGENT }, tasks)), []);
});
