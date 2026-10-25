// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { TaskSummary } from "@luke/features/task-wire";
import { WORKSPACE_ROLE, type Workspace } from "@luke/features/workspace-wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { handState } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { sidebarProps } from "../testing/desktop-sidebar.js";
import { restOn } from "../testing/hint-rest.js";
import { relayout } from "../testing/resize-observer.js";
import { tasksControl } from "../testing/tasks-control.js";
import { DesktopSidebar } from "./desktop-sidebar.js";

/**
 * sidebar-task-name.test.ts -- a sidebar task's name held to its row's one line: fading out where the row cuts it, never ending hard, and named whole by the row's hint while it is cut. Synthetic.
 */

const WORKSPACE: Workspace = {
  id: "workspace-personal",
  name: "Ada Lovelace",
  role: WORKSPACE_ROLE.OWNER,
  github: null,
};

const LONG_NAME = "Teammate invitations expire after seven days unless renewed";
const SHORT_NAME = "Retry audit";

const roots: Root[] = [];

beforeEach(() => {
  window.localStorage.clear();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
  handState({});
});

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function task(id: string, name: string): TaskSummary {
  return {
    id,
    workspaceId: WORKSPACE.id,
    name,
    createdAt: 1,
    updatedAt: 2,
    repository: "acme/relay",
  };
}

/** The sidebar over a task with a name too long for its row and one that fits. */
async function mountSidebar(): Promise<HTMLElement> {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  const tasks = tasksControl({
    tasks: [
      task("0a1b2c3d-0000-4000-8000-100000000001", LONG_NAME),
      task("0a1b2c3d-0000-4000-8000-100000000002", SHORT_NAME),
    ],
    workspaces: [WORKSPACE],
    workspace: WORKSPACE,
  });
  act(() =>
    root.render(
      onRegistry(AtomRegistry.make(), createElement(DesktopSidebar, sidebarProps(tasks))),
    ),
  );
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
  return container;
}

/** The row's press for the task named `name`, whose name stands in a line of its own. */
function rowOf(sidebar: HTMLElement, name: string): HTMLElement {
  const row = [...sidebar.querySelectorAll<HTMLElement>(".sidebar-tasks > li > button")].find(
    (each) => each.querySelector(".luke-list-row-title .luke-one-line")?.textContent === name,
  );
  return row ?? assert.fail(`no ${name} row`);
}

/** Lays the row's name out narrower than it runs, as a narrow sidebar does, and tells the window. */
function cutShort(words: Element): void {
  Object.defineProperty(words, "scrollWidth", { configurable: true, value: 320 });
  Object.defineProperty(words, "clientWidth", { configurable: true, value: 180 });
  act(() => relayout());
}

/** The pill the pointer resting on `target` raises, or nothing where it raises none. */
function pillOver(target: Element): string | undefined {
  restOn(target);
  const pill = document.querySelector('[role="tooltip"]:not([inert])')?.textContent ?? undefined;
  act(() => target.dispatchEvent(new MouseEvent("pointerout", { bubbles: true })));
  return pill;
}

test("a task name cut short by its row fades out where it is cut, and the row's hint says it whole", async () => {
  const sidebar = await mountSidebar();
  const row = rowOf(sidebar, LONG_NAME);
  const name = row.querySelector<HTMLElement>(".luke-list-row-title .luke-one-line");
  assert.ok(name);
  assert.equal(name.dataset.overflow, "false");

  cutShort(name);

  assert.equal(name.dataset.end, "fade");
  assert.equal(name.dataset.overflow, "true");
  assert.ok(pillOver(row)?.startsWith(LONG_NAME));
});
