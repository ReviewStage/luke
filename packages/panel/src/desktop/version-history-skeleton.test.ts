// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACCOUNT_STATUS } from "@luke/credentials/snapshot";
import { DOCUMENT_REGION, TASKS_PAGE } from "@luke/ui/tasks-model";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import { HISTORY_READ, type PlanHistoryControl } from "../tasks/use-plan-history.js";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { DOCUMENT_TASK } from "../testing/document-task.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { tasksControl } from "../testing/tasks-control.js";
import { DesktopVersionHistory, taskVersionSubject } from "./desktop-version-history.js";
import { SIDEBAR_OVERLAY } from "./sidebar-collapse.js";

/**
 * version-history-skeleton.test.ts -- while a plan's versions are read, the
 * list stands its blocks in a version's own row and the page in its own
 * bar, so both land where their blocks stood. Synthetic plan.
 */

const ignore = (): void => undefined;

const roots: Root[] = [];

beforeEach(() => {
  installScrollIntoView();
  fakeAppPlatform(QUIET_PANEL);
});

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
});

/** The plan's version history over the window, its list as `list` says. */
function drawn(list: PlanHistoryControl["list"], room: ShellRoom = SHELL_ROOM.WIDE): HTMLElement {
  const base = tasksControl();
  const tasks = tasksControl({
    page: TASKS_PAGE.DOCUMENT,
    activeTaskId: DOCUMENT_TASK.id,
    region: { kind: DOCUMENT_REGION.READY, task: DOCUMENT_TASK },
    history: { ...base.history, open: true, list, selected: undefined },
  });
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(DesktopVersionHistory, {
        sidebar: {
          collapsed: false,
          compact: false,
          overlay: SIDEBAR_OVERLAY.CLOSED,
          width: 264,
          onToggle: ignore,
          onOverlay: ignore,
          onResize: ignore,
          staged: false,
        },
        room,
        history: {
          canGoBack: false,
          canGoForward: false,
          onBack: ignore,
          onForward: ignore,
          steps: { back: [], forward: [] },
          onGoTo: ignore,
        },
        subject: taskVersionSubject(tasks),
        account: { status: ACCOUNT_STATUS.SIGNED_IN, email: "dev@example.com", provider: "github" },
        onExit: ignore,
        onRestored: ignore,
      }),
    ),
  );
  return container;
}

test("in a narrow room the page's bar is led by the way back to the list, which stands at the column's own edge", () => {
  const page = drawn({ kind: HISTORY_READ.READING }, SHELL_ROOM.NARROW).querySelector(
    ".version-page",
  );
  const banner = page?.querySelector("header.luke-toolbar");
  assert.ok(banner?.querySelector(".luke-toolbar-lead button"), "the way back leads the bar");
});
