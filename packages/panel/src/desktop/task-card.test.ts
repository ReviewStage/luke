// @vitest-environment jsdom

import assert from "node:assert/strict";
import { TASK_PRIORITY, TASK_STATUS, type TaskSummary } from "@luke/features/task-wire";
import type { Workspace } from "@luke/features/workspace-wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { fakeAppBridge } from "../testing/app-bridge.js";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { tasksControl } from "../testing/tasks-control.js";
import { taskCardOf } from "./task-card.js";

/**
 * task-card.test.ts -- a task's hover card leads with where the task stands,
 * its key, its status, and its priority, and keeps where it lives, its
 * repository, at its foot under what is moving on it.
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

test("a task's card leads with its key, its status, and its priority, then its name, and keeps its repository at its foot", () => {
  const card = drawn(TASK);
  const parts = [...card.children];
  assert.deepEqual(
    [...(parts[0]?.querySelectorAll(".task-card-chip") ?? [])].map((chip) => chip.textContent),
    ["ACME-42", "In progress", "High"],
  );
  assert.equal(
    parts[1]?.querySelector(".luke-hover-card-name")?.textContent,
    "Teammate invitations",
  );
  assert.match(parts.at(-1)?.textContent ?? "", /acme\/app/u, "the repository stands last");
});

test("a task with no key, status, or priority leads with its name", () => {
  const { status: _status, priority: _priority, number: _number, ...bare } = TASK;
  const card = drawn(bare);
  assert.equal(card.querySelector(".task-card-standing"), null);
  assert.equal(
    card.firstElementChild?.querySelector(".luke-hover-card-name")?.textContent,
    bare.name,
  );
});
