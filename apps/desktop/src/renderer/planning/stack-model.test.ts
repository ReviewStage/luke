import assert from "node:assert/strict";
import {
  CHECK_SUMMARY,
  CODING_AGENT_STATUS,
  type CodingAgentPullRequest,
  type CodingAgentSummary,
  PULL_REQUEST_STATE,
  ROLLOUT_ROLE,
} from "@sidecar/hosted/coding-agent-wire";
import { ROLLOUT_BASE, type RolloutItem } from "@sidecar/hosted/plan-wire";
import { WORKER_REPORT_KIND } from "@sidecar/hosted/rollout-wire";
import { test } from "vitest";
import {
  keeperStateWords,
  STACK_STATE,
  stackBaseWords,
  stackKeeper,
  stackLayout,
  stackStateWords,
  stackWorking,
} from "./stack-model";

const PLAN_ID = "0f6a2c4e-8b1d-4e3f-9a57-1c2b3d4e5f60";

function item(title: string, base: RolloutItem["base"]): RolloutItem {
  return { title, scope: `${title}, all of it.`, base, acceptance: null };
}

function worker(
  id: string,
  position: number,
  status: CodingAgentSummary["status"],
  more: Partial<CodingAgentSummary> = {},
): CodingAgentSummary {
  return {
    id,
    planId: PLAN_ID,
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    title: null,
    createdAt: Number(id.at(-1)),
    status,
    turnId: null,
    position,
    ...more,
  };
}

function pullRequest(
  number: number,
  state: CodingAgentPullRequest["state"],
  checks: CodingAgentPullRequest["checks"] = CHECK_SUMMARY.PENDING,
): CodingAgentPullRequest {
  return {
    number,
    title: `PR ${number}`,
    url: `https://github.com/acme/relay/pull/${number}`,
    state,
    checks,
    additions: 1,
    deletions: 0,
    changedFiles: 1,
  };
}

/** Each column's groups as base and the positions under it, which is the layout a reader sees. */
function shape(columns: ReturnType<typeof stackLayout>) {
  return columns.map((column) =>
    column.map((group) => [group.base, group.cards.map((card) => card.position)]),
  );
}

/** Each card's position and what it says of where it stands, in the plan's order. */
function words(columns: ReturnType<typeof stackLayout>) {
  return columns
    .flat()
    .flatMap((group) => group.cards)
    .sort((a, b) => a.position - b.position)
    .map((card) => [card.position, stackStateWords(card)]);
}

test("a chain stands a column per depth, and a position on a base not yet pushed waits on it", () => {
  const rollout = [item("Schema", ROLLOUT_BASE.MAIN), item("Route", 1), item("Screen", 2)];
  const layout = stackLayout(rollout, [worker("a1", 1, CODING_AGENT_STATUS.RUNNING)]);

  assert.deepEqual(shape(layout), [[[ROLLOUT_BASE.MAIN, [1]]], [[1, [2]]], [[2, [3]]]]);
  assert.deepEqual(words(layout), [
    [1, "working"],
    [2, "waiting on #1"],
    [3, "waiting on #2"],
  ]);
  assert.deepEqual(
    rollout.map((each) => stackBaseWords(each.base)),
    ["base: main", "on #1", "on #2"],
  );
});

test("a sibling pair stands together under the base it shares, which lets both start once its pull request is open", () => {
  const rollout = [
    item("Schema", ROLLOUT_BASE.MAIN),
    item("Route", 1),
    item("Docs", ROLLOUT_BASE.MAIN),
    item("Screen", 1),
  ];
  const layout = stackLayout(rollout, [
    worker("a1", 1, CODING_AGENT_STATUS.COMPLETED, {
      published: pullRequest(412, PULL_REQUEST_STATE.OPEN, CHECK_SUMMARY.PASSING),
    }),
  ]);

  assert.deepEqual(shape(layout), [[[ROLLOUT_BASE.MAIN, [1, 3]]], [[1, [2, 4]]]]);
  assert.deepEqual(words(layout), [
    [1, "green"],
    [2, "ready"],
    [3, "ready"],
    [4, "ready"],
  ]);
});

test("a failed worker says so until another starts at its position, and its pull request stays on the card", () => {
  const rollout = [item("Schema", ROLLOUT_BASE.MAIN), item("Route", 1)];
  const opened = pullRequest(412, PULL_REQUEST_STATE.OPEN);
  const layout = stackLayout(rollout, [
    worker("a1", 1, CODING_AGENT_STATUS.FAILED, { published: opened }),
  ]);
  const [card] = layout[0]?.[0]?.cards ?? [];

  assert.equal(card?.state, STACK_STATE.FAILED);
  assert.equal(card?.worker?.id, "a1");
  assert.deepEqual(card?.published, opened);
  assert.deepEqual(words(layout), [
    [1, "failed"],
    [2, "ready"],
  ]);
});

