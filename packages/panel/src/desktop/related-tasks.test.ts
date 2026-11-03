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
import { longPress, underAFinger } from "../testing/finger.js";
import { tasksControl } from "../testing/tasks-control.js";
import { RelatedTasks } from "./related-tasks.js";

/**
 * related-tasks.test.ts -- a task's related tasks, drawn on their own as the
 * Tasks page's List draws a task: each row is led by what its owner stands
 * there, its relation, and ends with a chip for each of its open pull
 * requests, a draft among them and a merged one left out, and its
 * sub-tasks' count stands however narrow the list; a press on a row opens
 * its task, and a finger's row
 * draws no ⋯, its menu a long press away.
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

test("a related task's row is led by its owner's relation and ends with its open pull requests, and a press opens it", () => {
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
          rows: [{ task: TASK, relation: "Blocks" }],
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
  assert.equal(row.querySelector("[data-cell='relation']")?.textContent, "Blocks");

  act(() => row.querySelector<HTMLButtonElement>("[data-card-press]")?.click());
  assert.deepEqual(opened, ["t-42"]);
});

test("a related task's row says it is blocked beside its name and how many of its sub-tasks are finished, even in a list too narrow for its key", () => {
  const blocked: TaskSummary = { ...TASK, blocked: true };
  const child = (id: string, status: NonNullable<TaskSummary["status"]>): TaskSummary => ({
    ...TASK,
    id,
    status,
    parentTaskId: TASK.id,
  });
  // Note that the list is measured as a plan's narrow pane stands it, which folds the key away.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 360, 400),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const tasks = tasksControl({
    tasks: [blocked, child("t-43", TASK_STATUS.DONE), child("t-44", TASK_STATUS.TODO)],
    workspace: ACME,
    workspaces: [ACME],
    listRead: true,
  });
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(RelatedTasks, { tasks, label: "Sub-tasks", rows: [{ task: blocked }] }),
      ),
    ),
  );

  const row = container.querySelector<HTMLElement>("[data-task-id='t-42']");
  assert.ok(row, "the task's row stands");
  assert.ok(
    row.querySelector("[data-cell='name'] .blocked-mark"),
    "the stop sign stands beside the name",
  );
  assert.equal(row.querySelector("[data-cell='key']"), null, "the key folds away");
  assert.match(row.querySelector("[data-cell='subTasks']")?.textContent ?? "", /^1\/2/u);
});

test("under a finger, a related task's row draws no ⋯, and a long press on it opens the task's menu", () => {
  underAFinger();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const tasks = tasksControl({
    tasks: [TASK],
    workspace: ACME,
    workspaces: [ACME],
    listRead: true,
  });
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(RelatedTasks, { tasks, label: "Sub-tasks", rows: [{ task: TASK }] }),
      ),
    ),
  );

  const row = container.querySelector<HTMLElement>("[data-task-id='t-42']");
  assert.ok(row, "the task's row stands");
  assert.ok(row.querySelector('button[aria-label="Task actions"]') === null, "the row draws no ⋯");
  longPress(row.querySelector<HTMLElement>("[data-card-press]") ?? assert.fail("no press"));
  const labels = [...document.querySelectorAll('[role^="menuitem"] .ui-menu-item-label')].map(
    (label) => label.textContent,
  );
  assert.ok(labels.includes("Rename"), "the menu offers Rename");
});
