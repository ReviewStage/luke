// @vitest-environment jsdom

import { MOTION_DELAY_MS } from "@luke/brand";
import { ACCOUNT_STATUS } from "@luke/credentials/snapshot";
import { PLAN_ACTOR } from "@luke/features/task-wire";
import { WORKSPACE_ROLE } from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import { DOCUMENT_REGION, TASKS_PAGE } from "@luke/ui/tasks-model";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
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
 * a row from outside the list chooses nothing; and where older versions wait,
 * the list's foot says how many and reads the next page on its press, or says
 * the read failed and offers Retry; and the Back row at the list's head goes
 * back, its hint, raised by the keyboard's focus, saying where it leads.
 * Synthetic plan and people.
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

/** The plan's version history with versions 3, 2, and 1 listed and 3 chosen, each version chosen after it heard in `chosen`; `earlier` is where older versions are read before, and `onLoadEarlier` reads them. */
function drawn(
  chosen: number[],
  older: { earlier?: number; onLoadEarlier?: () => Promise<boolean> } = {},
  onExit: () => void = ignore,
  stepBehind: string | undefined = undefined,
): HTMLElement {
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
        earlier: older.earlier,
      },
      selected: 3,
      onSelect: (seq: number) => chosen.push(seq),
      ...(older.onLoadEarlier === undefined ? {} : { onLoadEarlier: older.onLoadEarlier }),
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
          canGoBack: stepBehind !== undefined,
          canGoForward: false,
          onBack: onExit,
          onForward: ignore,
          steps: {
            back:
              stepBehind === undefined
                ? []
                : [{ at: 0, title: { label: stepBehind }, page: { kind: "inbox", of: undefined } }],
            forward: [],
          },
          onGoTo: ignore,
        },
        subject: taskVersionSubject(tasks),
        account: { status: ACCOUNT_STATUS.SIGNED_IN, email: "dev@example.com", provider: "github" },
        onExit,
        onRestored: ignore,
      }),
    ),
  );
  return container;
}

/** The Back row at the head of the versions' column. */
function backRow(view: HTMLElement): HTMLButtonElement | undefined {
  return [...view.querySelectorAll<HTMLButtonElement>(".version-log > button")].find(
    (button) => button.textContent?.trim() === "Back",
  );
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

/** The foot under the version list, which is the only button in it besides the rows. */
function foot(view: HTMLElement): HTMLButtonElement | null {
  return view.querySelector<HTMLButtonElement>(".version-earlier .luke-line-button");
}

test("the foot counts the older versions, and reading them is its press", async () => {
  // Version 3 is the oldest listed, so versions 2 and 1 are the older ones.
  const read: Array<(landed: boolean) => void> = [];
  const view = drawn([], {
    earlier: 3,
    onLoadEarlier: () => new Promise<boolean>((landed) => read.push(landed)),
  });
  expect(foot(view)?.textContent).toBe("Show 2 more");

  act(() => foot(view)?.click());
  expect(foot(view)?.getAttribute("aria-label")).toBe("Reading older versions");
  act(() => foot(view)?.click());
  expect(read).toHaveLength(1);

  await act(async () => read[0]?.(true));
  expect(foot(view)?.textContent).toBe("Show 2 more");
});

test("a read of older versions that failed says so with Retry, which reads again", async () => {
  const outcomes = [false, true];
  let reads = 0;
  const view = drawn([], {
    earlier: 3,
    onLoadEarlier: () => Promise.resolve(outcomes[reads++] ?? true),
  });
  await act(async () => foot(view)?.click());
  expect(foot(view)).toBeNull();
  expect(view.querySelector('[role="alert"]')?.textContent).toContain(
    "Could not read older versions.",
  );

  const retry = [...view.querySelectorAll("button")].find((each) => each.textContent === "Retry");
  await act(async () => retry?.click());
  expect(reads).toBe(2);
  expect(view.querySelector('[role="alert"]')).toBeNull();
  expect(foot(view)?.textContent).toBe("Show 2 more");
});

test("a list with no older versions has no foot", () => {
  expect(foot(drawn([]))).toBeNull();
});

/** Rests the keyboard's focus on `button` past the hint's wait, on a faked clock, and answers what the hint says. */
function hintOf(button: HTMLButtonElement): string | null | undefined {
  document.documentElement.dataset.keyboard = "true";
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  act(() => button.focus());
  act(() => {
    vi.advanceTimersByTime(MOTION_DELAY_MS.HINT);
  });
  vi.useRealTimers();
  delete document.documentElement.dataset.keyboard;
  return document.querySelector('[role="tooltip"]')?.textContent;
}

test("the Back row leaves the history when pressed, and its hint says where it leads", () => {
  let exits = 0;
  const view = drawn([], {}, () => {
    exits += 1;
  });
  const back = backRow(view);
  expect(back).toBeDefined();
  if (back === undefined) return;
  expect(hintOf(back)).toContain(`Back to ${DOCUMENT_TASK.name}`);

  act(() => back.click());
  expect(exits).toBe(1);
});

test("the Back row names the page the window goes back to, where the history opened from another", () => {
  const view = drawn([], {}, ignore, "Inbox");
  const back = backRow(view);
  expect(back).toBeDefined();
  if (back === undefined) return;
  expect(hintOf(back)).toContain("Back to Inbox");
});
