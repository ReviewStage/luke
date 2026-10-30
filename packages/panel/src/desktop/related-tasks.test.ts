// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  CHECK_SUMMARY,
  PULL_REQUEST_STATE,
  type PullRequestState,
} from "@luke/features/agent-wire";
import { TASK_PRIORITY, TASK_STATUS, type TaskSummary } from "@luke/features/task-wire";
import type { Workspace } from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { fakeActPort, fakeAppBridge } from "../testing/app-bridge.js";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { tasksControl } from "../testing/tasks-control.js";
import { RelatedTasks } from "./related-tasks.js";

/**
 * related-tasks.test.ts -- a task's related tasks, drawn on their own as the
 * Tasks page's List draws a task: each row ends with a chip for each of its
 * open pull requests, a draft among them and a merged one left out, then
 * what its owner stands at its end; a press on a row opens its task.
 * Synthetic tasks.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ACME = {
  id: "workspace-acme",
  name: "Acme",
  role: "owner",
  github: null,
  memberCount: 1,
} as const satisfies Workspace;

const roots: Root[] = [];

beforeEach(() => {
  fakeAppPlatform(QUIET_PANEL);
  fakeAppBridge({});
  fakeActPort({ [ACT_KIND.WORKSPACE_MEMBERS_READ]: () => Promise.resolve([]) });
});

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

/** A pull request of the task's, `number` standing in `state`. */
function pullRequest(number: number, state: PullRequestState) {
  return {
    number,
    title: `Change ${number}`,
    state,
    checks: CHECK_SUMMARY.NONE,
    additions: 1,
    deletions: 1,
    url: `https://github.com/acme/web/pull/${number}`,
  };
}

const TASK: TaskSummary = {
  id: "t-42",
  workspaceId: ACME.id,
  name: "Fix Safari login",
  repository: "acme/web",
  createdAt: 1,
  updatedAt: 2,
  ownerId: "user-dean",
  status: TASK_STATUS.IN_PROGRESS,
  priority: TASK_PRIORITY.HIGH,
  number: 42,
  agents: {
    total: 1,
    working: 0,
    agents: [],
    pullRequestTotal: 3,
    pullRequests: [
      pullRequest(612, PULL_REQUEST_STATE.OPEN),
      pullRequest(611, PULL_REQUEST_STATE.DRAFT),
      pullRequest(600, PULL_REQUEST_STATE.MERGED),
    ],
  },
};

test("a related task's row ends with its open pull requests and its owner's end, and a press opens it", () => {
  const opened: string[] = [];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const tasks = tasksControl({
    tasks: [TASK],
    workspace: ACME,
    workspaces: [ACME],
    listRead: true,
    onSelect: (taskId) => opened.push(taskId),
  });
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(RelatedTasks, {
          tasks,
          label: "Related tasks",
          rows: [{ task: TASK, end: "Blocks" }],
        }),
      ),
    ),
  );

  const row = container.querySelector<HTMLElement>("[data-task-id='t-42']");
  assert.ok(row, "the task's row stands");
  const chips = [...row.querySelectorAll("[data-cell='pullRequests'] a")].map(
    (chip) => chip.textContent,
  );
  assert.deepEqual(chips, ["#612", "#611"]);
  assert.equal(row.querySelector("[data-cell='end']")?.textContent, "Blocks");

  act(() => row.querySelector<HTMLButtonElement>("[data-card-press]")?.click());
  assert.deepEqual(opened, ["t-42"]);
});
