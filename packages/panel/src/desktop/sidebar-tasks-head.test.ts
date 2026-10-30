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
 * sidebar-tasks-head.test.ts -- the Tasks head carries its ⋯ and View
 * options, and offers New section from the ⋯ and on a right-click, which
 * asks for the section's title. Synthetic throughout.
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

/** The Tasks section, drawn over one task. */
function mountTasks(): HTMLElement {
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
    container.querySelector<HTMLElement>('nav[aria-label="Tasks"]') ??
    assert.fail("no Tasks section")
  );
}

test("the Tasks head carries its ⋯ and View options, and its ⋯, a right-click, and the keyboard's press on the ⋯ all offer New section, which asks for a title", () => {
  const tasks = mountTasks();
  const head =
    tasks.querySelector<HTMLElement>(".luke-group-header-head") ?? assert.fail("no head");
  assert.deepEqual(
    [...head.querySelectorAll("button[aria-label]")].map((each) => each.getAttribute("aria-label")),
    ["Tasks actions", "View options"],
  );
  const offered = () =>
    [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].map(
      (each) => each.textContent,
    );
  const closeMenu = () =>
    act(() => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });

  act(() => {
    head.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 }));
  });
  assert.deepEqual(offered(), ["New section…"]);
  closeMenu();

  const more =
    head.querySelector<HTMLButtonElement>('button[aria-label="Tasks actions"]') ??
    assert.fail("no ⋯");
  act(() => more.click());
  assert.deepEqual(offered(), ["New section…"]);
  act(() => document.querySelector<HTMLElement>('[role="menuitem"]')?.click());
  assert.ok(document.querySelector('[role="dialog"] input'), "the section dialog asks for a title");
});
