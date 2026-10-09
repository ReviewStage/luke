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
import { useAgentPullRequest } from "./use-agent-pull-request";

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
