// @vitest-environment jsdom

import assert from "node:assert/strict";
import { TASK_STATUS, type TaskStatus, type TaskSummary } from "@luke/features/task-wire";
import { WORKSPACE_ROLE, type Workspace } from "@luke/features/workspace-wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { fakeAppBridge } from "../testing/app-bridge.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { sidebarProps } from "../testing/desktop-sidebar.js";
import { pointerCross } from "../testing/pointer-cross.js";
import { tasksControl } from "../testing/tasks-control.js";
import { DesktopSidebar } from "./desktop-sidebar.js";

/**
 * sidebar-held-order.test.ts -- the sidebar's tasks hold the places they
 * were first drawn in while the pointer is over the sidebar, so an update
 * that would sort a task elsewhere moves nothing under the reader's hand;
 * once the pointer leaves, or the sidebar is folded away and back, the list
 * is sorted anew. Synthetic throughout.
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

/**
 * The sidebar over the tasks given, the pointer resting on it, a way to draw
 * it again over others, in sight or folded away, as an update does, and a
 * way to take the pointer off it.
 */
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
  const tasksNav = container.querySelector('nav[aria-label="Tasks"]');
  assert.ok(tasksNav !== null);
  pointerCross(document.body, tasksNav);
  return { container, draw, leave: () => pointerCross(tasksNav, document.body) };
}

/** The names of the tasks drawn under Tasks, in the order drawn. */
function names(sidebar: HTMLElement): string[] {
  const region = sidebar.querySelector('nav[aria-label="Tasks"]');
  return [...(region?.querySelectorAll(".luke-list-row-title") ?? [])].map(
    (name) => name.firstChild?.textContent ?? "",
  );
}

test("a task an update would sort first holds its place while the pointer is over the sidebar", () => {
  const { container, draw } = mountSidebar([
    task("t-1", "Invite expiry", 3),
    task("t-2", "Retry audit", 2),
  ]);
  assert.deepEqual(names(container), ["Invite expiry", "Retry audit"]);

  draw([task("t-1", "Invite expiry", 3), task("t-2", "Retry audit", 9)]);

  assert.deepEqual(names(container), ["Invite expiry", "Retry audit"]);
});

test("once the pointer leaves the sidebar, its tasks sort where they stand now", () => {
  const { container, draw, leave } = mountSidebar([
    task("t-1", "Invite expiry", 3),
    task("t-2", "Retry audit", 2),
  ]);
  draw([task("t-1", "Invite expiry", 3), task("t-2", "Retry audit", 9)]);

  leave();

  assert.deepEqual(names(container), ["Retry audit", "Invite expiry"]);
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

test("a chosen child task whose parent the view comes to hide is no longer chosen, so a menu on another chosen row acts on that row alone", () => {
  const working = { status: TASK_STATUS.IN_PROGRESS };
  const listed = (parentStatus: TaskStatus) => [
    { ...task("t-1", "Cleanup", 3), status: parentStatus },
    { ...task("t-2", "Probe", 2), ...working, parentTaskId: "t-1" },
    { ...task("t-3", "Usage report", 1), ...working },
  ];
  const { container, draw } = mountSidebar(listed(TASK_STATUS.IN_PROGRESS));
  const fold = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Child tasks of Cleanup"]',
  );
  act(() => fold?.click());
  const rowOf = (name: string) =>
    [...container.querySelectorAll<HTMLElement>(".sidebar-tasks > li > button")].find((each) =>
      each.textContent?.includes(name),
    ) ?? assert.fail(`no ${name} row`);
  const heading = () => {
    act(() => {
      rowOf("Usage report").dispatchEvent(
        new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 }),
      );
    });
    const words = document.querySelector(".luke-menu-heading")?.textContent;
    act(() => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
    return words;
  };
  for (const name of ["Probe", "Usage report"]) {
    act(() => {
      rowOf(name).dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true }),
      );
    });
  }
  assert.equal(heading(), "2 tasks");

  draw(listed(TASK_STATUS.DONE));
  assert.deepEqual(names(container), ["Usage report"]);
  assert.notEqual(heading(), "2 tasks");
});
