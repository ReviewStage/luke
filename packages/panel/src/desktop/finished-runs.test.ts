import assert from "node:assert/strict";
import {
  AGENT_STATUS,
  CHECK_SUMMARY,
  PULL_REQUEST_STATE,
  type PullRequestState,
  type TasklessAgent,
} from "@repo/features/agent-wire";
import type { TaskAgentsSummary, TaskSummary } from "@repo/features/task-wire";
import { describe, it } from "vitest";
import {
  type RunsHeld,
  type RunTasksHeld,
  withoutFinishedRunTasks,
  withoutFinishedRuns,
} from "./finished-runs.js";

const ME = "user-me";
const ADA = "user-ada";

const RUN: TasklessAgent = {
  id: "4b2e7c1d-9a3f-4e6b-8c5d-1f0a2b3c4d5e",
  planId: null,
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "Remove the stale copy",
  createdAt: 1,
  status: AGENT_STATUS.COMPLETED,
  turnId: null,
  automationId: "7d6c5b4a-3f2e-4d1c-8b0a-9f8e7d6c5b4a",
  automationName: "Copy sweep",
  workspaceId: "workspace-1",
  repository: "acme/relay",
  activityAt: 2,
};

const { automationName: _automationName, ...UNNAMED } = RUN;
const BY_HAND: TasklessAgent = { ...UNNAMED, automationId: null };

const NOTHING_HELD: RunsHeld = { unseen: () => false, inbox: [], me: ME, shown: undefined };

function withPullRequest(state: PullRequestState): TasklessAgent {
  return {
    ...RUN,
    pullRequest: {
      number: 42,
      title: "Remove the stale copy",
      url: "https://github.com/acme/relay/pull/42",
      state,
      checks: CHECK_SUMMARY.PASSING,
    },
  };
}

function standing(agent: TasklessAgent, held: RunsHeld): readonly string[] {
  return withoutFinishedRuns([agent], held).map((each) => each.id);
}

describe("an automation's finished runs under Tasks", () => {
  it("leaves a run that finished and holds nothing, even with a teammate's question open on it or its pull request merged", () => {
    const held: RunsHeld = {
      ...NOTHING_HELD,
      inbox: [{ agentId: RUN.id, startedBy: ADA, waitsOn: ADA }],
    };
    assert.deepEqual(standing(withPullRequest(PULL_REQUEST_STATE.MERGED), held), []);
  });

  it("leaves a finished run of an automation since deleted, which names it still", () => {
    const orphaned = { ...RUN, automationId: null };
    assert.deepEqual(standing(orphaned, NOTHING_HELD), []);
  });

  it.each<[string, TasklessAgent, RunsHeld]>([
    ["still working", { ...RUN, status: AGENT_STATUS.RUNNING }, NOTHING_HELD],
    ["started by hand", BY_HAND, NOTHING_HELD],
    ["ended unseen", RUN, { ...NOTHING_HELD, unseen: (id) => id === RUN.id }],
    [
      "waiting on the reader in the Inbox",
      RUN,
      { ...NOTHING_HELD, inbox: [{ agentId: RUN.id, startedBy: ADA, waitsOn: ME }] },
    ],
    ["with its pull request open", withPullRequest(PULL_REQUEST_STATE.OPEN), NOTHING_HELD],
    ["shown", RUN, { ...NOTHING_HELD, shown: RUN.id }],
  ])("keeps a run %s", (_, agent, held) => {
    assert.deepEqual(standing(agent, held), [RUN.id]);
  });
});

const FAILED_RUN_AGENTS: TaskAgentsSummary = {
  total: 1,
  working: 0,
  failed: 1,
  agents: [
    { id: RUN.id, title: null, model: RUN.model, effort: RUN.effort, status: AGENT_STATUS.FAILED },
  ],
  pullRequestTotal: 0,
  pullRequests: [],
};

const RUN_TASK: TaskSummary = {
  id: "9c8b7a6f-5e4d-4c3b-8a29-1f0e9d8c7b6a",
  workspaceId: "workspace-1",
  name: "Copy sweep · Nov 4, 9:00",
  createdAt: 1,
  updatedAt: 2,
  repository: "acme/relay",
  madeByRun: true,
  agents: FAILED_RUN_AGENTS,
};

const { madeByRun: _madeByRun, ...BY_MEMBER } = RUN_TASK;

const NO_TASK_HELD: RunTasksHeld = { unread: () => false, inbox: [], shown: () => false };

function taskWithPullRequest(state: PullRequestState): TaskSummary {
  const pullRequest = {
    number: 42,
    title: "Remove the stale copy",
    state,
    checks: CHECK_SUMMARY.PASSING,
    additions: 3,
    deletions: 1,
  };
  return {
    ...RUN_TASK,
    agents: { ...FAILED_RUN_AGENTS, pullRequestTotal: 1, pullRequests: [pullRequest] },
  };
}

function tasksStanding(task: TaskSummary, held: RunTasksHeld): readonly string[] {
  return withoutFinishedRunTasks([task], held).map((each) => each.id);
}

describe("the tasks an automation's runs made under Tasks", () => {
  it("leaves a run's task once its run failed and nothing holds it", () => {
    assert.deepEqual(tasksStanding(RUN_TASK, NO_TASK_HELD), []);
  });

  it.each<[string, TaskSummary, RunTasksHeld]>([
    ["no run made", BY_MEMBER, NO_TASK_HELD],
    [
      "whose run still works",
      { ...RUN_TASK, agents: { ...FAILED_RUN_AGENTS, working: 1 } },
      NO_TASK_HELD,
    ],
    ["unread", RUN_TASK, { ...NO_TASK_HELD, unread: (task) => task.id === RUN_TASK.id }],
    [
      "waiting on the reader in the Inbox",
      RUN_TASK,
      { ...NO_TASK_HELD, inbox: [{ taskId: RUN_TASK.id }] },
    ],
    ["with a pull request open", taskWithPullRequest(PULL_REQUEST_STATE.OPEN), NO_TASK_HELD],
    ["shown", RUN_TASK, { ...NO_TASK_HELD, shown: (taskId) => taskId === RUN_TASK.id }],
  ])("keeps a task %s", (_, task, held) => {
    assert.deepEqual(tasksStanding(task, held), [RUN_TASK.id]);
  });
});
