// @vitest-environment jsdom

import assert from "node:assert/strict";
import { TASK_SECTION_ICON_KIND, type TaskSections } from "@luke/features/task-section-wire";
import type { TaskSummary } from "@luke/features/task-wire";
import { WORKSPACE_ROLE, type Workspace } from "@luke/features/workspace-wire";
import { EXPERIMENT } from "@luke/settings";
import { experimentsOn } from "@luke/settings/testing";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { useInboxListing } from "../tasks/use-inbox-listing.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { fakeActPortAnswering } from "../testing/app-bridge.js";
import { handState } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { sidebarProps } from "../testing/desktop-sidebar.js";
import { tasksControl } from "../testing/tasks-control.js";
import { DesktopSidebar } from "./desktop-sidebar.js";
import { useSidebarWalkNow, walkSuccessor } from "./sidebar-walk.js";

/**
 * sidebar-walk.test.ts -- the sidebar publishes the tasks it draws in the
 * order it draws them, pinned first, then its sections', then the list's,
 * the pinned alone where the Inbox's items stand in the list's place, and
 * nothing once it is gone; and the task opened in a leaving one's place
 * is the next drawn that stays, else the nearest before it. Synthetic.
 */

const WORKSPACE: Workspace = {
  id: "workspace-personal",
  name: "Ada Lovelace",
  role: WORKSPACE_ROLE.OWNER,
  github: null,
};

const LAUNCH = "0a1b2c3d-0000-4000-8000-000000000001";

function task(id: string, updatedAt: number, pinnedAt?: number): TaskSummary {
  const summary = {
    id,
    workspaceId: WORKSPACE.id,
    name: id,
    createdAt: 1,
    updatedAt,
    repository: "acme/relay",
  };
  return pinnedAt === undefined ? summary : { ...summary, pinnedAt };
}

/** Launch, holding the sectioned task. */
const SECTIONS: TaskSections = {
  sections: [
    {
      id: LAUNCH,
      workspaceId: WORKSPACE.id,
      title: "Launch",
      icon: { kind: TASK_SECTION_ICON_KIND.EMOJI, emoji: "🚀" },
      createdAt: 1,
    },
  ],
  entries: [{ taskId: "sectioned", sectionId: LAUNCH, addedAt: 2 }],
  agentEntries: [],
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
  handState({});
});

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
});

/** Reads the walk as an archive's press would. */
let walkNow: () => readonly string[] = () => assert.fail("the walk is read");
function WalkReader() {
  walkNow = useSidebarWalkNow();
  return null;
}

/** Lets what the sidebar loads on demand land. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

test("the sidebar publishes the tasks it draws, pinned, then sectioned, then listed, and nothing once it is gone", async () => {
  const tasks = tasksControl({
    tasks: [task("older", 2), task("pinned", 5, 1), task("sectioned", 4), task("newer", 3)],
    workspaces: [WORKSPACE],
    workspace: WORKSPACE,
    taskSections: SECTIONS,
  });
  const registry = AtomRegistry.make();
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  const draw = (sidebar: boolean) =>
    act(() =>
      root.render(
        onRegistry(
          registry,
          createElement(
            Fragment,
            null,
            createElement(WalkReader),
            sidebar ? createElement(DesktopSidebar, sidebarProps(tasks)) : null,
          ),
        ),
      ),
    );

  draw(true);
  await settle();
  const drawn = walkNow();
  draw(false);
  await settle();

  assert.deepEqual(drawn, ["pinned", "sectioned", "newer", "older"]);
  assert.deepEqual(walkNow(), []);
});

/** The inbox-first sidebar, the Inbox's items standing where the list's tasks would. */
function InboxFirstSidebar({ tasks }: { tasks: TasksControl }) {
  const inboxListing = useInboxListing(tasks);
  return createElement(DesktopSidebar, { ...sidebarProps(tasks), inboxListing });
}

test("with the Inbox's items in the list's place, the sidebar publishes the pinned tasks it still draws", async () => {
  fakeActPortAnswering(() => Promise.resolve(undefined));
  handState(experimentsOn(EXPERIMENT.INBOX_FIRST));
  const tasks = tasksControl({
    tasks: [task("listed", 2), task("pinned", 5, 1), task("also-pinned", 4, 2)],
    workspaces: [WORKSPACE],
    workspace: WORKSPACE,
  });
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(
          Fragment,
          null,
          createElement(WalkReader),
          createElement(InboxFirstSidebar, { tasks }),
        ),
      ),
    ),
  );
  await settle();

  assert.ok(document.querySelector('aside .inbox-tasks[data-placement="sidebar"]'));
  // Pinned draws the newest pinned first.
  assert.deepEqual(walkNow(), ["also-pinned", "pinned"]);
});

test("the task opened in a leaving one's place is the next drawn that stays, else the nearest before it, else none", () => {
  const walk = ["a", "b", "c", "d"];
  const leaving = (ids: readonly string[]) => (id: string) => ids.includes(id);

  assert.equal(walkSuccessor(walk, "b", leaving(["b", "c"])), "d");
  assert.equal(walkSuccessor(walk, "d", leaving(["d", "c"])), "b");
  assert.equal(walkSuccessor(walk, "b", leaving(walk)), undefined);
  assert.equal(walkSuccessor(walk, "e", leaving([])), undefined);
});
