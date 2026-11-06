import assert from "node:assert/strict";
import { AGENT_STATUS, type AgentSummary } from "@repo/features/agent-wire";
import type { TaskAgentLine, TaskSummary } from "@repo/features/task-wire";
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
  assignee?: typeof CHARLES,
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
    ...(assignee === undefined ? undefined : { assignee }),
  };
  if (agents.length === 0) return summary;
  return {
    ...summary,
    agents: {
      total: agents.length,
      working: agents.filter((each) => each.status === AGENT_STATUS.RUNNING).length,
      agents,
      pullRequestTotal: 0,
      pullRequests: [],
    },
  };
}

/** An agent as the list follows it live, on `task`, from its row's line. */
function followed(line: TaskAgentLine, task: TaskSummary): AgentSummary {
  const { at, startedBy, ...rest } = line;
  const summary: AgentSummary = { ...rest, planId: task.id, createdAt: at ?? 0, turnId: null };
  return startedBy === undefined ? summary : { ...summary, startedBy };
}

const RUNNING = agent(1, CHARLES, AGENT_STATUS.RUNNING, 900);
const STARTING = agent(2, CHARLES, AGENT_STATUS.STARTING, 950);
const DONE = agent(3, CHARLES, AGENT_STATUS.COMPLETED, 400);
const DANAS = agent(4, DANA, AGENT_STATUS.RUNNING, 990);
const UNNAMED = agent(5, undefined, AGENT_STATUS.RUNNING, 999);

const RETRIES = task(1, "Relay retries", 500, CHARLES, [RUNNING, DANAS]);
const CACHE = task(2, "Cache keys", 800, DANA, [STARTING, DONE, UNNAMED]);
const DASHBOARD = task(3, "Retry dashboard", 100, CHARLES);
const TASKS = [DASHBOARD, RETRIES, CACHE];
/** Every agent the list follows live: those the rows name, and one of Charles's a busy row no longer names. */
const OLDER = followed(agent(6, CHARLES, AGENT_STATUS.COMPLETED, 200), RETRIES);
const AGENTS = [
  ...[RUNNING, DANAS].map((line) => followed(line, RETRIES)),
  ...[STARTING, DONE, UNNAMED].map((line) => followed(line, CACHE)),
  OLDER,
];

test("a person's agents at work and their other agents are theirs alone, newest first, wherever the task is, those a row no longer names among them", () => {
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
  const handedToDana = task(4, "Cache eviction", 700, CHARLES, [], DANA);
  const ownedByCharles = task(5, "Relay timeouts", 300, CHARLES, [], CHARLES);
  const handedToCharles = task(6, "Dashboard copy", 600, DANA, [], CHARLES);
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
  const sams = personPage(SAM.userId, [task(7, "Flaky test", 50, DANA, [], SAM)], []);
  assert.deepEqual(
    sams.assigned.map((summary) => summary.name),
    ["Flaky test"],
  );
  assert.equal(personPageEmpty(sams), false);
  assert.deepEqual(personRef(SAM.userId, [task(7, "Flaky test", 50, DANA, [], SAM)]), SAM);
});

test("someone with nothing in the list has an empty page, and someone with anything does not", () => {
  assert.equal(personPageEmpty(personPage("user-sam", TASKS, AGENTS)), true);
  assert.equal(personPageEmpty(personPage(DANA.userId, TASKS, AGENTS)), false);
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
