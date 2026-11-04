// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  type AgentPullRequestAnswer,
  CHECK_SUMMARY,
  PULL_REQUEST_STATE,
} from "@repo/features/agent-wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { useListedPullRequests } from "./use-agent-pull-request.js";

/**
 * use-agent-pull-request.test.ts -- a task's agents' pull requests are what
 * the task list carries of its own agents, read from nothing. Synthetic ids.
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

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
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
