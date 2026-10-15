import assert from "node:assert/strict";
import {
  CHECK_SUMMARY,
  CODING_AGENT_STATUS,
  PULL_REQUEST_STATE,
} from "@luke/features/coding-agent-wire";
import type {
  PlanAgentLine,
  PlanAgentsSummary,
  PlanPullRequestLine,
  PlanSummary,
} from "@luke/features/plan-wire";
import type { AppInboxPlan } from "@luke/host/app-state";
import { test } from "vitest";
import {
  EMPTY_MERGED,
  FACTORY_BLOCK,
  FACTORY_STOP,
  FACTORY_WORK,
  FAILED_WINDOW_MS,
  type FactoryInput,
  type FactoryStop,
  type FactoryWork,
  factoryBoard,
  noteMerged,
  PLANNING_WINDOW_MS,
  SHIPPED_LINGER_MS,
} from "./factory-model";

const NOW = 1_800_000_000_000;
const MINUTE = 60_000;
const HOUR = 3_600_000;

/** A plan saved `ago` before now, with the agents its row carries where it has any. */
function plan(n: number, name: string, ago: number, agents?: PlanAgentsSummary): PlanSummary {
  const summary: PlanSummary = {
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

function agent(n: number, status: PlanAgentLine["status"], at = NOW - MINUTE): PlanAgentLine {
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
  state: PlanPullRequestLine["state"],
  checks: PlanPullRequestLine["checks"],
): PlanPullRequestLine {
  return { number, title: `PR ${number}`, state, checks, additions: 10, deletions: 2 };
}

/** What a plan's row says of its agents and pull requests. */
function agents(
  lines: readonly PlanAgentLine[],
  pullRequests: readonly PlanPullRequestLine[] = [],
): PlanAgentsSummary {
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
    plans: [],
    waiting: [],
    callPlanId: undefined,
    merged: EMPTY_MERGED,
    now: NOW,
    ...patch,
  });
}

const names = (rows: readonly { plan: PlanSummary }[]) => rows.map((row) => row.plan.name);

/** Build's work as a reader scans it: an agent by its title, a pull request by its number, each with its plan. */
const work = (rows: readonly FactoryWork[]) =>
  rows.map((row) =>
    row.kind === FACTORY_WORK.AGENT
      ? `${row.agent.title} (${row.plan.name})`
      : `#${row.pullRequest.number} (${row.plan.name})`,
  );

/** What stops an agent as a reader scans it: a question by its words, a failure by its agent. */
const stops = (rows: readonly FactoryStop[]) =>
  rows.map((row) =>
    row.kind === FACTORY_STOP.QUESTION ? row.item.title : `${row.agent.title} failed`,
  );

test("a plan stands in the station its own state puts it in: drafted lately in Plan, its agents at work in Build each on a row of its own, and an old draft, an archived plan, or a finished one nowhere", () => {
  const drawn = board({
    plans: [
      plan(1, "Usage alerts", 2 * HOUR),
      plan(
        2,
        "Search across plans",
        5 * HOUR,
        agents([
          agent(2, CODING_AGENT_STATUS.COMPLETED),
          agent(1, CODING_AGENT_STATUS.RUNNING, NOW - 2 * MINUTE),
          agent(3, CODING_AGENT_STATUS.STARTING, NOW - MINUTE),
        ]),
      ),
      plan(3, "Old dashboard", PLANNING_WINDOW_MS + MINUTE),
      { ...plan(4, "Shelved", MINUTE), archivedAt: NOW - MINUTE },
      plan(5, "Finished research", HOUR, agents([agent(4, CODING_AGENT_STATUS.COMPLETED)])),
    ],
  });
  assert.deepEqual(names(drawn.planning), ["Usage alerts"]);
  assert.deepEqual(work(drawn.working), [
    "Agent 3 (Search across plans)",
    "Agent 1 (Search across plans)",
  ]);
  assert.equal(drawn.agentsWorking, 2);
  assert.deepEqual(drawn.stopped, []);
  assert.deepEqual(drawn.blocked, []);
});

test("the plan on the call is being planned however long ago it was saved, and stands first", () => {
  const call = plan(1, "Factory tab", 3 * PLANNING_WINDOW_MS);
  const drawn = board({ plans: [plan(2, "Usage alerts", MINUTE), call], callPlanId: call.id });
  assert.deepEqual(
    drawn.planning.map((row) => [row.plan.name, row.onCall]),
    [
      ["Factory tab", true],
      ["Usage alerts", false],
    ],
  );
});

