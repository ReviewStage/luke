// @vitest-environment jsdom

import assert from "node:assert/strict";
import { TASK_STATUS, type TaskSummary } from "@luke/features/task-wire";
import { WORKSPACE_ROLE, type Workspace } from "@luke/features/workspace-wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { fakeAppBridge } from "../testing/app-bridge.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { sidebarProps } from "../testing/desktop-sidebar.js";
import { tasksControl } from "../testing/tasks-control.js";
import { DesktopSidebar } from "./desktop-sidebar.js";

/**
 * sidebar-tasks-head.test.ts -- the Tasks head's Filter says the list is
 * filtered once the reader chose other statuses than to do and in progress,
 * and says nothing of it while the list shows those two. Synthetic
 * throughout.
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
  document.body.replaceChildren();
});

function task(id: string, name: string): TaskSummary {
  return {
    id,
    workspaceId: WORKSPACE.id,
    name,
    createdAt: 1,
    updatedAt: 2,
    repository: null,
    status: TASK_STATUS.TODO,
  };
}

/** The Tasks head's Filter, drawn over the view the reader kept, if any. */
function filterButton(view?: object): HTMLButtonElement {
  if (view !== undefined) {
    window.localStorage.setItem(
      "luke.sidebarTaskViews",
      JSON.stringify({ [WORKSPACE.id]: { grouping: "none", order: "updated", ...view } }),
    );
  }
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  const props = sidebarProps(
    tasksControl({
      tasks: [task("t-1", "Invite expiry")],
      workspaces: [WORKSPACE],
      workspace: WORKSPACE,
    }),
  );
  act(() => root.render(onRegistry(AtomRegistry.make(), createElement(DesktopSidebar, props))));
  return (
    container.querySelector<HTMLButtonElement>(
      'nav[aria-label="Tasks"] button[aria-label="Filter"]',
    ) ?? assert.fail("no Filter on the Tasks head")
  );
}

test("Filter says the list is filtered once other statuses are chosen, and nothing while it shows to do and in progress", () => {
  assert.equal(filterButton().getAttribute("aria-description"), null);
  assert.equal(
    filterButton({
      statuses: [TASK_STATUS.BACKLOG, TASK_STATUS.TODO, TASK_STATUS.IN_PROGRESS],
    }).getAttribute("aria-description"),
    "Filtered",
  );
});
