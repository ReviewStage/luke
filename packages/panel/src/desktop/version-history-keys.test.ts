// @vitest-environment jsdom

import { ACCOUNT_STATUS } from "@luke/credentials/snapshot";
import { PLAN_ACTOR } from "@luke/features/task-wire";
import { WORKSPACE_ROLE } from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import { DOCUMENT_REGION, TASKS_PAGE } from "@luke/ui/tasks-model";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test } from "vitest";
import { SHELL_ROOM } from "../shell-room.js";
import { HISTORY_READ } from "../tasks/use-plan-history.js";
import { fakeActPort, fakeAppBridge } from "../testing/app-bridge.js";
import { DOCUMENT_TASK } from "../testing/document-task.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { tasksControl } from "../testing/tasks-control.js";
import { DesktopVersionHistory, taskVersionSubject } from "./desktop-version-history.js";
import { SIDEBAR_OVERLAY } from "./sidebar-collapse.js";

/**
 * version-history-keys.test.ts -- the versions are one Tab stop, and ↑ and ↓
 * pressed on a row choose the version they step to, which the page beside the
 * list then shows, rather than only moving the focus there; focus coming onto
 * a row from outside the list chooses nothing. Synthetic plan and people.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ignore = (): void => undefined;

const ACME = {
  id: "workspace-acme",
  name: "Acme",
  slug: "acme",
  role: WORKSPACE_ROLE.MEMBER,
  github: null,
};

/** A revision of the plan by Lee. */
function line(seq: number) {
  return {
    seq,
    lastEdit: {
      actor: PLAN_ACTOR.DEVELOPER,
      by: { userId: "user-lee", name: "Lee Park" },
      at: 10 * seq,
      duringCall: false,
    },
    startedAt: 10 * seq,
    changes: 2,
  };
}

const roots: Root[] = [];

beforeEach(() => {
  installScrollIntoView();
  fakeAppBridge({});
  fakeActPort({
    [ACT_KIND.WORKSPACE_FORMER_MEMBERS_READ]: () => Promise.resolve([]),
    [ACT_KIND.WORKSPACE_MEMBERS_READ]: () => Promise.resolve([]),
  });
});

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
});

/** The plan's version history with versions 3, 2, and 1 listed and 3 chosen, each version chosen after it heard in `chosen`. */
function drawn(chosen: number[]): HTMLElement {
  const base = tasksControl();
  const tasks = tasksControl({
    page: TASKS_PAGE.DOCUMENT,
    activeTaskId: DOCUMENT_TASK.id,
    region: { kind: DOCUMENT_REGION.READY, task: { ...DOCUMENT_TASK, workspaceId: ACME.id } },
    workspaces: [ACME],
    workspace: ACME,
    history: {
      ...base.history,
      open: true,
      list: {
        kind: HISTORY_READ.READY,
        revisions: [line(3), line(2), line(1)],
        earlier: undefined,
      },
      selected: 3,
      onSelect: (seq: number) => chosen.push(seq),
    },
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

/** The version rows' presses, newest first. */
function rowsOf(view: HTMLElement): HTMLButtonElement[] {
  return [
    ...view.querySelectorAll<HTMLButtonElement>('[aria-label="Version list"] .luke-list-row-main'),
  ];
}

/** Presses `name` on whatever holds the focus. */
function key(name: string): void {
  act(() => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }),
    );
  });
}

test("the versions are one Tab stop, and ↑ and ↓ choose the version they step to", () => {
  const chosen: number[] = [];
  const rows = rowsOf(drawn(chosen));
  expect(rows.map((row) => row.tabIndex)).toEqual([0, -1, -1]);
  act(() => rows[0]?.focus());
  key("ArrowDown");
  expect(chosen).toEqual([2]);
  expect(document.activeElement).toBe(rows[1]);
  key("ArrowUp");
  expect(chosen).toEqual([2, 3]);
  expect(rows.map((row) => row.tabIndex)).toEqual([0, -1, -1]);
});

test("focus landing on a version from outside the list does not choose it", () => {
  const chosen: number[] = [];
  const rows = rowsOf(drawn(chosen));
  act(() => rows[1]?.focus());
  expect(chosen).toEqual([]);
});
