import assert from "node:assert/strict";
import { CODING_AGENT_STATUS } from "@luke/features/coding-agent-wire";
import type { TaskAgentLine, TaskSummary } from "@luke/features/task-wire";
import { test } from "vitest";
import { agentStarter, personPage, personPageEmpty, personRef } from "./person-page-model.js";

/**
 * A person's page lists what of theirs the listed workspace's task list
 * holds: their agents at work, the tasks they created, and their other
 * agents, each newest first, and nobody else's. Synthetic accounts.
 */

const CHARLES = { userId: "user-charles", name: "Charles Pan" };
const DANA = { userId: "user-dana", name: "Dana Reyes" };

function agent(
  n: number,
  startedBy: typeof CHARLES | undefined,
  status: TaskAgentLine["status"],
  at: number,
): TaskAgentLine {
  const line: TaskAgentLine = {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    title: `Agent ${n}`,
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    status,
    at,
  };
  return startedBy === undefined ? line : { ...line, startedBy };
}

function task(
  n: number,
  name: string,
  updatedAt: number,
  createdBy: typeof CHARLES,
  agents: readonly TaskAgentLine[] = [],
): TaskSummary {
  const summary: TaskSummary = {
    id: `11111111-0000-4000-8000-${String(n).padStart(12, "0")}`,
    workspaceId: "workspace-acme",
    name,
    createdAt: 1,
    updatedAt,
    repository: "acme/relay",
    ownerId: createdBy.userId,
    createdBy,
  };
  if (agents.length === 0) return summary;
  return {
    ...summary,
    agents: {
      total: agents.length,
      working: agents.filter((each) => each.status === CODING_AGENT_STATUS.RUNNING).length,
      agents,
      pullRequestTotal: 0,
      pullRequests: [],
    },
  };
}

const RUNNING = agent(1, CHARLES, CODING_AGENT_STATUS.RUNNING, 900);
const STARTING = agent(2, CHARLES, CODING_AGENT_STATUS.STARTING, 950);
const DONE = agent(3, CHARLES, CODING_AGENT_STATUS.COMPLETED, 400);
const DANAS = agent(4, DANA, CODING_AGENT_STATUS.RUNNING, 990);
const UNNAMED = agent(5, undefined, CODING_AGENT_STATUS.RUNNING, 999);

const RETRIES = task(1, "Relay retries", 500, CHARLES, [RUNNING, DANAS]);
const CACHE = task(2, "Cache keys", 800, DANA, [STARTING, DONE, UNNAMED]);
const DASHBOARD = task(3, "Retry dashboard", 100, CHARLES);
const TASKS = [DASHBOARD, RETRIES, CACHE];

test("a person's agents at work and their other agents are theirs alone, newest first, wherever the task is", () => {
  const page = personPage(CHARLES.userId, TASKS);

  assert.deepEqual(
    page.working.map(({ plan: summary, agent }) => [summary.name, agent.title]),
    [
      ["Cache keys", "Agent 2"],
      ["Relay retries", "Agent 1"],
    ],
  );
  assert.deepEqual(
    page.agents.map(({ agent }) => agent.title),
    ["Agent 3"],
  );
});

test("a person's tasks are those they created, the latest updated first", () => {
  assert.deepEqual(
    personPage(CHARLES.userId, TASKS).created.map((summary) => summary.name),
    ["Relay retries", "Retry dashboard"],
  );
  assert.deepEqual(
    personPage(DANA.userId, TASKS).created.map((summary) => summary.name),
    ["Cache keys"],
  );
});

test("someone with nothing in the list has an empty page, and someone with anything does not", () => {
  assert.equal(personPageEmpty(personPage("user-sam", TASKS)), true);
  assert.equal(personPageEmpty(personPage(DANA.userId, TASKS)), false);
});

test("an item's agent is matched to whoever the task's row says started it, and to nobody where the row does not name it", () => {
  assert.equal(agentStarter(RETRIES, RUNNING.id), CHARLES.userId);
  assert.equal(agentStarter(CACHE, UNNAMED.id), undefined);
  assert.equal(agentStarter(DASHBOARD, RUNNING.id), undefined);
});

test("a person is named as the list names them, by a task they created or an agent they started, and nobody else is", () => {
  assert.deepEqual(personRef(DANA.userId, TASKS), DANA);
  assert.deepEqual(personRef(CHARLES.userId, [CACHE]), CHARLES);
  assert.equal(personRef("user-sam", TASKS), undefined);
});
