// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { TaskSummary } from "@luke/features/task-wire";
import { WORKSPACE_ROLE, type Workspace } from "@luke/features/workspace-wire";
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
 * sidebar-drawer-narrow.test.ts -- the column gives its tasks the room: the pages' rows scroll away with them, in a phone's drawer and beside the work alike; and an empty Pinned stands nowhere, under a finger or a mouse, whatever the room.
 */

const WORKSPACE: Workspace = {
  id: "workspace-personal",
  name: "Ada Lovelace",
  role: WORKSPACE_ROLE.OWNER,
  github: null,
};

const roots: Root[] = [];

/** Answers the device's pointer as a finger's where `coarse`, else as a mouse's. */
function pointer(coarse: boolean): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: coarse && query === "(pointer: coarse)",
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
}

beforeEach(() => {
  window.localStorage.clear();
  pointer(false);
  fakeAppBridge({});
  handState({});
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
    taskSections: { sections: [], entries: [], agentEntries: [] },
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

/** Where the sidebar draws the Tasks page's row and the channels: whether each stands in the column's scroller. */
function scrolled(sidebar: HTMLElement) {
  const scroller =
    sidebar.querySelector(".sidebar-section .luke-scroll-area") ?? assert.fail("the scroller");
  const page =
    [...sidebar.querySelectorAll("button")].find((each) => each.textContent?.startsWith("Tasks")) ??
    assert.fail("the Tasks page's row");
  const channels =
    sidebar.querySelector('nav[aria-label="Channels"]') ?? assert.fail("the channels");
  return { page: scroller.contains(page), channels: scroller.contains(channels) };
}

test("in a phone's drawer under a finger the pages' rows scroll with the channels", async () => {
  pointer(true);
  const sidebar = await mountIn(SHELL_ROOM.NARROW);

  assert.deepEqual(scrolled(sidebar), { page: true, channels: true });
});

test("beside the work the pages' rows scroll with the channels too", async () => {
  const sidebar = await mountIn(SHELL_ROOM.WIDE);

  assert.deepEqual(scrolled(sidebar), { page: true, channels: true });
});
