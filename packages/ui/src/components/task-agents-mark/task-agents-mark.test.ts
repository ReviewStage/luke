// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CHECK_SUMMARY, PULL_REQUEST_STATE } from "@repo/features/agent-wire";
import type { TaskAgentsSummary, TaskPullRequestLine } from "@repo/features/task-wire";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { it } from "vitest";
import { TaskAgentsMark } from "./task-agents-mark.js";

function pullRequest(number: number, state: TaskPullRequestLine["state"]): TaskPullRequestLine {
  return {
    number,
    title: `Change ${number}`,
    state,
    checks: CHECK_SUMMARY.NONE,
    additions: 1,
    deletions: 1,
  };
}

function agents(
  counts: Partial<Pick<TaskAgentsSummary, "working" | "failed">>,
  pullRequests: readonly TaskPullRequestLine[] = [],
): TaskAgentsSummary {
  return {
    total: 2,
    working: 0,
    agents: [],
    pullRequestTotal: pullRequests.length,
    pullRequests: [...pullRequests],
    ...counts,
  };
}

function heard(summary: TaskAgentsSummary | undefined): string | undefined {
  const box = document.createElement("div");
  box.innerHTML = renderToStaticMarkup(createElement(TaskAgentsMark, { agents: summary }));
  return box.querySelector("[role='img']")?.getAttribute("aria-label") ?? undefined;
}

const MERGED = pullRequest(1, PULL_REQUEST_STATE.MERGED);
const CLOSED = pullRequest(2, PULL_REQUEST_STATE.CLOSED);

it.each([
  ["a failure outranks an agent at work", agents({ failed: 1, working: 1 }, [MERGED]), "Failed"],
  [
    "an agent at work outranks a pull request",
    agents({ working: 1 }, [pullRequest(3, PULL_REQUEST_STATE.OPEN)]),
    "Working",
  ],
  [
    "an open pull request outranks a merged one",
    agents({}, [MERGED, pullRequest(3, PULL_REQUEST_STATE.OPEN)]),
    "Pull request open",
  ],
  [
    "a draft outranks a merged one",
    agents({}, [MERGED, pullRequest(4, PULL_REQUEST_STATE.DRAFT)]),
    "Pull request draft",
  ],
  [
    "a merged pull request outranks a closed one",
    agents({}, [CLOSED, MERGED]),
    "Pull request merged",
  ],
  [
    "an open pull request in the merge queue is said queued",
    agents({}, [MERGED, { ...pullRequest(5, PULL_REQUEST_STATE.OPEN), queued: true }]),
    "Pull request queued",
  ],
  ["a closed pull request still shows", agents({}, [CLOSED]), "Pull request closed"],
  ["agents done with nothing published show nothing", agents({}), undefined],
  ["a task with no agents shows nothing", undefined, undefined],
])("%s", (_case, summary, words) => {
  assert.equal(heard(summary), words);
});
