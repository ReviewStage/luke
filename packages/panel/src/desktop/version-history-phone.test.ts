// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACCOUNT_STATUS } from "@luke/credentials/snapshot";
import { PLAN_ACTOR } from "@luke/features/task-wire";
import { ACT_KIND } from "@luke/host/acts";
import { DOCUMENT_REGION, TASKS_PAGE } from "@luke/ui/tasks-model";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import type { NavigationHistory } from "../navigation-history.js";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import { HISTORY_READ } from "../tasks/use-plan-history.js";
import type { VersionHistoryControl } from "../tasks/use-tasks-tab.js";
import { fakeActPort, fakeAppBridge } from "../testing/app-bridge.js";
import { DOCUMENT_TASK } from "../testing/document-task.js";
import { menuItems, pressInPhoneHead, readPhoneHead } from "../testing/phone-head.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { tasksControl } from "../testing/tasks-control.js";
import { TaskVersionHistory } from "./desktop-version-history.js";
import { SIDEBAR_OVERLAY } from "./sidebar-collapse.js";

/**
 * version-history-phone.test.ts -- a plan's version history on a phone is
 * headed as every phone's page is: its list by one way out, named for the
 * step Back goes to, or from a revision's sections back to every version,
 * and its title, with no Back and Forward; a version by the way back to the
 * list, when it was saved, and a ⋯ holding its restore. A wide room keeps
 * its rows and bar. Synthetic plan and revisions.
 */

const ignore = (): void => undefined;

/** A revision of the plan by the developer. */
function line(seq: number) {
  return {
    seq,
    lastEdit: { actor: PLAN_ACTOR.DEVELOPER, at: 10 * seq, duringCall: false },
    startedAt: 10 * seq,
    changes: 2,
  };
}

/** Back's list as it stands over the history: the Inbox the plan was opened from. */
const FROM_INBOX: NavigationHistory = {
  canGoBack: true,
  canGoForward: false,
  onBack: ignore,
  onForward: ignore,
  steps: {
    back: [{ at: 0, title: { label: "Inbox" }, page: { kind: "inbox", of: undefined } }],
    forward: [],
  },
  onGoTo: ignore,
};

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

/** The plan's version history in `room` over its versions 3 and 2, as `history` stands, every way out written down. */
function drawn(
  room: ShellRoom,
  history: Partial<VersionHistoryControl>,
): { view: HTMLElement; exits: string[] } {
  const exits: string[] = [];
  const base = tasksControl();
  const tasks = tasksControl({
    page: TASKS_PAGE.DOCUMENT,
    activeTaskId: DOCUMENT_TASK.id,
    region: { kind: DOCUMENT_REGION.READY, task: DOCUMENT_TASK },
    history: {
      ...base.history,
      open: true,
      list: { kind: HISTORY_READ.READY, revisions: [line(3), line(2)], earlier: undefined },
      selected: 3,
      onList: () => exits.push("list"),
      onCloseSections: () => exits.push("sections"),
      ...history,
    },
  });
  const view = document.body.appendChild(document.createElement("div"));
  const root = createRoot(view);
  roots.push(root);
  act(() =>
    root.render(
      createElement(TaskVersionHistory, {
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
        history: FROM_INBOX,
        tasks,
        account: { status: ACCOUNT_STATUS.SIGNED_IN, email: "dev@example.com", provider: "github" },
        onExit: () => exits.push("exit"),
        onRestored: ignore,
      }),
    ),
  );
  return { view, exits };
}

/** Version 2 read and shown, against nothing before it. */
const VIEWING_2: Partial<VersionHistoryControl> = {
  selected: 2,
  listed: false,
  viewing: {
    line: line(2),
    current: false,
    read: {
      kind: HISTORY_READ.READY,
      document: { body: "## Rollout\n\nShip it.\n", assumptions: [] },
      previous: null,
    },
  },
};

test("on a phone the versions are headed by the way out alone, named for the step Back goes to, and their title centred, with no Back and Forward, and the way out leaves as Back did", () => {
  const { view, exits } = drawn(SHELL_ROOM.NARROW, { listed: true });

  assert.deepEqual(readPhoneHead(view, "version-log"), {
    start: ["Back to Inbox"],
    title: "Version history",
    end: [],
  });
  const names = [...view.querySelectorAll("button")].map((each) => each.getAttribute("aria-label"));
  assert.ok(!names.includes("Back") && !names.includes("Forward"), "no Back and Forward stand");
  assert.equal(view.querySelectorAll('nav[aria-label="Versions"] h1').length, 1);
  pressInPhoneHead(view, "version-log", "Back to Inbox");
  assert.deepEqual(exits, ["exit"]);
});

test("on a phone a revision's sections are headed by the way back to every version, which closes them, in place of the All versions row", () => {
  const { view, exits } = drawn(SHELL_ROOM.NARROW, {
    listed: true,
    spot: { revision: 3, opened: { seq: 3, heading: undefined } },
  });

  assert.deepEqual(readPhoneHead(view, "version-log").start, ["Back to All versions"]);
  assert.ok(
    ![...view.querySelectorAll(".luke-nav-item-name")].some(
      (each) => each.textContent === "All versions",
    ),
    "no All versions row",
  );
  pressInPhoneHead(view, "version-log", "Back to All versions");
  assert.deepEqual(exits, ["sections"]);
});

test("on a phone a version is headed by the way back to the list, when it was saved, and a ⋯ holding Restore this version", () => {
  const { view, exits } = drawn(SHELL_ROOM.NARROW, VIEWING_2);

  const head = readPhoneHead(view, "version");
  assert.deepEqual([head.start, head.end], [["Back to Versions"], ["More"]]);
  assert.ok(head.title, "the moment it was saved is the title");
  assert.ok(
    ![...view.querySelectorAll("button")].some(
      (each) => each.textContent === "Restore this version",
    ),
    "no Restore button in the header",
  );
  pressInPhoneHead(view, "version", "More");
  assert.deepEqual(menuItems(), [{ label: "Restore this version", disabled: false }]);
  pressInPhoneHead(view, "version", "Back to Versions");
  assert.deepEqual(exits, ["list"]);
});

test("on a phone the newest version's restore stands unavailable in the ⋯, as its button does", () => {
  const { view } = drawn(SHELL_ROOM.NARROW, {
    ...VIEWING_2,
    selected: 3,
    viewing: VIEWING_2.viewing && { ...VIEWING_2.viewing, line: line(3), current: true },
  });

  pressInPhoneHead(view, "version", "More");
  assert.deepEqual(menuItems(), [{ label: "Restore this version", disabled: true }]);
});

test("a wide room keeps the versions' Back row and title and a version's Restore button, with no phone's header", () => {
  const { view } = drawn(SHELL_ROOM.WIDE, VIEWING_2);

  assert.equal(view.querySelector("header.phone-head"), null);
  assert.equal(view.querySelector(".version-log-title")?.textContent, "Version history");
  assert.ok(
    [...view.querySelectorAll("button")].some(
      (each) => each.textContent === "Restore this version",
    ),
    "the version's bar offers its restore",
  );
});
