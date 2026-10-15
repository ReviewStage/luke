import assert from "node:assert/strict";
import { ACCOUNT_CHAT_REASON, type AccountChatEntry } from "@luke/features/account-inbox-wire";
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
import { test } from "vitest";
import {
  EMPTY_MERGED,
  FACTORY_STEP,
  type FactoryInput,
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

/** A chat message main's read says waits on the developer: from whom, why, in which plan's channel, and when. */
function waitingFor(
  n: number,
  reason: AccountChatEntry["reason"],
  from: string,
  planId: string | null,
  at: number,
): AccountChatEntry {
  return {
    messageId: `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    seq: n,
    workspaceId: "workspace-personal",
    reason,
    from,
    planId,
    touchedSeq: n,
    updatedAt: at,
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

test("a plan stands in the step its own state puts it in: drafted lately in Plan, worked on in Build, and an old draft or an archived plan nowhere", () => {
  const working = agent(1, CODING_AGENT_STATUS.RUNNING);
  const drawn = board({
    plans: [
      plan(1, "Usage alerts", 2 * HOUR),
      plan(
        2,
        "Search across plans",
        5 * HOUR,
        agents([agent(2, CODING_AGENT_STATUS.COMPLETED), working]),
      ),
      plan(3, "Old dashboard", PLANNING_WINDOW_MS + MINUTE),
      { ...plan(4, "Shelved", MINUTE), archivedAt: NOW - MINUTE },
      plan(5, "Finished research", HOUR, agents([agent(3, CODING_AGENT_STATUS.COMPLETED)])),
    ],
  });
  assert.deepEqual(names(drawn.planning), ["Usage alerts"]);
  assert.deepEqual(names(drawn.building), ["Search across plans"]);
  assert.equal(drawn.building[0]?.agent, working);
  assert.equal(drawn.agentsWorking, 1);
  assert.equal(drawn.plansWorking, 1);
  assert.equal(drawn.first, undefined);
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

test("each open ask in a plan's channel waits under Build with its plan, the longest waiting first, and is the wait to take first", () => {
  const stalled = agent(1, CODING_AGENT_STATUS.COMPLETED);
  const billing = plan(1, "Mercury payouts", 2 * HOUR, agents([stalled]));
  const invites = plan(2, "Invitations", HOUR, agents([agent(2, CODING_AGENT_STATUS.RUNNING)]));
  const waiting = [
    waitingFor(1, ACCOUNT_CHAT_REASON.ASK, "invites-agent", invites.id, NOW - 6 * MINUTE),
    waitingFor(2, ACCOUNT_CHAT_REASON.ASK, "billing-agent", billing.id, NOW - 2 * HOUR),
    // A direct message is read rather than answered, and an ask in no plan's channel holds up no step.
    waitingFor(3, ACCOUNT_CHAT_REASON.DIRECT, "ana", billing.id, NOW - 3 * HOUR),
    waitingFor(4, ACCOUNT_CHAT_REASON.ASK, "planner", null, NOW - 4 * HOUR),
  ];
  const drawn = board({ plans: [billing, invites], waiting });
  assert.deepEqual(
    drawn.questions.map((question) => [question.ask.from, question.plan.name]),
    [
      ["billing-agent", "Mercury payouts"],
      ["invites-agent", "Invitations"],
    ],
  );
  // A plan whose only agent is stalled stands in the wait alone, not among the plans being built.
  assert.deepEqual(names(drawn.building), ["Invitations"]);
  assert.equal(drawn.first, FACTORY_STEP.BUILD);
});

test("an open pull request with its checks passed, or none to run, waits to be merged; one in checks, failing, or a draft is still being built; a closed one stands nowhere", () => {
  const drawn = board({
    plans: [
      plan(
        1,
        "Invitations",
        HOUR,
        agents(
          [agent(1, CODING_AGENT_STATUS.COMPLETED)],
          [pullRequest(2505, PULL_REQUEST_STATE.OPEN, CHECK_SUMMARY.PASSING)],
        ),
      ),
      plan(
        2,
        "Docs",
        HOUR,
        agents(
          [agent(2, CODING_AGENT_STATUS.COMPLETED)],
          [pullRequest(2506, PULL_REQUEST_STATE.OPEN, CHECK_SUMMARY.NONE)],
        ),
      ),
      plan(
        3,
        "Board export",
        HOUR,
        agents(
          [agent(3, CODING_AGENT_STATUS.COMPLETED)],
          [pullRequest(2516, PULL_REQUEST_STATE.OPEN, CHECK_SUMMARY.PENDING)],
        ),
      ),
      plan(
        4,
        "Neon branches",
        HOUR,
        agents(
          [agent(4, CODING_AGENT_STATUS.COMPLETED)],
          [pullRequest(2509, PULL_REQUEST_STATE.OPEN, CHECK_SUMMARY.FAILING)],
        ),
      ),
      plan(
        5,
        "Draft",
        HOUR,
        agents(
          [agent(5, CODING_AGENT_STATUS.COMPLETED)],
          [pullRequest(2511, PULL_REQUEST_STATE.DRAFT, CHECK_SUMMARY.PASSING)],
        ),
      ),
      plan(
        6,
        "Abandoned",
        HOUR,
        agents(
          [agent(6, CODING_AGENT_STATUS.COMPLETED)],
          [pullRequest(2490, PULL_REQUEST_STATE.CLOSED, CHECK_SUMMARY.PASSING)],
        ),
      ),
    ],
  });
  assert.deepEqual(
    drawn.merges.map((merge) => merge.pullRequest.number),
    [2505, 2506],
  );
  assert.deepEqual(
    drawn.building.map((row) => row.pullRequest?.number),
    [2516, 2509, 2511],
  );
  assert.equal(drawn.first, FACTORY_STEP.SHIP);
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
  assert.deepEqual(now.merges, []);

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

test("with nothing standing anywhere, the board is empty and no wait comes first", () => {
  const drawn = board({ plans: [plan(1, "Old dashboard", 10 * PLANNING_WINDOW_MS)] });
  assert.deepEqual(drawn, {
    planning: [],
    building: [],
    questions: [],
    merges: [],
    shipped: [],
    agentsWorking: 0,
    plansWorking: 0,
    first: undefined,
  });
});
