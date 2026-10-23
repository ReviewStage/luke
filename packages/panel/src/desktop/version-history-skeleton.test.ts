// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACCOUNT_STATUS } from "@luke/credentials/snapshot";
import { PLAN_ACTOR } from "@luke/features/task-wire";
import { DOCUMENT_REGION, TASKS_PAGE } from "@luke/ui/tasks-model";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { SHELL_ROOM } from "../shell-room.js";
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
function drawn(list: PlanHistoryControl["list"]): HTMLElement {
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
        room: SHELL_ROOM.WIDE,
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

/** Which of a row's parts it stands: its mark, its words' line under its title, and its time. */
function rowParts(row: Element): string[] {
  return [
    ".luke-list-row-leading",
    ".luke-list-row-title",
    ".luke-list-row-description",
    ".luke-list-row-meta",
  ].filter((part) => row.querySelector(part) !== null);
}

test("while the versions are read, each placeholder row stands a version's own parts, its mark, its author over its summary, and its time", () => {
  const reading = drawn({ kind: HISTORY_READ.READING });
  const placeholders = [...reading.querySelectorAll(".version-log [role='status'] li")];
  assert.ok(placeholders.length > 0);

  const read = drawn({
    kind: HISTORY_READ.READY,
    revisions: [
      {
        seq: 2,
        lastEdit: { actor: PLAN_ACTOR.NOTETAKER, at: 20, duringCall: true },
        startedAt: 20,
        changes: 2,
      },
    ],
    earlier: undefined,
  });
  const version = read.querySelector("[aria-label='Version list'] li");
  assert.ok(version);
  for (const row of placeholders) assert.deepEqual(rowParts(row), rowParts(version));
});

test("while the version it opens on is found, the page's bar stands blocks where its moment and its Restore will", () => {
  const page = drawn({ kind: HISTORY_READ.READING }).querySelector(".version-page");
  assert.ok(page?.querySelector(".desktop-toolbar-title .luke-skeleton"), "the moment's place");
  assert.ok(page?.querySelector(".desktop-toolbar-actions .luke-skeleton"), "Restore's place");
});
