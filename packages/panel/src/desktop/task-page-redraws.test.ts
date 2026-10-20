// @vitest-environment jsdom

/**
 * task-page-redraws.test.ts -- what the open task's page draws again when it is drawn again itself: over the same task, not its plan.
 *
 * The page is drawn through `DesktopTasks` on a task control that stands
 * across draws, as the window's does while its tasks do not move, and drawn
 * again with other captions, which the page alone reads. What is drawn
 * again is read through a wrapper around the plan's key line, which draws
 * the real one. Synthetic task.
 */

import assert from "node:assert/strict";
import type { Task } from "@luke/features/task-wire";
import { DOCUMENT_REGION, TASKS_PAGE } from "@luke/ui/tasks-model";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test, vi } from "vitest";
import { SIDE_PANEL_TAB } from "../tasks/use-side-panel.js";
import { NO_LOOKS } from "../tasks/use-task-looks.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { handState } from "../testing/app-state.js";
import { tasksControl, UNPINNED_SUMMARY } from "../testing/tasks-control.js";
import { DesktopTasks } from "./desktop-tasks.js";

/** How many times each recorded part was drawn, by its name. */
const draws = vi.hoisted(() => new Map<string, number>());

// Note that the wrapper draws the real part beneath it and only counts,
// because what is under test is whether the page draws it, not what it draws.
vi.mock("../tasks/task-standing.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../tasks/task-standing.js")>();
  const { createElement: draw } = await import("react");
  return {
    ...actual,
    TaskKeyLine: (props: Parameters<typeof actual.TaskKeyLine>[0]) => {
      draws.set("plan", (draws.get("plan") ?? 0) + 1);
      return draw(actual.TaskKeyLine, props);
    },
  };
});

const TASK: Task = {
  id: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  workspaceId: "workspace-personal",
  name: "Teammate invitations",
  createdAt: 1,
  updatedAt: 2,
  repository: null,
  document: { body: "## Invites\n\nThey expire after a week.", assumptions: [] },
};

/** The task open on its plan, the plan in the side panel. */
function openTask(): TasksControl {
  const standing = tasksControl();
  return tasksControl({
    page: TASKS_PAGE.DOCUMENT,
    activeTaskId: TASK.id,
    region: { kind: DOCUMENT_REGION.READY, task: TASK },
    sidePanel: { ...standing.sidePanel, open: true, tab: SIDE_PANEL_TAB.PLAN },
  });
}

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

let root: Root | undefined;

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  draws.clear();
});

/** Draws the page over `tasks` with `captions`, as the shell hands them. */
function drawPage(tasks: TasksControl, captions: string): void {
  act(() =>
    root?.render(
      createElement(DesktopTasks, {
        summary: UNPINNED_SUMMARY,
        looks: NO_LOOKS,
        tasks,
        captions: createElement("p", null, captions),
      }),
    ),
  );
}

test("the task's page drawn again over the same task does not draw its plan again", () => {
  fakeAppPlatform(QUIET_PANEL);
  handState({});
  root = createRoot(document.body.appendChild(document.createElement("div")));
  const tasks = openTask();
  drawPage(tasks, "Luke is listening.");
  assert.ok((draws.get("plan") ?? 0) > 0, "the side panel draws the plan");
  draws.clear();

  drawPage(tasks, "Luke is speaking.");
  assert.equal(draws.get("plan") ?? 0, 0, "the plan is not drawn again");
});
