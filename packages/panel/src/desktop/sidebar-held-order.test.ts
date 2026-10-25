// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { TaskSummary } from "@luke/features/task-wire";
import { WORKSPACE_ROLE, type Workspace } from "@luke/features/workspace-wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, onTestFinished, test } from "vitest";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { fakeAppBridge } from "../testing/app-bridge.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { sidebarProps } from "../testing/desktop-sidebar.js";
import { playListMotions } from "../testing/pane-motion.js";
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

/** Each group under Tasks, by the name its fold reads, with its tasks' names in the order drawn. */
function groups(sidebar: HTMLElement): [string, string[]][] {
  const region = sidebar.querySelector('nav[aria-label="Tasks"]');
  return [...(region?.querySelectorAll<HTMLElement>(".sidebar-repository") ?? [])].map((group) => {
    const fold = group.querySelector("button[aria-expanded]");
    const heard = [...(fold?.children ?? [])].find(
      (part) => part.getAttribute("aria-hidden") !== "true",
    );
    const titles = [...group.querySelectorAll(".luke-list-row-title")];
    return [heard?.textContent ?? "", titles.map((name) => name.firstChild?.textContent ?? "")];
  });
}

test("grouped by assignee, a task given to someone else moves to their group at once, its old header still naming who it named", () => {
  const shared = { ...WORKSPACE, memberCount: 2 };
  window.localStorage.setItem(
    "luke.sidebarTaskViews",
    JSON.stringify({ [WORKSPACE.id]: { grouping: "assignee", order: "updated" } }),
  );
  const ada = { userId: "user-ada", name: "Ada Lovelace" };
  const grace = { userId: "user-grace", name: "Grace Hopper" };
  const rest = { workspace: shared, workspaces: [shared] };
  const { container, draw } = mountSidebar([]);
  draw(
    [
      { ...task("t-1", "Invite expiry", 3), assignee: ada },
      { ...task("t-2", "Retry audit", 2), assignee: ada },
      { ...task("t-3", "Usage report", 1), assignee: grace },
    ],
    rest,
  );

  draw(
    [
      { ...task("t-1", "Invite expiry", 3), assignee: grace },
      { ...task("t-2", "Retry audit", 2), assignee: ada },
      { ...task("t-3", "Usage report", 1), assignee: grace },
    ],
    rest,
  );

  assert.deepEqual(groups(container), [
    ["Ada Lovelace", ["Retry audit"]],
    ["Grace Hopper", ["Invite expiry", "Usage report"]],
  ]);
});

test("grouped by assignee, a group whose last task is given away slides out where it stood, out of reach, the groups that stay holding their order, and leaves once its exit has played", () => {
  const motions = playListMotions();
  onTestFinished(motions.remove);
  const shared = { ...WORKSPACE, memberCount: 2 };
  window.localStorage.setItem(
    "luke.sidebarTaskViews",
    JSON.stringify({ [WORKSPACE.id]: { grouping: "assignee", order: "updated" } }),
  );
  const ada = { userId: "user-ada", name: "Ada Lovelace" };
  const grace = { userId: "user-grace", name: "Grace Hopper" };
  const rest = { workspace: shared, workspaces: [shared] };
  const { container, draw } = mountSidebar([]);
  draw(
    [
      { ...task("t-1", "Invite expiry", 3), assignee: ada },
      { ...task("t-2", "Retry audit", 2), assignee: ada },
      { ...task("t-3", "Usage report", 1), assignee: grace },
    ],
    rest,
  );

  draw(
    [
      { ...task("t-1", "Invite expiry", 3), assignee: ada },
      { ...task("t-2", "Retry audit", 2), assignee: ada },
      { ...task("t-3", "Usage report", 1), assignee: ada },
    ],
    rest,
  );

  const leaving = container.querySelector<HTMLElement>(".sidebar-repository[data-leaving]");
  assert.match(leaving?.textContent ?? "", /Grace Hopper/u, "its group is drawn on");
  assert.equal(leaving?.hasAttribute("inert"), true, "out of reach while it goes");
  const out = motions.played.find((each) => each.element === leaving);
  assert.equal(out?.keyframes.at(-1)?.opacity, 0, "it fades out as it slides");
  assert.deepEqual(
    [
      ...container.querySelectorAll(".sidebar-repository:not([data-leaving]) .luke-list-row-title"),
    ].map((name) => name.firstChild?.textContent),
    ["Invite expiry", "Retry audit", "Usage report"],
    "the rows that stay keep the order they held",
  );

  act(() => out?.finish());
  assert.equal(container.querySelector("[data-leaving]"), null);
  assert.deepEqual(
    groups(container).map(([heard]) => heard),
    ["Ada Lovelace"],
  );
});
