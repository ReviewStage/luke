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
import {
  type TaskPullRequests,
  useAgentPullRequest,
  useTaskPullRequests,
} from "./use-agent-pull-request.js";

/**
 * use-agent-pull-request.test.ts -- what an agent published reaches its tab
 * however the tab's transcript lands around the read: a page landing while
 * the read is out does not throw its answer away. A task keeps its own
 * agents' pull requests as its reads land: an answer naming the pull
 * request it already keeps leaves what it keeps as it stood, so nothing
 * drawn from it is drawn again, and an agent of another task, read through
 * it as a card naming that agent may, is answered but never kept.
 * Synthetic ids.
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
  const newer: CodingAgentPullRequestAnswer = {
    ...PUBLISHED,
    pullRequest: { ...opened, number: 43 },
  };
  await act(async () => answers[1]?.(newer));
  await act(async () => answers[0]?.(PUBLISHED));
  assert.equal(held?.pullRequest?.number, 43, "the read let go of never lands over the newer one");
});

const TASK = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const ELSEWHERE = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

/** Every read answers the same pull request, as a fresh object each time, as the service's answers are. */
const publishedAgain = (): Promise<CodingAgentPullRequestAnswerView> =>
  Promise.resolve(structuredClone(PUBLISHED));

/** The task's pull requests as each render held them, the newest last. */
function taskKept(): TaskPullRequests[] {
  const held: TaskPullRequests[] = [];
  const agents = [{ id: AGENT, status: CODING_AGENT_STATUS.COMPLETED }];
  function Task(): null {
    held.push(useTaskPullRequests(TASK, agents, publishedAgain));
    return null;
  }
  root = createRoot(document.body.appendChild(document.createElement("div")));
  act(() => root?.render(createElement(Task)));
  return held;
}

async function settled(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

const newest = (held: readonly TaskPullRequests[]) => held.at(-1) ?? assert.fail("drawn");

test("an answer naming the pull request a task already keeps leaves its pull requests as they stood", async () => {
  const held = taskKept();
  await settled();
  const first = newest(held).pullRequests;
  assert.deepEqual(first.get(AGENT), PUBLISHED.pullRequest);

  await act(() =>
    newest(held)
      .read(AGENT)
      .then(() => undefined),
  );
  await settled();
});

test("an agent of another task read through a task is answered but never kept", async () => {
  const held = taskKept();
  await settled();

  const answered = await act(() => newest(held).read(ELSEWHERE));
  await settled();
  assert.ok(!("failure" in answered), "the read is answered");
  assert.equal(newest(held).pullRequests.has(ELSEWHERE), false);
});
