import assert from "node:assert/strict";
import { AGENT_STATUS, type ListedAgent } from "@repo/features/agent-wire";
import type { TaskSummary } from "@repo/features/task-wire";
import { test } from "vitest";
import { agentStarter, personPage, personPageEmpty, personRef } from "./person-page-model.js";

/**
 * A person's page lists what of theirs the listed workspace's task list
 * holds: their agents at work, the tasks assigned to them, the rest of the
 * tasks they created, and their other agents, each newest first, and
 * nobody else's, the agents from those the list follows live. Synthetic
 * accounts.
 */

const CHARLES = { userId: "user-charles", name: "Charles Pan" };
const DANA = { userId: "user-dana", name: "Dana Reyes" };

function task(
  n: number,
  name: string,
  updatedAt: number,
  createdBy: typeof CHARLES,
  assignee?: typeof CHARLES,
): TaskSummary {
  return {
    id: `11111111-0000-4000-8000-${String(n).padStart(12, "0")}`,
    workspaceId: "workspace-acme",
    name,
    createdAt: 1,
    updatedAt,
    repository: "acme/relay",
    ownerId: createdBy.userId,
    createdBy,
    ...(assignee === undefined ? undefined : { assignee }),
  };
}

/** An agent as the list follows it live, on `task`, which last moved at `at`: its run's start while it works, its newest turn's end once it has. */
function agent(
  n: number,
  on: TaskSummary,
  startedBy: typeof CHARLES | undefined,
  status: ListedAgent["status"],
  at: number,
): ListedAgent {
  const working = status === AGENT_STATUS.RUNNING || status === AGENT_STATUS.STARTING;
  const listed: ListedAgent = {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    planId: on.id,
    title: `Agent ${n}`,
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    status,
    createdAt: n,
    turnId: null,
    workspaceId: on.workspaceId,
    repository: on.repository,
    ...(working ? { runStartedAt: at } : { settledAt: at }),
  };
  return startedBy === undefined ? listed : { ...listed, startedBy };
}

const RETRIES = task(1, "Relay retries", 500, CHARLES);
const CACHE = task(2, "Cache keys", 800, DANA);
const DASHBOARD = task(3, "Retry dashboard", 100, CHARLES);
const TASKS = [DASHBOARD, RETRIES, CACHE];

const RUNNING = agent(1, RETRIES, CHARLES, AGENT_STATUS.RUNNING, 900);
const STARTING = agent(2, CACHE, CHARLES, AGENT_STATUS.STARTING, 950);
const DONE = agent(3, CACHE, CHARLES, AGENT_STATUS.COMPLETED, 400);
const DANAS = agent(4, RETRIES, DANA, AGENT_STATUS.RUNNING, 990);
const UNNAMED = agent(5, CACHE, undefined, AGENT_STATUS.RUNNING, 999);
/** Charles's oldest agent on a task with four, which a row naming three left out. */
const OLDER = agent(6, RETRIES, CHARLES, AGENT_STATUS.COMPLETED, 200);
const DANAS_REVIEW = agent(7, RETRIES, DANA, AGENT_STATUS.COMPLETED, 600);
/** Every agent the list follows live. */
const AGENTS = [RUNNING, DANAS, DANAS_REVIEW, OLDER, STARTING, DONE, UNNAMED];

test("a person's agents at work and their other agents are theirs alone, newest first, wherever the task is", () => {
  const page = personPage(CHARLES.userId, TASKS, AGENTS);

  assert.deepEqual(
    page.working.map(({ task: summary, agent }) => [summary.name, agent.title]),
    [
      ["Cache keys", "Agent 2"],
      ["Relay retries", "Agent 1"],
    ],
  );
  assert.deepEqual(
    page.agents.map(({ agent }) => agent.title),
    ["Agent 3", "Agent 6"],
  );
});

test("a person's tasks are those they created, the latest updated first", () => {
  assert.deepEqual(
    personPage(CHARLES.userId, TASKS, AGENTS).created.map((summary) => summary.name),
    ["Relay retries", "Retry dashboard"],
  );
  assert.deepEqual(
    personPage(DANA.userId, TASKS, AGENTS).created.map((summary) => summary.name),
    ["Cache keys"],
  );
});

test("a person's tasks assigned to them come apart from those they created, the latest first, one both listed once as assigned", () => {
  const SAM = { userId: "user-sam", name: "Sam Ortiz" };
  const handedToDana = task(4, "Cache eviction", 700, CHARLES, DANA);
  const ownedByCharles = task(5, "Relay timeouts", 300, CHARLES, CHARLES);
  const handedToCharles = task(6, "Dashboard copy", 600, DANA, CHARLES);
  const tasks = [...TASKS, handedToDana, ownedByCharles, handedToCharles];

  const charles = personPage(CHARLES.userId, tasks, AGENTS);
  assert.deepEqual(
    charles.assigned.map((summary) => summary.name),
    ["Dashboard copy", "Relay timeouts"],
  );
  assert.deepEqual(
    charles.created.map((summary) => summary.name),
    ["Cache eviction", "Relay retries", "Retry dashboard"],
  );
  // Someone the list names only as an assignee has a page of what they are on, and is named by it.
  const sams = personPage(SAM.userId, [task(7, "Flaky test", 50, DANA, SAM)], []);
  assert.deepEqual(
    sams.assigned.map((summary) => summary.name),
    ["Flaky test"],
  );
  assert.equal(personPageEmpty(sams), false);
  assert.deepEqual(personRef(SAM.userId, [task(7, "Flaky test", 50, DANA, SAM)], []), SAM);
});

test("someone with nothing in the list has an empty page, and someone with anything does not", () => {
  assert.equal(personPageEmpty(personPage("user-sam", TASKS, AGENTS)), true);
  assert.equal(personPageEmpty(personPage(DANA.userId, TASKS, AGENTS)), false);
});

test("an item's agent is matched to whoever started it, the fourth agent of a task among them, and to nobody where none is named", () => {
  assert.equal(agentStarter(AGENTS, OLDER.id), CHARLES.userId);
  assert.equal(agentStarter(AGENTS, UNNAMED.id), undefined);
});

test("a person is named as the list names them, by a task they created or an agent they started, and nobody else is", () => {
  assert.deepEqual(personRef(DANA.userId, TASKS, AGENTS), DANA);
  assert.deepEqual(personRef(CHARLES.userId, [CACHE], AGENTS), CHARLES);
  assert.equal(personRef("user-sam", TASKS, AGENTS), undefined);
});
