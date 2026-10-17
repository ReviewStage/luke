// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { Task } from "@luke/features/task-wire";
import type { TaskCodeShowing } from "@luke/features/tasks-view";
import { DOCUMENT_REGION, TASKS_PAGE } from "@luke/ui/tasks-model";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { onRegistry } from "#testing/copy-feedback";
import { installScrollIntoView } from "#testing/scroll-into-view";
import { tasksControl, UNPINNED_SUMMARY } from "#testing/tasks-control";
import { DesktopTasks } from "../desktop/desktop-tasks";
import { SIDE_PANEL_TAB } from "./use-side-panel";
import { NO_LOOKS } from "./use-task-looks";

/**
 * file-ref.test.ts -- a file is named one way wherever it stands: its tab,
 * its row in the side panel's "+", and the head of a card of its code wear
 * its type's icon and hang its card, its whole path and Luke's note on its
 * lines, and the card's path opens it on the card's lines.
 */

const TASK: Task = {
  id: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  workspaceId: "workspace-personal",
  name: "Teammate invitations",
  createdAt: 1,
  updatedAt: 2,
  repository: "acme/relay",
  document: { body: "", assumptions: [] },
};

const PATH = "src/invites/accept.ts";

const NOTE = "A used invite is refused here.";

/** Lines 3–5 of the file, as Luke showed them with a note, read at a commit. */
const SHOWING: TaskCodeShowing = {
  callId: "c",
  turnId: "t",
  shownAt: 1_000,
  code: {
    ref: { path: PATH, startLine: 3, endLine: 5 },
    repository: TASK.repository ?? "",
    commit: "0123456789abcdef",
    firstLine: 3,
    lineCount: 9,
    lines: [[{ text: "const a = 1;" }], [{ text: "const b = 2;" }], [{ text: "const c = 3;" }]],
    note: NOTE,
  },
};

const roots: Root[] = [];

beforeEach(installScrollIntoView);

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/**
 * The task open, its side panel on the Code tab holding the file's code,
 * and the file's own tab open beside it, read at `commit` where it names
 * one; each file opened recorded.
 */
function mount(
  opened: unknown[][],
  shownCode: readonly TaskCodeShowing[] = [SHOWING],
  commit?: string,
): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  const base = tasksControl();
  const tab = { path: PATH, range: { startLine: 3, endLine: 5 }, opened: 1 };
  const tasks = tasksControl({
    page: TASKS_PAGE.DOCUMENT,
    activeTaskId: TASK.id,
    region: { kind: DOCUMENT_REGION.READY, task: TASK },
    shownCode,
    sidePanel: {
      ...base.sidePanel,
      open: true,
      tab: SIDE_PANEL_TAB.CODE,
      files: [commit === undefined ? tab : { ...tab, commit }],
      onOpenFile: (...asked) => opened.push(asked),
    },
  });
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(DesktopTasks, { summary: UNPINNED_SUMMARY, looks: NO_LOOKS, tasks }),
      ),
    ),
  );
  return container;
}

/** The card hung while the pointer rests on `element`: its name and its note. */
function cardOn(element: Element | null | undefined): (string | null | undefined)[] {
  assert.ok(element, "the file is named");
  act(() => {
    element.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });
  const card = document.querySelector(".luke-tooltip-card [data-file-card]");
  assert.ok(card, "the file's card is hung");
  const read = [
    card.querySelector(".card-name")?.textContent,
    card.querySelector(".card-note")?.textContent,
  ];
  act(() => {
    element.dispatchEvent(new MouseEvent("pointerout", { bubbles: true }));
  });
  return read;
}

test("a file's tab, its row in the panel's +, and its code card's head wear its type's icon, and the tab and the head hang its card with Luke's note", () => {
  const panel = mount([]).querySelector(".side-panel");
  assert.ok(panel, "the side panel");
  const tab = [...panel.querySelectorAll('[role="tab"]')].find(
    (each) => each.querySelector(".tab-label")?.textContent === "accept.ts",
  );
  assert.ok(tab, "the file's tab");
  const head = panel.querySelector(".code-card [data-file-ref]");
  assert.ok(head, "the code card names the file");
  const icon = tab.querySelector(".tab-icon")?.innerHTML;
  assert.equal(head.querySelector("svg")?.outerHTML, icon, "the head wears the tab's icon");

  const add = panel.querySelector<HTMLButtonElement>("button.tab-add");
  assert.ok(add, "the strip's +");
  act(() => add.click());
  const row = [...document.querySelectorAll('.tab-add-menu [role="option"]')].find(
    (each) => each.querySelector(".task-compose-menu-name")?.textContent === "accept.ts",
  );
  assert.equal(
    row?.querySelector(".menu-item-glyph")?.innerHTML,
    icon,
    'the "+" row wears the tab\'s icon',
  );
  act(() => add.click());

  assert.deepEqual(cardOn(tab), [PATH, NOTE]);
  assert.deepEqual(cardOn(head), [PATH, NOTE]);
});

test("a code card's head says its lines as Lines 3–5, and a press on it opens the file on those lines at the commit Luke read them at", () => {
  const opened: unknown[][] = [];
  const head = mount(opened).querySelector<HTMLButtonElement>(".code-card button[data-file-ref]");
  assert.ok(head, "the code card's head opens the file");
  assert.equal(head.textContent, `${PATH}Lines 3–5`);
  act(() => head.click());
  assert.deepEqual(opened, [[SHOWING.code.ref, SHOWING.code.commit]]);
});

test("a file's tab read at a commit hangs Luke's note on the lines he showed at that commit, never a later showing's, nor another repository's", () => {
  const later: TaskCodeShowing = {
    ...SHOWING,
    callId: "d",
    code: { ...SHOWING.code, commit: "fedcba9876543210", note: "Sends the email." },
  };
  const elsewhere: TaskCodeShowing = {
    ...SHOWING,
    callId: "e",
    code: { ...SHOWING.code, repository: "acme/other", note: "Another repository's file." },
  };
  const panel = mount([], [SHOWING, later, elsewhere], SHOWING.code.commit).querySelector(
    ".side-panel",
  );
  const tab = [...(panel?.querySelectorAll('[role="tab"]') ?? [])].find(
    (each) => each.querySelector(".tab-label")?.textContent === "accept.ts",
  );
  assert.deepEqual(cardOn(tab), [PATH, NOTE]);
});
