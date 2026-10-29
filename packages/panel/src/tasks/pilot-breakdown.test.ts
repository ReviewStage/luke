import assert from "node:assert/strict";
import { AGENT_KIND, AGENT_STATUS, type AgentSummary } from "@luke/features/agent-wire";
import {
  TASK_MODE,
  TASK_STATUS,
  type TaskStatus,
  type TaskSummary,
} from "@luke/features/task-wire";
import { test } from "vitest";
import { answerStands, taskPilot, waitingChildTasks } from "./pilot-breakdown.js";

/**
 * pilot-breakdown.test.ts -- which of a pilot task's child tasks wait for the
 * developer's go, which agent hears the answer, and how long an answer sent
 * stands in the buttons' place.
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

function agent(id: string, createdAt: number, extra: Partial<AgentSummary> = {}): AgentSummary {
  return {
    id,
    planId: PARENT,
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    title: null,
    createdAt,
    kind: AGENT_KIND.PILOT,
    status: AGENT_STATUS.COMPLETED,
    turnId: null,
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

test("the answer goes to the task's pilot not archived, so neither a pilot taken over by Continue nor another agent hears it", () => {
  const continued = agent("continued", 20);
  assert.equal(
    taskPilot([
      agent("first", 10, { archivedAt: 30 }),
      continued,
      agent("archived", 40, { archivedAt: 50 }),
      agent("coder", 60, { kind: AGENT_KIND.CODER }),
    ]),
    continued,
  );
  assert.equal(taskPilot([agent("first", 10, { archivedAt: 30 })]), undefined);
});

test("an answer stands until the turn that hears it ends, and a child added since brings the buttons back", () => {
  const waiting = [child("Approve button", 12, TASK_STATUS.TODO)];
  const children = [waiting[0]?.id ?? ""];
  const pilot = (turnId: string, status: AgentSummary["status"]) =>
    agent("pilot", 10, { turnId, status });
  // Sent to an idle pilot: the message waits on its turn, then its turn runs, then it ends.
  const opened = { agentId: "pilot", turnId: "turn-1", steered: false, children };
  assert.equal(answerStands(opened, pilot("turn-1", AGENT_STATUS.COMPLETED), waiting), true);
  assert.equal(answerStands(opened, pilot("turn-2", AGENT_STATUS.RUNNING), waiting), true);
  assert.equal(answerStands(opened, pilot("turn-2", AGENT_STATUS.COMPLETED), waiting), false);
  // Sent to a pilot at work: the message steers that turn, which ends on the same id.
  const steered = { agentId: "pilot", turnId: "turn-1", steered: true, children };
  assert.equal(answerStands(steered, pilot("turn-1", AGENT_STATUS.RUNNING), waiting), true);
  assert.equal(answerStands(steered, pilot("turn-1", AGENT_STATUS.COMPLETED), waiting), false);
  const added = [...waiting, child("Merge switch", 13, TASK_STATUS.TODO)];
  assert.equal(answerStands(opened, pilot("turn-2", AGENT_STATUS.RUNNING), added), false);
});