test("what stops an agent leads Build: each open Inbox item with its plan, the latest first, then each agent whose turn failed in the last day, the latest first", () => {
  const stalled = agent(1, CODING_AGENT_STATUS.COMPLETED);
  const billing = plan(1, "Mercury payouts", 2 * HOUR, agents([stalled]));
  const invites = plan(2, "Invitations", HOUR, agents([agent(2, CODING_AGENT_STATUS.RUNNING)]));
  const pooling = plan(
    3,
    "Connection pooling",
    HOUR,
    agents([agent(5, CODING_AGENT_STATUS.FAILED, NOW - HOUR)]),
  );
  const push = plan(
    4,
    "Mobile push",
    3 * HOUR,
    agents([agent(6, CODING_AGENT_STATUS.FAILED, NOW - 3 * HOUR)]),
  );
  const stale = plan(
    5,
    "Old retry",
    2 * FAILED_WINDOW_MS,
    agents([agent(7, CODING_AGENT_STATUS.FAILED, NOW - FAILED_WINDOW_MS - MINUTE)]),
  );
  const waiting: AppInboxPlan[] = [
    {
      planId: billing.id,
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
      planId: invites.id,
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
  const drawn = board({ plans: [billing, invites, push, pooling, stale], waiting });
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
  const withPullRequest = (n: number, name: string, line: PlanPullRequestLine) =>
    plan(
      n,
      name,
      HOUR,
      agents([agent(n, CODING_AGENT_STATUS.COMPLETED, NOW - n * MINUTE)], [line]),
    );
  const drawn = board({
    plans: [
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

test("a pull request seen turning merged stands in Ship for a minute, then leaves; one already merged when first read never stands", () => {
  const open = plan(
    1,
    "Invitations",
    HOUR,
    agents(
      [agent(9, CODING_AGENT_STATUS.COMPLETED)],
      [pullRequest(2505, PULL_REQUEST_STATE.OPEN, CHECK_SUMMARY.PASSING)],
    ),
  );
  const merged = plan(
    1,
    "Invitations",
    HOUR,
    agents(
      [agent(9, CODING_AGENT_STATUS.COMPLETED)],
      [pullRequest(2505, PULL_REQUEST_STATE.MERGED, CHECK_SUMMARY.PASSING)],
    ),
  );
  const long = plan(
    2,
    "Transcript search",
    4 * HOUR,
    agents(
      [agent(9, CODING_AGENT_STATUS.COMPLETED)],
      [pullRequest(2502, PULL_REQUEST_STATE.MERGED, CHECK_SUMMARY.PASSING)],
    ),
  );

  const first = noteMerged(EMPTY_MERGED, undefined, [open, long], NOW);
  const seen = noteMerged(first, [open, long], [merged, long], NOW);
  const now = board({ plans: [merged, long], merged: seen });
  assert.deepEqual(
    now.shipped.map((row) => [row.pullRequest.number, row.at]),
    [[2505, NOW]],
  );
  assert.deepEqual(now.blocked, []);

  const later = NOW + SHIPPED_LINGER_MS;
  const kept = noteMerged(seen, [merged, long], [merged, long], later);
  assert.deepEqual(board({ plans: [merged, long], merged: kept, now: later }).shipped, []);
});

test("two repositories' pull requests sharing a number are told apart by their pages, so only the one seen merging ships", () => {
  const old = {
    ...pullRequest(12, PULL_REQUEST_STATE.MERGED, CHECK_SUMMARY.PASSING),
    url: "https://github.com/acme/a/pull/12",
  };
  const open = {
    ...pullRequest(12, PULL_REQUEST_STATE.OPEN, CHECK_SUMMARY.PASSING),
    url: "https://github.com/acme/b/pull/12",
  };
  const done = agent(1, CODING_AGENT_STATUS.COMPLETED);
  const before = plan(1, "Moved repositories", HOUR, agents([done], [open, old]));
  const after = plan(
    1,
    "Moved repositories",
    HOUR,
    agents([done], [{ ...open, state: PULL_REQUEST_STATE.MERGED }, old]),
  );
  const seen = noteMerged(
    noteMerged(EMPTY_MERGED, undefined, [before], NOW),
    [before],
    [after],
    NOW,
  );
  assert.deepEqual(
    board({ plans: [after], merged: seen }).shipped.map((row) => row.pullRequest.url),
    ["https://github.com/acme/b/pull/12"],
  );
});

test("with nothing standing anywhere, the board is empty", () => {
  const drawn = board({ plans: [plan(1, "Old dashboard", 10 * PLANNING_WINDOW_MS)] });
  assert.deepEqual(drawn, {
    planning: [],
    stopped: [],
    working: [],
    blocked: [],
    shipped: [],
    agentsWorking: 0,
  });
});

test("an agent that failed before its first turn waits in Build as recent as its task's last activity, however old the task's last save", () => {
  const turnless: PlanAgentLine = {
    id: "a0000000-0000-4000-8000-000000000001",
    title: "Agent 1",
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    status: CODING_AGENT_STATUS.FAILED,
  };
  const old = plan(1, "Old billing", 3 * FAILED_WINDOW_MS, agents([turnless]));
  const started = plan(1, "Old billing", 3 * FAILED_WINDOW_MS, {
    ...agents([turnless]),
    activityAt: NOW - 5 * MINUTE,
  });
  assert.deepEqual(stops(board({ plans: [started] }).stopped), ["Agent 1 failed"]);
  // With no activity of its own since, the old task's failure has aged out.
  assert.deepEqual(board({ plans: [old] }).stopped, []);
});

test("a draft's failing checks are its own work still, standing in Build; only an open pull request's wait in Ship", () => {
  const withPullRequest = (n: number, name: string, line: PlanPullRequestLine) =>
    plan(n, name, HOUR, agents([agent(n, CODING_AGENT_STATUS.COMPLETED)], [line]));
  const drawn = board({
    plans: [
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
