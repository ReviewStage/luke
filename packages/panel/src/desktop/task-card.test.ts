// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CHECK_SUMMARY, PULL_REQUEST_STATE } from "@luke/features/coding-agent-wire";
import { TASK_PRIORITY, TASK_STATUS, type TaskSummary } from "@luke/features/task-wire";
import type { Workspace } from "@luke/features/workspace-wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { fakeAppBridge } from "../testing/app-bridge.js";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { tasksControl } from "../testing/tasks-control.js";
import { PullRequestLine, taskCardOf } from "./task-card.js";

/**
 * task-card.test.ts -- a task's hover card says where the task stands by
 * its board card's marks, its status, its priority, and who is on it, each
 * heard by a screen reader, and a pull request's line counts its size.
 */

const ACME = {
  id: "workspace-acme",
  name: "Acme",
  role: "owner",
  github: null,
  memberCount: 1,
} as const satisfies Workspace;

const TASK: TaskSummary = {
  id: "t-42",
  workspaceId: ACME.id,
  name: "Teammate invitations",
  repository: "acme/app",
  createdAt: 1,
  updatedAt: 2,
  status: TASK_STATUS.IN_PROGRESS,
  priority: TASK_PRIORITY.HIGH,
  number: 42,
};

const roots: Root[] = [];

beforeEach(() => {
  fakeAppPlatform(QUIET_PANEL);
  fakeAppBridge({});
});

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
});

/** The card of `task`, drawn alone, read under Acme. */
function drawn(task: TaskSummary): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const tasks = tasksControl({ workspace: ACME, workspaces: [ACME], tasks: [task] });
  act(() => root.render(onRegistry(AtomRegistry.make(), taskCardOf(tasks, task, 10))));
  const card = container.querySelector<HTMLElement>("[data-task-card]");
  assert.ok(card, "the card is drawn");
  return card;
}

test("a task's card says where it stands by marks a reader hears, as the board's card draws them, and none is a picker", () => {
  const heard = (task: TaskSummary) =>
    [...drawn(task).querySelectorAll(".luke-hover-card-head .task-card-mark")].map((each) =>
      each.getAttribute("aria-label"),
    );

  assert.deepEqual(heard({ ...TASK, assignee: { userId: "user-charles", name: "Charles Pan" } }), [
    "Status: In progress",
    "Priority: High",
    "Assignee: Charles Pan",
  ]);
  assert.equal(heard(TASK).at(-1), "Assignee: No assignee");
  assert.equal(document.querySelector("[data-task-card] button[aria-haspopup]"), null);
});

test("a pull request's line on the card counts its size as every figure is counted, green then red", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(PullRequestLine, {
        pullRequest: {
          number: 7,
          title: "Add invitations",
          state: PULL_REQUEST_STATE.OPEN,
          checks: CHECK_SUMMARY.PASSING,
          additions: 1234,
          deletions: 56,
        },
      }),
    ),
  );
  assert.deepEqual(
    [...container.querySelectorAll(".luke-count-part")].map((each) => [
      each.textContent,
      each.getAttribute("data-tone"),
    ]),
    [
      ["+1,234", "complete"],
      ["−56", "danger"],
    ],
  );
});
