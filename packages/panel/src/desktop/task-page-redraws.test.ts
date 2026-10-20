// @vitest-environment jsdom

/**
 * task-page-redraws.test.ts -- what the open task's page draws again when it is drawn again itself: over the same task, neither its Call tab's transcript nor its plan; over a transcript that moved, the Call tab.
 *
 * The page is drawn through `DesktopTasks` on a task control that stands
 * across draws, as the window's does while its tasks do not move, and drawn
 * again with other captions, which the page alone reads. What is drawn
 * again is read through wrappers around a call's heading, under the Call
 * tab, and the plan's key line, under the plan, which draw the real ones.
 * Synthetic task.
 */

import assert from "node:assert/strict";
import type { Task } from "@luke/features/task-wire";
import { DOCUMENT_REGION, TASKS_PAGE } from "@luke/ui/tasks-model";
import { TRANSCRIPT_REGION, type TranscriptRegion } from "@luke/voice/transcript-model";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test, vi } from "vitest";
import { MAIN_TAB } from "../tasks/use-main-tabs.js";
import { SIDE_PANEL_TAB } from "../tasks/use-side-panel.js";
import { NO_LOOKS } from "../tasks/use-task-looks.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { handState } from "../testing/app-state.js";
import { tasksControl, UNPINNED_SUMMARY } from "../testing/tasks-control.js";
import { DesktopTasks } from "./desktop-tasks.js";

/** How many times each recorded part was drawn, by its name. */
const draws = vi.hoisted(() => new Map<string, number>());

// Note that each wrapper draws the real part beneath it and only counts,
// because what is under test is whether the page draws it, not what it draws.
vi.mock("../tasks/call-card.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../tasks/call-card.js")>();
  const { createElement: draw } = await import("react");
  return {
    ...actual,
    CallCheckpoint: (props: Parameters<typeof actual.CallCheckpoint>[0]) => {
      draws.set("call", (draws.get("call") ?? 0) + 1);
      return draw(actual.CallCheckpoint, props);
    },
  };
});
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

/** One call on the task, its two lines as said. */
function transcriptOf(answer: string): TranscriptRegion {
  return {
    kind: TRANSCRIPT_REGION.READY,
    earlierOmitted: false,
    calls: [
      {
        key: "call-1",
        startedAt: 1_000,
        live: false,
        lukeEnded: false,
        messages: [
          { id: "0", role: "user", parts: [{ type: "text", text: "Invites should expire." }] },
          { id: "1", role: "assistant", parts: [{ type: "text", text: answer }] },
        ],
      },
    ],
  };
}

/** The task open on its Call tab, its plan in the side panel, its transcript as given. */
function openTask(transcript: TranscriptRegion): TasksControl {
  const standing = tasksControl();
  return tasksControl({
    page: TASKS_PAGE.DOCUMENT,
    activeTaskId: TASK.id,
    region: { kind: DOCUMENT_REGION.READY, task: TASK },
    mainTabs: { ...standing.mainTabs, tab: MAIN_TAB.CALL },
    sidePanel: { ...standing.sidePanel, open: true, tab: SIDE_PANEL_TAB.PLAN },
    transcript: { region: transcript, onRetry: () => undefined },
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

/** The page drawn over `tasks`, every part's count then cleared. */
function openPage(tasks: TasksControl): void {
  fakeAppPlatform(QUIET_PANEL);
  handState({});
  root = createRoot(document.body.appendChild(document.createElement("div")));
  drawPage(tasks, "Luke is listening.");
  assert.ok((draws.get("call") ?? 0) > 0, "the Call tab draws its call");
  assert.ok((draws.get("plan") ?? 0) > 0, "the side panel draws the plan");
  draws.clear();
}

test("the task's page drawn again over the same task draws neither its call nor its plan again", () => {
  const tasks = openTask(transcriptOf("After how many days?"));
  openPage(tasks);
  drawPage(tasks, "Luke is speaking.");
  assert.equal(draws.get("call") ?? 0, 0, "the Call tab's transcript is not drawn again");
  assert.equal(draws.get("plan") ?? 0, 0, "the plan is not drawn again");
});

test("the task's page drawn over a transcript that moved draws its call again", () => {
  openPage(openTask(transcriptOf("After how many days?")));
  drawPage(openTask(transcriptOf("After a week, then.")), "Luke is listening.");
  assert.ok((draws.get("call") ?? 0) > 0, "the Call tab's transcript is drawn again");
});