test("a position with two workers stands for the one still holding it, the stopped one's pull request kept", () => {
  const rollout = [item("Schema", ROLLOUT_BASE.MAIN)];
  const opened = pullRequest(412, PULL_REQUEST_STATE.DRAFT);
  const layout = stackLayout(rollout, [
    worker("a1", 1, CODING_AGENT_STATUS.CANCELLED, { published: opened }),
    worker("a2", 1, CODING_AGENT_STATUS.COMPLETED),
    worker("a3", 1, CODING_AGENT_STATUS.FAILED),
  ]);
  const [card] = layout[0]?.[0]?.cards ?? [];

  assert.equal(card?.worker?.id, "a2");
  assert.deepEqual(card?.published, opened);
  assert.equal(stackStateWords(card ?? assert.fail("no card")), "open");
});

test("a worker's standing question or block is what its card waits on, a milestone is not, and a merge says merged over all of them", () => {
  const question = {
    kind: WORKER_REPORT_KIND.QUESTION,
    text: "Resend an expired invite, or refuse it?",
    options: ["Resend", "Refuse"],
    at: 1,
  } as const;
  const rollout = [
    item("Schema", ROLLOUT_BASE.MAIN),
    item("Route", ROLLOUT_BASE.MAIN),
    item("Screen", ROLLOUT_BASE.MAIN),
    item("Docs", ROLLOUT_BASE.MAIN),
  ];
  const layout = stackLayout(rollout, [
    worker("a1", 1, CODING_AGENT_STATUS.COMPLETED, { lastReport: question }),
    worker("a2", 2, CODING_AGENT_STATUS.RUNNING, {
      lastReport: { kind: WORKER_REPORT_KIND.BLOCKED, text: "No database URL.", at: 2 },
    }),
    worker("a3", 3, CODING_AGENT_STATUS.RUNNING, {
      lastReport: { kind: WORKER_REPORT_KIND.PR_OPENED, text: "Opened.", at: 3 },
    }),
    worker("a4", 4, CODING_AGENT_STATUS.COMPLETED, {
      lastReport: question,
      published: pullRequest(415, PULL_REQUEST_STATE.MERGED),
    }),
  ]);
  const cards = layout.flat().flatMap((group) => group.cards);

  assert.deepEqual(words(layout), [
    [1, "waiting on you"],
    [2, "blocked"],
    [3, "working"],
    [4, "merged"],
  ]);
  assert.deepEqual(cards[0]?.waiting, question);
  assert.equal(cards[2]?.waiting, null);
});

test("the tab reads again while a rollout worker works, and not for an agent outside the rollout", () => {
  const { position: _none, ...outside } = worker("a1", 1, CODING_AGENT_STATUS.RUNNING);
  assert.equal(stackWorking([outside]), false);
  assert.equal(stackWorking([worker("a2", 1, CODING_AGENT_STATUS.COMPLETED)]), false);
  assert.equal(stackWorking([worker("a3", 2, CODING_AGENT_STATUS.STARTING)]), true);
});

test("the keeper is read apart from the cards: the newest still holding its place, its state in a word, and none before one starts", () => {
  const keeper = (id: string, status: CodingAgentSummary["status"], more = {}) => {
    const { position: _none, ...rest } = worker(id, 1, status, more);
    return { ...rest, role: ROLLOUT_ROLE.KEEPER };
  };
  const rollout = [item("Schema", ROLLOUT_BASE.MAIN), item("Route", 1)];
  const agents = [
    worker("a1", 1, CODING_AGENT_STATUS.RUNNING),
    keeper("k2", CODING_AGENT_STATUS.COMPLETED),
    keeper("k3", CODING_AGENT_STATUS.FAILED),
  ];
  const chosen = stackKeeper(agents);

  assert.equal(chosen?.agent.id, "k2");
  assert.equal(keeperStateWords(chosen ?? assert.fail("no keeper")), "idle");
  assert.deepEqual(
    stackLayout(rollout, agents)
      .flat()
      .flatMap((group) => group.cards.map((card) => card.worker?.id)),
    ["a1", undefined],
  );
  assert.equal(stackKeeper([worker("a1", 1, CODING_AGENT_STATUS.RUNNING)]), undefined);
  const asking = stackKeeper([
    keeper("k4", CODING_AGENT_STATUS.COMPLETED, {
      lastReport: { kind: WORKER_REPORT_KIND.QUESTION, text: "Merge #412 now?", at: 1 },
    }),
  ]);
  assert.equal(keeperStateWords(asking ?? assert.fail("no keeper")), "waiting on you");
  assert.equal(stackWorking([keeper("k5", CODING_AGENT_STATUS.RUNNING)]), true);
});
