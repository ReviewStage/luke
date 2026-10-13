// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentPullRequestAnswerView,
} from "@sidecar/hosted/coding-agent-view";
import {
  CHECK_SUMMARY,
  CODING_AGENT_STATUS,
  type CodingAgentMessage,
  type CodingAgentPullRequestAnswer,
  type CodingAgentStatus,
  PULL_REQUEST_STATE,
} from "@sidecar/hosted/coding-agent-wire";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { PUBLISHED_REREAD_MS } from "./coding-agent-model";
import {
  type PlanPullRequests,
  useAgentPullRequest,
  usePlanPullRequests,
} from "./use-agent-pull-request";

const AGENT = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
const OTHER = "9d2b7b5a-4e3f-4e9c-9c77-7a5d8b3f4c32";

const BRANCH_ALONE: CodingAgentPullRequestAnswer = {
  repository: "acme/relay",
  branch: "luke/teammate-invitations",
  pullRequest: null,
};

const OPENED: CodingAgentPullRequestAnswer = {
  ...BRANCH_ALONE,
  pullRequest: {
    number: 123,
    title: "Teammate invitations",
    url: "https://github.com/acme/relay/pull/123",
    state: PULL_REQUEST_STATE.OPEN,
    checks: CHECK_SUMMARY.PENDING,
    additions: 210,
    deletions: 14,
    changedFiles: 6,
  },
};

function message(id: string, text: string): CodingAgentMessage {
  return { id, role: "assistant", parts: [{ type: "text", text }] };
}

interface Standing {
  agentId: string;
  status: CodingAgentStatus;
  shown: boolean;
  messages: readonly CodingAgentMessage[];
}

/** One read the test answers when it chooses. */
interface HeldRead {
  agentId: string;
  answer: (answer: CodingAgentPullRequestAnswerView) => void;
}

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

/** Mounts the hook over a service whose every read is held until the test answers it, on a clock the test moves. */
function mount(initial: Standing) {
  const reads: HeldRead[] = [];
  let now = 1_000_000;
  let published: CodingAgentPullRequestAnswer | undefined;
  let restand: ((next: Standing) => void) | undefined;
  function Probe() {
    const [held, setHeld] = useState(initial);
    restand = setHeld;
    published = useAgentPullRequest({
      agentId: held.agentId,
      status: held.status,
      shown: held.shown,
      messages: held.messages,
      read: (agentId) =>
        new Promise((answer) => {
          reads.push({ agentId, answer });
        }),
      now: () => now,
    });
    return null;
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(Probe)));
  let standing = initial;
  return {
    reads,
    published: () => published,
    stand: (next: Partial<Standing>) => {
      standing = { ...standing, ...next };
      act(() => restand?.(standing));
    },
    pass: (ms: number) => {
      now += ms;
    },
    answer: async (answered: CodingAgentPullRequestAnswerView) => {
      const read = reads.at(-1);
      assert.ok(read, "a read is out");
      read.answer(answered);
      await settle();
    },
  };
}

test("a shown tab reads once, again as pages land no closer than the gap, and at once when the agent ends; a hidden tab reads nothing", async () => {
  const tab = mount({
    agentId: AGENT,
    status: CODING_AGENT_STATUS.RUNNING,
    shown: false,
    messages: [],
  });
  assert.equal(tab.reads.length, 0);

  tab.stand({ shown: true });
  assert.equal(tab.reads.length, 1);
  await tab.answer(BRANCH_ALONE);
  assert.deepEqual(tab.published(), BRANCH_ALONE);

  // A page inside the gap asks nothing; one past it asks again.
  tab.pass(PUBLISHED_REREAD_MS - 1);
  tab.stand({ messages: [message("a", "Pushed the branch.")] });
  assert.equal(tab.reads.length, 1);
  tab.pass(1);
  tab.stand({ messages: [message("a", "Pushed the branch."), message("b", "Opened #123.")] });
  assert.equal(tab.reads.length, 2);

  // The agent ends inside the gap: read anyway, since that is when the pull request lands.
  tab.stand({ status: CODING_AGENT_STATUS.COMPLETED });
  assert.equal(tab.reads.length, 3);
  await tab.answer(OPENED);
  assert.deepEqual(tab.published(), OPENED);

  // Ended and read through: a page landing after that waits for the gap like any other.
  tab.stand({
    messages: [message("a", "Pushed the branch."), message("b", "Opened #123."), message("c", "")],
  });
  assert.equal(tab.reads.length, 3);
  tab.pass(PUBLISHED_REREAD_MS);
  tab.stand({ messages: [] });
  assert.equal(tab.reads.length, 4);
});

