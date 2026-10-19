import assert from "node:assert/strict";
import {
  CHECK_SUMMARY,
  CODING_AGENT_STATUS,
  PULL_REQUEST_STATE,
  type TasklessAgent,
} from "@luke/features/coding-agent-wire";
import { INBOX_RESPONSE, INBOX_STATUS, INBOX_WIRE_VERSION } from "@luke/features/inbox-wire";
import type {
  TaskAgentLine,
  TaskAgentsSummary,
  TaskPullRequestLine,
  TaskSummary,
} from "@luke/features/task-wire";
import type { AppInboxTask } from "@luke/host/app-state";
import { test } from "vitest";
import { INBOX_HOLDER, taskHolder } from "../tasks/inbox-model.js";
import {
  FACTORY_BLOCK,
  FACTORY_STOP,
  FACTORY_WORK,
  type FactoryInput,
  type FactoryStop,
  type FactoryWork,
  factoryBoard,
  factoryOneOffWaiting,
  factoryWaiting,
  LOOKBACK_MS,
} from "./factory-model.js";

const NOW = 1_800_000_000_000;
const MINUTE = 60_000;
const HOUR = 3_600_000;

/** A task saved `ago` before now, with the agents its row carries where it has any. */
function task(n: number, name: string, ago: number, agents?: TaskAgentsSummary): TaskSummary {
  const summary: TaskSummary = {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    workspaceId: "workspace-personal",
    name,
    createdAt: NOW - ago - HOUR,
    updatedAt: NOW - ago,
    repository: "acme/relay",
  };
  if (agents === undefined) return summary;
  return { ...summary, agents };
}

