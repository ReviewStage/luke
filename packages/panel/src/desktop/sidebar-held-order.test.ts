// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { TaskSummary } from "@luke/features/task-wire";
import { WORKSPACE_ROLE, type Workspace } from "@luke/features/workspace-wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { fakeAppBridge } from "../testing/app-bridge.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { sidebarProps } from "../testing/desktop-sidebar.js";
import { tasksControl } from "../testing/tasks-control.js";
import { DesktopSidebar } from "./desktop-sidebar.js";

/**
 * sidebar-held-order.test.ts -- the sidebar's tasks hold the places they
 * were first drawn in while the sidebar is in sight, so an update that
 * would sort a task elsewhere moves nothing under the reader's eye; folded
 * away and back, the list is sorted anew, and a task the reader renamed
 * themselves moves at once. Synthetic throughout.
 */

const WORKSPACE: Workspace = {
  id: "workspace-personal",
  name: "Ada Lovelace",
  role: WORKSPACE_ROLE.OWNER,
  github: null,
};

const roots: Root[] = [];

beforeEach(() => {
  window.localStorage.clear();
  // The window's motion as a Mac with none reduced answers it.
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
  fakeAppBridge({});
});

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
});

function task(id: string, name: string, updatedAt: number): TaskSummary {
  return { id, workspaceId: WORKSPACE.id, name, createdAt: 1, updatedAt, repository: null };
}

/** The sidebar over the tasks given, and a way to draw it again over others, in sight or folded away, as an update does. */
function mountSidebar(tasks: readonly TaskSummary[]) {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  const registry = AtomRegistry.make();
  const draw = (
    listed: readonly TaskSummary[],
    { folded = false, ...rest }: Partial<TasksControl> & { folded?: boolean } = {},
  ) => {
    const props = sidebarProps(
      tasksControl({ tasks: [...listed], workspaces: [WORKSPACE], workspace: WORKSPACE, ...rest }),
    );
    const sidebar = { ...props.sidebar, collapsed: folded };
    act(() =>
      root.render(onRegistry(registry, createElement(DesktopSidebar, { ...props, sidebar }))),
    );
  };
  draw(tasks);
  return { container, draw };
}

/** The names of the tasks drawn under Tasks, in the order drawn. */
function names(sidebar: HTMLElement): string[] {
  const region = sidebar.querySelector('nav[aria-label="Tasks"]');
  return [...(region?.querySelectorAll(".luke-list-row-title") ?? [])].map(
    (name) => name.firstChild?.textContent ?? "",
  );
}

test("a task an update would sort first holds its place while the sidebar is in sight", () => {
  const { container, draw } = mountSidebar([
    task("t-1", "Invite expiry", 3),
    task("t-2", "Retry audit", 2),
  ]);
  assert.deepEqual(names(container), ["Invite expiry", "Retry audit"]);

  draw([task("t-1", "Invite expiry", 3), task("t-2", "Retry audit", 9)]);

  assert.deepEqual(names(container), ["Invite expiry", "Retry audit"]);
});

test("folded away and back, the sidebar sorts its tasks where they stand now", () => {
  const { container, draw } = mountSidebar([
    task("t-1", "Invite expiry", 3),
    task("t-2", "Retry audit", 2),
  ]);
  const updated = [task("t-1", "Invite expiry", 3), task("t-2", "Retry audit", 9)];
  draw(updated);

  draw(updated, { folded: true });
  draw(updated);

  assert.deepEqual(names(container), ["Retry audit", "Invite expiry"]);
});

test("a task newly listed stands where it sorts, those drawn already holding theirs", () => {
  const { container, draw } = mountSidebar([
    task("t-1", "Invite expiry", 3),
    task("t-2", "Retry audit", 2),
  ]);

  draw([
    task("t-1", "Invite expiry", 3),
    task("t-2", "Retry audit", 9),
    task("t-3", "Billing export", 5),
  ]);

  assert.deepEqual(names(container), ["Billing export", "Invite expiry", "Retry audit"]);
});

test("ordered by name, the reader's own rename moves its task at once, though a teammate's holds", () => {
  window.localStorage.setItem(
    "luke.sidebarTaskViews",
    JSON.stringify({ [WORKSPACE.id]: { grouping: "none", order: "name" } }),
  );
  const { container, draw } = mountSidebar([
    task("t-1", "Invite expiry", 3),
    task("t-2", "Retry audit", 2),
    task("t-3", "Usage report", 1),
  ]);
  assert.deepEqual(names(container), ["Invite expiry", "Retry audit", "Usage report"]);

  draw([
    task("t-1", "Invite expiry", 3),
    task("t-2", "Retry audit", 2),
    task("t-3", "Audit log", 1),
  ]);
  assert.deepEqual(names(container), ["Invite expiry", "Retry audit", "Audit log"]);

  const renamed = [
    task("t-1", "Invite expiry", 3),
    task("t-2", "Zero downtime", 2),
    task("t-3", "Audit log", 1),
  ];
  draw(renamed, { pendingTasks: new Set(["t-2"]) });
  assert.deepEqual(names(container), ["Invite expiry", "Audit log", "Zero downtime"]);

  // Once the view carries the name, the task stands where the rename put it.
  draw(renamed);
  assert.deepEqual(names(container), ["Invite expiry", "Audit log", "Zero downtime"]);
});