test("an answer the service could not give leaves what was drawn, and another agent's tab starts from nothing of this one's", async () => {
  const tab = mount({
    agentId: AGENT,
    status: CODING_AGENT_STATUS.COMPLETED,
    shown: true,
    messages: [],
  });
  await tab.answer(OPENED);
  assert.deepEqual(tab.published(), OPENED);

  tab.pass(PUBLISHED_REREAD_MS);
  tab.stand({ messages: [message("a", "Done.")] });
  await tab.answer({ failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
  assert.deepEqual(tab.published(), OPENED);

  tab.stand({ agentId: OTHER });
  assert.equal(tab.published(), undefined);
  assert.equal(tab.reads.at(-1)?.agentId, OTHER);
  // The first agent's late answer does not land on the second's tab.
  const stale = tab.reads.find((read) => read.agentId === AGENT);
  assert.ok(stale);
  stale.answer(BRANCH_ALONE);
  await settle();
  assert.equal(tab.published(), undefined);
});

/** The plan's agents as the list holds them: each by id, where it stands. */
type Listed = readonly { id: string; status: CodingAgentStatus }[] | undefined;

/** The plans the tests open. */
const PLAN = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const OTHER_PLAN = "2e4a6c8e-0b1d-4f3a-8c5e-7a9b1c3d5e7f";

/** Mounts the plan's pull requests over the agents given, every read held until the test answers it. */
function mountPlan(initial: Listed) {
  const reads: HeldRead[] = [];
  let control: PlanPullRequests | undefined;
  let relist: ((next: { planId: string; agents: Listed }) => void) | undefined;
  function Probe() {
    const [held, setHeld] = useState({ planId: PLAN, agents: initial });
    relist = setHeld;
    control = usePlanPullRequests(
      held.planId,
      held.agents,
      (agentId) => new Promise((answer) => reads.push({ agentId, answer })),
    );
    return null;
  }
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(Probe)));
  const answer = async (
    agentId: string,
    answered: CodingAgentPullRequestAnswerView,
    which: "first" | "last" = "first",
  ) => {
    const at =
      which === "first"
        ? reads.findIndex((read) => read.agentId === agentId)
        : reads.findLastIndex((read) => read.agentId === agentId);
    const [read] = reads.splice(at, 1);
    assert.ok(read, `a read of ${agentId} is out`);
    read.answer(answered);
    await settle();
  };
  return {
    reads,
    answer,
    opened: () => [...(control?.pullRequests.keys() ?? [])],
    list: (next: Listed, planId = PLAN) => act(() => relist?.({ planId, agents: next })),
    readOwn: (agentId: string) => {
      assert.ok(control);
      return control.read(agentId);
    },
  };
}

test("the plan reads each agent's pull request once as the list holds it and once more as it ends, keeps every answer a read lands, and keeps what a failed read leaves", async () => {
  const running = { id: AGENT, status: CODING_AGENT_STATUS.RUNNING };
  const plan = mountPlan(undefined);
  assert.equal(plan.reads.length, 0, "nothing read before the list lands");

  plan.list([running, { id: OTHER, status: CODING_AGENT_STATUS.COMPLETED }]);
  assert.deepEqual(
    plan.reads.map((read) => read.agentId),
    [AGENT, OTHER],
  );
  await plan.answer(AGENT, BRANCH_ALONE);
  await plan.answer(OTHER, OPENED);
  assert.deepEqual(plan.opened(), [OTHER]);

  // The list read again with nothing moved asks nothing; the agent ending asks once more.
  plan.list([{ ...running }, { id: OTHER, status: CODING_AGENT_STATUS.COMPLETED }]);
  assert.equal(plan.reads.length, 0);
  plan.list([
    { id: AGENT, status: CODING_AGENT_STATUS.COMPLETED },
    { id: OTHER, status: CODING_AGENT_STATUS.COMPLETED },
  ]);
  assert.deepEqual(
    plan.reads.map((read) => read.agentId),
    [AGENT],
  );
  await plan.answer(AGENT, OPENED);
  assert.deepEqual(plan.opened(), [OTHER, AGENT]);

  // An agent's own tab reads through the plan's door: a failure keeps what stands, a pull request gone is let go.
  const failed = plan.readOwn(OTHER);
  await plan.answer(OTHER, { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
  assert.deepEqual(await failed, { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
  assert.deepEqual(plan.opened(), [OTHER, AGENT]);
  plan.readOwn(OTHER);
  await plan.answer(OTHER, BRANCH_ALONE);
  assert.deepEqual(plan.opened(), [AGENT]);
});

test("a plan opened again reads every agent afresh and drops what an earlier visit kept or still had out", async () => {
  const ended = { id: AGENT, status: CODING_AGENT_STATUS.COMPLETED };
  const plan = mountPlan([ended]);
  await plan.answer(AGENT, OPENED);
  assert.deepEqual(plan.opened(), [AGENT]);

  plan.list(undefined, OTHER_PLAN);
  assert.deepEqual(plan.opened(), [], "another plan's agents offer nothing of this one's");
  plan.list([ended]);
  assert.deepEqual(plan.opened(), []);
  assert.deepEqual(
    plan.reads.map((read) => read.agentId),
    [AGENT],
    "read again on the return",
  );
  plan.list(undefined, OTHER_PLAN);
  await plan.answer(AGENT, OPENED);
  plan.list(undefined);
  assert.deepEqual(plan.opened(), [], "an answer to an ask from a visit left is let go");
});

test("of two reads of one agent out at once, only the later one's answer is kept, however late the earlier lands", async () => {
  const plan = mountPlan([{ id: AGENT, status: CODING_AGENT_STATUS.RUNNING }]);
  plan.list([{ id: AGENT, status: CODING_AGENT_STATUS.COMPLETED }]);
  assert.equal(plan.reads.length, 2);

  await plan.answer(AGENT, OPENED, "last");
  await plan.answer(AGENT, BRANCH_ALONE);
  assert.deepEqual(plan.opened(), [AGENT]);
});