function agent(n: number, status: TaskAgentLine["status"], at = NOW - MINUTE): TaskAgentLine {
  return {
    id: `a0000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    title: `Agent ${n}`,
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    status,
    at,
  };
}

function pullRequest(
  number: number,
  state: TaskPullRequestLine["state"],
  checks: TaskPullRequestLine["checks"],
): TaskPullRequestLine {
  return { number, title: `PR ${number}`, state, checks, additions: 10, deletions: 2 };
}

/** What a task's row says of its agents and pull requests. */
function agents(
  lines: readonly TaskAgentLine[],
  pullRequests: readonly TaskPullRequestLine[] = [],
): TaskAgentsSummary {
  const working = lines.filter(
    (line) =>
      line.status === CODING_AGENT_STATUS.RUNNING || line.status === CODING_AGENT_STATUS.STARTING,
  ).length;
  return {
    total: lines.length,
    working,
    agents: lines,
    pullRequestTotal: pullRequests.length,
    pullRequests,
  };
}

function board(patch: Partial<FactoryInput>) {
  return factoryBoard({
    tasks: [],
    waiting: [],
    callTaskId: undefined,
    oneOff: [],
    oneOffWaiting: [],
    now: NOW,
    ...patch,
  });
}

/** Each row's task, or its automation for an agent with no task. */
const names = (rows: readonly (FactoryStop | FactoryWork | { readonly task: TaskSummary })[]) =>
  rows.map((row) => ("task" in row ? row.task.name : (row.agent.automationName ?? "no task")));

/** Build's work as a reader scans it: an agent by its title, a pull request by its number, each with its plan. */
const work = (rows: readonly FactoryWork[]) =>
  rows.map((row) =>
    row.kind === FACTORY_WORK.PULL_REQUEST
      ? `#${row.pullRequest.number} (${row.task.name})`
      : `${row.agent.title} (${row.kind === FACTORY_WORK.AGENT ? row.task.name : (row.agent.automationName ?? "no task")})`,
  );

/** What stops an agent as a reader scans it: a question by its words, a failure by its agent. */
const stops = (rows: readonly FactoryStop[]) =>
  rows.map((row) =>
    row.kind === FACTORY_STOP.QUESTION || row.kind === FACTORY_STOP.ONE_OFF_QUESTION
      ? row.item.title
      : `${row.agent.title} failed`,
  );

test("a task's agents at work stand in Build each on a row of their own, the latest moved first; a draft, an archived task, or a finished one stands nowhere", () => {
  const drawn = board({
    tasks: [
      task(1, "Usage alerts", 2 * HOUR),
      task(
        2,
        "Search across plans",
        5 * HOUR,
        agents([
          agent(2, CODING_AGENT_STATUS.COMPLETED),
          agent(1, CODING_AGENT_STATUS.RUNNING, NOW - 2 * MINUTE),
          agent(3, CODING_AGENT_STATUS.STARTING, NOW - MINUTE),
        ]),
      ),
      { ...task(4, "Shelved", MINUTE), archivedAt: NOW - MINUTE },
      task(5, "Finished research", HOUR, agents([agent(4, CODING_AGENT_STATUS.COMPLETED)])),
    ],
  });
  assert.deepEqual(drawn.talking, []);
  assert.deepEqual(work(drawn.working), [
    "Agent 3 (Search across plans)",
    "Agent 1 (Search across plans)",
  ]);
  assert.equal(drawn.agentsWorking, 2);
  assert.deepEqual(drawn.stopped, []);
  assert.deepEqual(drawn.blocked, []);
  assert.deepEqual(drawn.shipped, []);
});

test("the task on this Mac's call stands in Talk however long ago it was saved, even while its agents build it", () => {
  const call = task(
    1,
    "Factory tab",
    3 * LOOKBACK_MS,
    agents([agent(1, CODING_AGENT_STATUS.RUNNING)]),
  );
  const drawn = board({ tasks: [task(2, "Usage alerts", MINUTE), call], callTaskId: call.id });
  assert.deepEqual(names(drawn.talking.map((each) => ({ task: each }))), ["Factory tab"]);
  assert.deepEqual(work(drawn.working), ["Agent 1 (Factory tab)"]);
});

test("what stops an agent leads Build: each open Inbox item with its plan, the latest first, then each agent whose turn failed in the last day, the latest first", () => {
  const stalled = agent(1, CODING_AGENT_STATUS.COMPLETED);
  const billing = task(1, "Mercury payouts", 2 * HOUR, agents([stalled]));
  const invites = task(2, "Invitations", HOUR, agents([agent(2, CODING_AGENT_STATUS.RUNNING)]));
  const pooling = task(
    3,
    "Connection pooling",
    HOUR,
    agents([agent(5, CODING_AGENT_STATUS.FAILED, NOW - HOUR)]),
  );
  const push = task(
    4,
    "Mobile push",
    3 * HOUR,
    agents([agent(6, CODING_AGENT_STATUS.FAILED, NOW - 3 * HOUR)]),
  );
  const stale = task(
    5,
    "Old retry",
    2 * LOOKBACK_MS,
    agents([agent(7, CODING_AGENT_STATUS.FAILED, NOW - LOOKBACK_MS - MINUTE)]),
  );
  const waiting: AppInboxTask[] = [
    {
      taskId: billing.id,
      items: [
        {
          id: "i2",
          agentId: stalled.id,
          title: "Which account pays out?",
          postedAt: NOW - 2 * HOUR,
        },
      ],
    },
    {
      taskId: invites.id,
      items: [
        {
          id: "i1",
          agentId: "unlisted",
          title: "Expire invites after a week?",
          postedAt: NOW - 6 * MINUTE,
        },
      ],
    },
  ];
  const drawn = board({ tasks: [billing, invites, push, pooling, stale], waiting });
  assert.deepEqual(stops(drawn.stopped), [
    "Expire invites after a week?",
    "Which account pays out?",
    "Agent 5 failed",
    "Agent 6 failed",
  ]);
  assert.deepEqual(names(drawn.stopped), [
    "Invitations",
    "Mercury payouts",
    "Connection pooling",
    "Mobile push",
  ]);
  // A plan whose only agent is stalled stands in the wait alone, not among the work.
  assert.deepEqual(work(drawn.working), ["Agent 2 (Invitations)"]);
});

test("what stops a merge leads Ship: failing checks, then pull requests ready to merge (passing, or no checks to run); one in checks or a draft is still built, and a closed one stands nowhere", () => {
  const withPullRequest = (n: number, name: string, line: TaskPullRequestLine) =>
    task(
      n,
      name,
      HOUR,
      agents([agent(n, CODING_AGENT_STATUS.COMPLETED, NOW - n * MINUTE)], [line]),
    );
  const drawn = board({
    tasks: [
      withPullRequest(
        1,
        "Invitations",
        pullRequest(2505, PULL_REQUEST_STATE.OPEN, CHECK_SUMMARY.PASSING),
      ),
      withPullRequest(2, "Docs", pullRequest(2506, PULL_REQUEST_STATE.OPEN, CHECK_SUMMARY.NONE)),
      withPullRequest(
        3,
        "Board export",
        pullRequest(2516, PULL_REQUEST_STATE.OPEN, CHECK_SUMMARY.PENDING),
      ),
      withPullRequest(
        4,
        "Neon branches",
        pullRequest(2509, PULL_REQUEST_STATE.OPEN, CHECK_SUMMARY.FAILING),
      ),
      withPullRequest(
        5,
        "Draft",
        pullRequest(2511, PULL_REQUEST_STATE.DRAFT, CHECK_SUMMARY.PASSING),
      ),
      withPullRequest(
        6,
        "Abandoned",
        pullRequest(2490, PULL_REQUEST_STATE.CLOSED, CHECK_SUMMARY.PASSING),
      ),
    ],
  });
  assert.deepEqual(
    drawn.blocked.map((row) => [row.kind, row.pullRequest.number]),
    [
      [FACTORY_BLOCK.CHECKS, 2509],
      [FACTORY_BLOCK.MERGE, 2505],
      [FACTORY_BLOCK.MERGE, 2506],
    ],
  );
  assert.deepEqual(work(drawn.working), ["#2516 (Board export)", "#2511 (Draft)"]);
});

test("a pull request merged in the last day stands in Ship at its task's last activity, the latest first; one merged longer ago stands nowhere", () => {
  const merged = (n: number, name: string, ago: number) =>
    task(
      n,
      name,
      ago,
      agents(
        [agent(n, CODING_AGENT_STATUS.COMPLETED, NOW - ago)],
        [pullRequest(2500 + n, PULL_REQUEST_STATE.MERGED, CHECK_SUMMARY.PASSING)],
      ),
    );
  const drawn = board({
    tasks: [
      merged(1, "CSV export", 5 * HOUR),
      merged(2, "Tax IDs", 40 * MINUTE),
      merged(3, "Old export", LOOKBACK_MS + MINUTE),
    ],
  });
  assert.deepEqual(
    drawn.shipped.map((row) => [row.pullRequest.number, row.task.name, row.at]),
    [
      [2502, "Tax IDs", NOW - 40 * MINUTE],
      [2501, "CSV export", NOW - 5 * HOUR],
    ],
  );
  assert.deepEqual(drawn.blocked, []);
});

test("with nothing standing anywhere, the board is empty", () => {
  const drawn = board({ tasks: [task(1, "Old dashboard", 10 * LOOKBACK_MS)] });
  assert.deepEqual(drawn, {
    talking: [],
    stopped: [],
    working: [],
    blocked: [],
    shipped: [],
    agentsWorking: 0,
  });
});

test("an agent that failed before its first turn waits in Build as recent as its task's last activity, however old the task's last save", () => {
  const turnless: TaskAgentLine = {
    id: "a0000000-0000-4000-8000-000000000001",
    title: "Agent 1",
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    status: CODING_AGENT_STATUS.FAILED,
  };
  const old = task(1, "Old billing", 3 * LOOKBACK_MS, agents([turnless]));
  const started = task(1, "Old billing", 3 * LOOKBACK_MS, {
    ...agents([turnless]),
    activityAt: NOW - 5 * MINUTE,
  });
  assert.deepEqual(stops(board({ tasks: [started] }).stopped), ["Agent 1 failed"]);
  // With no activity of its own since, the old task's failure has aged out.
  assert.deepEqual(board({ tasks: [old] }).stopped, []);
});

test("a draft's failing checks are its own work still, standing in Build; only an open pull request's wait in Ship", () => {
  const withPullRequest = (n: number, name: string, line: TaskPullRequestLine) =>
    task(n, name, HOUR, agents([agent(n, CODING_AGENT_STATUS.COMPLETED)], [line]));
  const drawn = board({
    tasks: [
      withPullRequest(1, "Draft", pullRequest(42, PULL_REQUEST_STATE.DRAFT, CHECK_SUMMARY.FAILING)),
      withPullRequest(2, "Open", pullRequest(43, PULL_REQUEST_STATE.OPEN, CHECK_SUMMARY.FAILING)),
    ],
  });
  assert.deepEqual(
    drawn.blocked.map((row) => row.pullRequest.number),
    [43],
  );
  assert.deepEqual(work(drawn.working), ["#42 (Draft)"]);
});

test("what waits is every open item the Inbox read of the listed plans and main's own besides, an item both name standing once, and an agent's with no plan left to its own place", () => {
  const billing = task(1, "Mercury payouts", HOUR);
  const invites = task(2, "Invitations", HOUR);
  const item = (id: string, title: string) => ({
    id,
    agentId: "a1",
    key: id,
    revision: 1,
    version: INBOX_WIRE_VERSION,
    title,
    blocks: [],
    response: { type: INBOX_RESPONSE.TEXT },
    needsReply: true,
    status: INBOX_STATUS.OPEN,
    postedAt: NOW - HOUR,
    updatedAt: NOW - HOUR,
  });
  const waiting = factoryWaiting(
    [
      { holder: taskHolder(billing), item: item("i1", "Which account pays out?") },
      { holder: taskHolder(invites), item: item("i2", "Expire after a week?") },
      {
        holder: {
          kind: INBOX_HOLDER.AUTOMATION,
          automationId: null,
          name: "Nightly flake sweep",
          repository: "acme/relay",
          agents: new Map(),
        },
        item: item("i3", "Quarantine the flaky test?"),
      },
    ],
    [
      {
        taskId: billing.id,
        items: [
          { id: "i1", agentId: "a1", title: "Which account pays out?", postedAt: NOW - HOUR },
        ],
      },
      {
        taskId: invites.id,
        items: [{ id: "i4", agentId: "a2", title: "Send a reminder?", postedAt: NOW - MINUTE }],
      },
    ],
  );
  assert.deepEqual(
    waiting.map(({ taskId, items }) => [taskId, items.map((each) => each.title)]),
    [
      [billing.id, ["Which account pays out?"]],
      [invites.id, ["Expire after a week?", "Send a reminder?"]],
    ],
  );
});

/** An agent with no task, as the plan list carries it, its automation's name where it has one. */
function oneOff(
  n: number,
  status: TasklessAgent["status"],
  activityAt: number,
  automationName?: string,
): TasklessAgent {
  const agent: TasklessAgent = {
    id: `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    planId: null,
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    title: `Sweep ${n}`,
    createdAt: activityAt,
    status,
    turnId: null,
    automationId: null,
    workspaceId: "workspace-personal",
    repository: "acme/relay",
    activityAt,
  };
  return automationName === undefined ? agent : { ...agent, automationName };
}

test("an agent with no task stands in Build beside the tasks' agents: at work among the work, a failure in the last day and its open question among what waits, each by its automation", () => {
  const working = oneOff(1, CODING_AGENT_STATUS.RUNNING, NOW - 3 * MINUTE, "Nightly flake sweep");
  const failed = oneOff(2, CODING_AGENT_STATUS.FAILED, NOW - HOUR, "Dependency bumps");
  const stale = oneOff(3, CODING_AGENT_STATUS.FAILED, NOW - LOOKBACK_MS - MINUTE, "Old run");
  const asking = oneOff(4, CODING_AGENT_STATUS.COMPLETED, NOW - 10 * MINUTE);
  const drawn = board({
    tasks: [task(1, "Search", HOUR, agents([agent(1, CODING_AGENT_STATUS.RUNNING, NOW - MINUTE)]))],
    oneOff: [working, failed, stale, asking],
    oneOffWaiting: [
      {
        agentId: asking.id,
        item: {
          id: "q1",
          agentId: asking.id,
          title: "Quarantine the flaky test?",
          postedAt: NOW - 5 * MINUTE,
        },
      },
    ],
  });
  assert.deepEqual(work(drawn.working), ["Agent 1 (Search)", "Sweep 1 (Nightly flake sweep)"]);
  assert.deepEqual(stops(drawn.stopped), ["Quarantine the flaky test?", "Sweep 2 failed"]);
  assert.deepEqual(names(drawn.stopped), ["no task", "Dependency bumps"]);
  assert.equal(drawn.agentsWorking, 2);
});

test("the open items an agent with no task posted are read off the Inbox by their agent, a task's left to the task, and main's count stands in for an agent not read", () => {
  const item = (id: string, agentId: string) => ({
    id,
    agentId,
    key: id,
    revision: 1,
    version: INBOX_WIRE_VERSION,
    title: id,
    blocks: [],
    response: { type: INBOX_RESPONSE.TEXT },
    needsReply: true,
    status: INBOX_STATUS.OPEN,
    postedAt: NOW,
    updatedAt: NOW,
  });
  const read = factoryOneOffWaiting(
    [
      { holder: taskHolder(task(1, "Search", HOUR)), item: item("t1", "a1") },
      {
        holder: {
          kind: INBOX_HOLDER.AUTOMATION,
          automationId: null,
          name: "Nightly flake sweep",
          repository: "acme/relay",
          agents: new Map(),
        },
        item: item("o1", "c1"),
      },
    ],
    [
      { id: "o1", agentId: "c1", title: "o1", postedAt: NOW },
      { id: "o2", agentId: "c2", title: "o2", postedAt: NOW },
    ],
  );
  // Main's count stands for the agent whose read is not current, an item both name once.
  assert.deepEqual(
    read.map((each) => [each.agentId, each.item.id]),
    [
      ["c1", "o1"],
      ["c2", "o2"],
    ],
  );
});
