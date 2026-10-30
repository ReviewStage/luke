// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { AgentPullRequestAnswerView } from "@luke/features/agent-view";
import {
  AGENT_STATUS,
  type AgentPullRequestAnswer,
  type AgentTranscriptMessage,
  CHECK_SUMMARY,
  PULL_REQUEST_STATE,
} from "@luke/features/agent-wire";
import { MESSAGE_ROLE } from "@luke/wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { useAgentPullRequest, useListedPullRequests } from "./use-agent-pull-request.js";

/**
 * use-agent-pull-request.test.ts -- what an agent published reaches its tab
 * however the tab's transcript lands around the read: a page landing while
 * the read is out does not throw its answer away. A task's agents' pull
 * requests are what the task list carries of its own agents, read from
 * nothing. Synthetic ids.
 */

const AGENT = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";

const PUBLISHED: AgentPullRequestAnswer = {
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
function page(id: string): readonly AgentTranscriptMessage[] {
  return [{ id, role: MESSAGE_ROLE.ASSISTANT, parts: [{ type: "text", text: "Done." }] }];
}

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
});

test("a transcript page landing while the read is out leaves its answer standing", async () => {
  let answer: ((value: AgentPullRequestAnswerView) => void) | undefined;
  const read = () =>
    new Promise<AgentPullRequestAnswerView>((resolve) => {
      answer = resolve;
    });
  let held: AgentPullRequestAnswer | undefined;
  function Probe({ messages }: { messages: readonly AgentTranscriptMessage[] }) {
    held = useAgentPullRequest({
      agentId: AGENT,
      status: AGENT_STATUS.COMPLETED,
      shown: true,
      messages,
      read,
      now: () => 1_000,
    }).published;
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
  const answers: ((value: AgentPullRequestAnswerView) => void)[] = [];
  const read = () =>
    new Promise<AgentPullRequestAnswerView>((resolve) => {
      answers.push(resolve);
    });
  let held: AgentPullRequestAnswer | undefined;
  function Probe({ shown }: { shown: boolean }) {
    held = useAgentPullRequest({
      agentId: AGENT,
      status: AGENT_STATUS.COMPLETED,
      shown,
      messages: page("first"),
      read,
      now: () => 1_000,
    }).published;
    return null;
  }
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() => root?.render(createElement(Probe, { shown: true })));
  act(() => root?.render(createElement(Probe, { shown: false })));
  act(() => root?.render(createElement(Probe, { shown: true })));
  assert.equal(answers.length, 2, "shown again inside the gap, it asks afresh");

  const opened = PUBLISHED.pullRequest ?? assert.fail("the fixture names a pull request");
  const newer: AgentPullRequestAnswer = {
    ...PUBLISHED,
    pullRequest: { ...opened, number: 43 },
  };
  await act(async () => answers[1]?.(newer));
  await act(async () => answers[0]?.(PUBLISHED));
  assert.equal(held?.pullRequest?.number, 43, "the read let go of never lands over the newer one");
});

const TASK = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const ELSEWHERE = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const LATER = "5d1e2f3a-4b5c-4d6e-8f70-000000000001";
const TASKLESS = "5d1e2f3a-4b5c-4d6e-8f70-000000000002";

test("a task's agents' pull requests are those the task list carries of its own agents, and an agent on no task holds its own alone", () => {
  const opened = PUBLISHED.pullRequest ?? assert.fail("a pull request");
  const other = { ...opened, number: 7, url: "https://github.com/acme/relay/pull/7" };
  const listed = [
    { agentId: AGENT, taskId: TASK, pullRequest: opened },
    { agentId: LATER, taskId: TASK, pullRequest: other },
    { agentId: ELSEWHERE, taskId: "another-task", pullRequest: other },
    { agentId: TASKLESS, taskId: null, pullRequest: other },
  ];
  const held: { task?: ReadonlyMap<string, unknown>; agent?: ReadonlyMap<string, unknown> } = {};
  function Holders(): null {
    held.task = useListedPullRequests(listed, { taskId: TASK });
    held.agent = useListedPullRequests(listed, { agentId: TASKLESS });
    return null;
  }
  root = createRoot(document.body.appendChild(document.createElement("div")));
  act(() => root?.render(createElement(Holders)));
  assert.deepEqual(
    [...(held.task ?? new Map())],
    [
      [AGENT, opened],
      [LATER, other],
    ],
  );
  assert.deepEqual([...(held.agent ?? new Map())], [[TASKLESS, other]]);
});
