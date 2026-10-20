// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { TaskSummary } from "@luke/features/task-wire";
import { WORKSPACE_ROLE, type Workspace } from "@luke/features/workspace-wire";
import { ACT_OUTCOME_STATUS } from "@luke/host/acts";
import { EXPERIMENT } from "@luke/settings";
import { experimentsOn } from "@luke/settings/testing";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import { fakeAppBridge } from "../testing/app-bridge.js";
import { handState } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { sidebarProps } from "../testing/desktop-sidebar.js";
import { tasksControl } from "../testing/tasks-control.js";
import { DesktopSidebar } from "./desktop-sidebar.js";

/**
 * sidebar-drawer-narrow.test.ts -- a phone's drawer gives its tasks the column: the pages' rows scroll away with them, and an empty Pinned, a place to drag a first pin that a phone cannot drag to, stands nowhere; beside the work the rows stand put over the tasks and the empty Pinned stays.
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
  fakeAppBridge({
    act: () => Promise.resolve({ status: ACT_OUTCOME_STATUS.REFUSED, reason: "Not here." }),
  });
  handState(experimentsOn(EXPERIMENT.SECTIONS));
});

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
});

function task(n: number, name: string): TaskSummary {
  return {
    id: `0a1b2c3d-0000-4000-8000-${String(n).padStart(12, "0")}`,
    workspaceId: WORKSPACE.id,
    name,
    createdAt: 1,
    updatedAt: 2 + n,
    repository: "acme/relay",
  };
}

/** The sidebar in the room given, listing a few tasks and pinning none. */
async function mountIn(room: ShellRoom): Promise<HTMLElement> {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  const tasks = tasksControl({
    tasks: [task(1, "Invite expiry"), task(2, "Retry audit")],
    workspaces: [WORKSPACE],
    workspace: WORKSPACE,
    taskSections: { sections: [], entries: [] },
  });
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(DesktopSidebar, { ...sidebarProps(tasks), room }),
      ),
    ),
  );
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
  return container;
}

/** Where the sidebar draws the Home row and the Tasks list: whether each stands in the column's scroller. */
function scrolled(sidebar: HTMLElement) {
  const scroller =
    sidebar.querySelector(".sidebar-section .luke-scroll-area") ?? assert.fail("the scroller");
  const home =
    [...sidebar.querySelectorAll("button")].find((each) => each.textContent?.startsWith("Home")) ??
    assert.fail("the Home row");
  const list = sidebar.querySelector('nav[aria-label="Tasks"]') ?? assert.fail("the Tasks list");
  return { home: scroller.contains(home), tasks: scroller.contains(list) };
}

test("in a phone's drawer the pages' rows scroll with the tasks, and an empty Pinned stands nowhere", async () => {
  const sidebar = await mountIn(SHELL_ROOM.NARROW);

  assert.deepEqual(scrolled(sidebar), { home: true, tasks: true });
  assert.equal(sidebar.querySelector('nav[aria-label="Pinned"]'), null);
});

test("beside the work the pages' rows stand put over the tasks' scroller, and an empty Pinned waits for a first pin", async () => {
  const sidebar = await mountIn(SHELL_ROOM.WIDE);

  assert.deepEqual(scrolled(sidebar), { home: false, tasks: true });
  assert.ok(sidebar.querySelector('nav[aria-label="Pinned"]'), "Pinned stands");
  assert.match(sidebar.textContent ?? "", /Drag tasks here to pin them/u);
});
