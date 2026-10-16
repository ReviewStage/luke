// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { CodingAgentPullRequestAnswerView } from "@luke/features/coding-agent-view";
import {
  CHECK_SUMMARY,
  CODING_AGENT_STATUS,
  type CodingAgentMessage,
  type CodingAgentPullRequestAnswer,
  PULL_REQUEST_STATE,
} from "@luke/features/coding-agent-wire";
import { MESSAGE_ROLE } from "@luke/wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { useAgentPullRequest } from "./use-agent-pull-request";

/**
 * use-agent-pull-request.test.ts -- what an agent published reaches its tab
 * however the tab's transcript lands around the read: a page landing while
 * the read is out does not throw its answer away. Synthetic ids.
 */

const AGENT = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";

const PUBLISHED: CodingAgentPullRequestAnswer = {
  repository: "acme/relay",
  branch: "luke/expiry-job",
  pullRequest: {
    number: 42,
    title: "Expire invitations",
    url: "https://github.com/acme/relay/pull/42",
    state: PULL_REQUEST_STATE.OPEN,
    checks: CHECK_SUMMARY.PASSING,
    additions: 4,
    deletions: 1,
    changedFiles: 1,
  },
};

/** One page of transcript, as the tab holds it. */
function page(id: string): readonly CodingAgentMessage[] {
  return [{ id, role: MESSAGE_ROLE.ASSISTANT, parts: [{ type: "text", text: "Done." }] }];
}

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

test("a transcript page landing while the read is out leaves its answer standing", async () => {
  let answer: ((value: CodingAgentPullRequestAnswerView) => void) | undefined;
  const read = () =>
    new Promise<CodingAgentPullRequestAnswerView>((resolve) => {
      answer = resolve;
    });
  let held: CodingAgentPullRequestAnswer | undefined;
  function Probe({ messages }: { messages: readonly CodingAgentMessage[] }) {
    held = useAgentPullRequest({
      agentId: AGENT,
      status: CODING_AGENT_STATUS.COMPLETED,
      shown: true,
      messages,
      read,
      now: () => 1_000,
    });
    return null;
  }
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  // The tab opens on an ended agent with nothing held yet, and asks.
  act(() => root?.render(createElement(Probe, { messages: [] })));
  // Its transcript's first page lands while the read is still out.
  act(() => root?.render(createElement(Probe, { messages: page("first") })));
  await act(async () => answer?.(PUBLISHED));

  assert.deepEqual(held, PUBLISHED, "the pull request's chip stands without another message");
});

test("a tab put out of sight drops the read it had out, and asks afresh when shown again", async () => {
  const answers: ((value: CodingAgentPullRequestAnswerView) => void)[] = [];
  const read = () =>
    new Promise<CodingAgentPullRequestAnswerView>((resolve) => {
      answers.push(resolve);
    });
  let held: CodingAgentPullRequestAnswer | undefined;
  function Probe({ shown }: { shown: boolean }) {
    held = useAgentPullRequest({
      agentId: AGENT,
      status: CODING_AGENT_STATUS.COMPLETED,
      shown,
      messages: page("first"),
      read,
      now: () => 1_000,
    });
    return null;
  }
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() => root?.render(createElement(Probe, { shown: true })));
  act(() => root?.render(createElement(Probe, { shown: false })));
  act(() => root?.render(createElement(Probe, { shown: true })));
  assert.equal(answers.length, 2, "shown again inside the gap, it asks afresh");

  const opened = PUBLISHED.pullRequest ?? assert.fail("the fixture names a pull request");
  const newer: CodingAgentPullRequestAnswer = {
    ...PUBLISHED,
    pullRequest: { ...opened, number: 43 },
  };
  await act(async () => answers[1]?.(newer));
  await act(async () => answers[0]?.(PUBLISHED));
  assert.equal(held?.pullRequest?.number, 43, "the read let go of never lands over the newer one");
});
