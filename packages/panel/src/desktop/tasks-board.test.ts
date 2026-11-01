// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  TASK_PRIORITY,
  TASK_STATUS,
  type TaskPriority,
  type TaskStanding,
  type TaskStatus,
  type TaskSummary,
} from "@luke/features/task-wire";
import type { Workspace, WorkspaceMember } from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import { CARD_PRESS_SELECTOR, CHIP_LOOK } from "@luke/ui";
import {
  COMPLETED_WINDOW,
  DEFAULT_BOARD_DISPLAY,
  NO_TASKS_FILTER,
  TASKS_GROUPING,
  type TasksDisplay,
} from "@luke/ui/tasks-page-model";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { askKept } from "../act.js";
import { runAppCommand } from "../app-commands.js";
import { MemberDirectory } from "../member-directory.js";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import { fakeActPort, fakeAppBridge } from "../testing/app-bridge.js";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { restOn } from "../testing/hint-rest.js";
import { tasksControl } from "../testing/tasks-control.js";
import { newestToastSays } from "../testing/toast.js";
import { ToastHost } from "../toast.js";
import { TasksBoard } from "./tasks-board.js";

/**
 * tasks-board.test.ts -- the Board lays the listed workspace's tasks out
 * on a column for each status, each card its key, priority, name, and
 * creator's face, the most pressing first; a press opens the task, a card
 * dragged onto another column is sent that column's status, or its
 * priority where the view stands columns by priority, and Canceled stands
 * once the view asks for it. A card is changed where it stands: its
 * Priority and Status chips send what is picked, and its ⋯ and a
 * right-click drop the task's own menu, whose Rename makes its name a
 * field, cards are chosen by their box and ⌘-click across columns for the
 * selection bar to act on them all, and its foot draws its agents at work and their pull requests,
 * each its mark and its number, and how many of its sub-tasks are finished. In a narrow room, a phone's, one column stands at a time, chosen
 * by its tab, and a card's Status chip, its mark alone before its name as on a wide board, moves it.
 */

const DEAN = "user-dean";
const CHARLES = "user-charles";

const ACME = {
  id: "workspace-acme",
  name: "Acme",
  role: "owner",
  github: null,
  memberCount: 2,
} as const satisfies Workspace;

const MEMBERS: readonly WorkspaceMember[] = [
  { userId: DEAN, name: "Dean Stratakos", email: "dean@acme.dev", role: "owner" },
  { userId: CHARLES, name: "Charles Pan", email: "charles@acme.dev", role: "member" },
];

const roots: Root[] = [];

/** The tasks the board opened, in order. */
let opened: string[] = [];

/** Each rename the board sent, in order. */
let renamed: [string, string][] = [];

/** Each change of where a task stands the board sent, in order. */
let sent: [string, TaskStanding][] = [];

/** Whether the service keeps the changes sent. */
let keeps = true;

/** Each display the board asked for, in order. */
let displayed: TasksDisplay[] = [];

/** How many times the board was closed. */
let closed = 0;

/** The pages the board opened, in order. */
let pages: string[] = [];

beforeEach(() => {
  opened = [];
  renamed = [];
  sent = [];
  keeps = true;
  closed = 0;
  displayed = [];
  pages = [];
  window.localStorage.clear();
  fakeAppPlatform({
    ...QUIET_PANEL,
    openGitHub: (url) => pages.push(url),
    openWeb: (url) => pages.push(url),
  });
  fakeAppBridge({});
  fakeActPort({ [ACT_KIND.WORKSPACE_MEMBERS_READ]: () => Promise.resolve(MEMBERS) });
});

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

/** A task of Acme's, numbered `number`, standing in `status` at `priority`, by `creator`. */
function task(
  number: number,
  name: string,
  status: TaskStatus,
  priority: TaskPriority,
  creator: string = DEAN,
  updatedAt = 100 - number,
): TaskSummary {
  return {
    id: `t-${number}`,
    workspaceId: ACME.id,
    name,
    repository: "acme/web",
    createdAt: 1,
    updatedAt,
    ownerId: creator,
    createdBy: { userId: creator, name: creator === DEAN ? "Dean Stratakos" : "Charles Pan" },
    status,
    priority,
    number,
  };
}

const TASKS = [
  task(36, "Self-hosting guide", TASK_STATUS.BACKLOG, TASK_PRIORITY.NONE),
  task(38, "Onboarding checklist", TASK_STATUS.BACKLOG, TASK_PRIORITY.MEDIUM, CHARLES),
  task(39, "Rate limit search", TASK_STATUS.TODO, TASK_PRIORITY.HIGH, CHARLES),
  task(40, "Billing after downgrade", TASK_STATUS.TODO, TASK_PRIORITY.URGENT),
  task(42, "Fix Safari login", TASK_STATUS.IN_PROGRESS, TASK_PRIORITY.HIGH),
  task(35, "Migrate auth SDK", TASK_STATUS.DONE, TASK_PRIORITY.HIGH, CHARLES),
  task(33, "Old onboarding copy", TASK_STATUS.CANCELED, TASK_PRIORITY.LOW),
];

/** Draws the Board last mounted again under another display, as its View options would. */
let redrawBoard: (display: TasksDisplay) => void = () => undefined;

/** The Board over `tasks`, under `display`, read by Dean, once the workspace's members have answered. */
async function mountBoard(
  tasks: readonly TaskSummary[] = TASKS,
  room: ShellRoom = SHELL_ROOM.WIDE,
  display: TasksDisplay = DEFAULT_BOARD_DISPLAY,
  overrides: NonNullable<Parameters<typeof tasksControl>[0]> = {},
): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const control = tasksControl({
    tasks: [...tasks],
    workspace: ACME,
    workspaces: [ACME],
    me: DEAN,
    listRead: true,
    onSelect: (taskId) => opened.push(taskId),
    boardView: { open: true, onOpen: () => undefined, onClose: () => (closed += 1) },
    onSetTaskStanding: (taskId, standing) => {
      sent.push([taskId, standing]);
      return askKept(Promise.resolve(keeps));
    },
    onRenameTask: (taskId, name) => {
      renamed.push([taskId, name]);
      return Promise.resolve(true);
    },
    ...overrides,
  });
  const registry = AtomRegistry.make();
  const draw = (shown: TasksDisplay) =>
    root.render(
      onRegistry(
        registry,
        createElement(
          Fragment,
          null,
          createElement(MemberDirectory, {
            workspace: ACME,
            readerId: DEAN,
            children: createElement(TasksBoard, {
              tasks: control,
              room,
              title: "Tasks",
              frame: {
                toolbar: null,
                chips: null,
                filter: NO_TASKS_FILTER,
                display: shown,
                onDisplay: (next) => displayed.push(next),
                scroll: () => undefined,
              },
            }),
          }),
          createElement(ToastHost),
        ),
      ),
    );
  redrawBoard = (shown) => act(() => draw(shown));
  act(() => draw(display));
  await act(async () => undefined);
  return container;
}

/** Each column's name and its cards' keys, in order. */
function columns(board: HTMLElement): [string, string[]][] {
  return [...board.querySelectorAll<HTMLElement>("[data-task-column]")].map((column) => [
    column.getAttribute("aria-label") ?? "",
    [...column.querySelectorAll("[data-task-key]")].map((key) => key.textContent ?? ""),
  ]);
}

/** The chip on a task's card that changes its `standing`, Priority or Status. */
function chipOf(board: HTMLElement, taskId: string, standing: string): HTMLButtonElement {
  const chip = board.querySelector<HTMLButtonElement>(
    `li[data-task-id="${taskId}"] button[aria-label^="${standing}:"]`,
  );
  assert.ok(chip, `the card of ${taskId} wears its ${standing} chip`);
  return chip;
}

/** Presses the item of the open menu whose label is `label`. */
function pick(label: string): void {
  const item = [...document.querySelectorAll<HTMLElement>('[role^="menuitem"]')].find(
    (each) => each.querySelector(".luke-menu-item-label")?.textContent === label,
  );
  act(() => (item ?? assert.fail(`no ${label} item`)).click());
}

/** The card of a task, its press. */
function cardOf(board: HTMLElement, taskId: string): HTMLButtonElement {
  const card = board.querySelector<HTMLButtonElement>(
    `li[data-task-id="${taskId}"] ${CARD_PRESS_SELECTOR}`,
  );
  assert.ok(card, `the card of ${taskId} stands`);
  return card;
}

test("each status has its column, its cards the most pressing first, each its key, priority, name, and assignee, its creator's face left off at first", async () => {
  const board = await mountBoard(TASKS, SHELL_ROOM.WIDE, {
    ...DEFAULT_BOARD_DISPLAY,
    completed: COMPLETED_WINDOW.ALL,
  });

  assert.deepEqual(columns(board), [
    ["Backlog", ["ACME-38", "ACME-36"]],
    ["Todo", ["ACME-40", "ACME-39"]],
    ["In progress", ["ACME-42"]],
    ["Done", ["ACME-35"]],
    ["Canceled", ["ACME-33"]],
  ]);
  const card = cardOf(board, "t-39");
  assert.equal(
    chipOf(board, "t-39", "Priority")
      .querySelector(".luke-task-priority-mark")
      ?.getAttribute("data-priority"),
    TASK_PRIORITY.HIGH,
  );
  assert.equal(card.querySelector(".tasks-board-name")?.textContent, "Rate limit search");
  assert.equal(
    chipOf(board, "t-39", "Assignee").getAttribute("aria-label"),
    "Assignee: No assignee",
  );
  assert.equal(card.querySelector(".actor-mark"), null, "the card wears no creator's face");
});

/** Presses `key` where the keyboard stands. */
function pressHere(key: string): void {
  const target = document.activeElement ?? document.body;
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

/** The id of the task whose card holds the keyboard, if one does. */
function focusedTask(): string | null | undefined {
  return document.activeElement?.closest("li[data-task-id]")?.getAttribute("data-task-id");
}

test("each column's cards are one Tab stop that ↓ and ↑ walk, and ← and → cross to the next column's stop, wrapping at the board's ends", async () => {
  const board = await mountBoard(TASKS, SHELL_ROOM.WIDE, {
    ...DEFAULT_BOARD_DISPLAY,
    completed: COMPLETED_WINDOW.ALL,
  });
  const stops = () =>
    [...board.querySelectorAll<HTMLElement>("[data-task-column]")].map(
      (column) =>
        [...column.querySelectorAll<HTMLElement>("[data-card-press]")].filter(
          (press) => press.tabIndex === 0,
        ).length,
    );
  assert.deepEqual(stops(), [1, 1, 1, 1, 1], "Tab lands once in each column");

  act(() => cardOf(board, "t-38").focus());
  pressHere("ArrowDown");
  assert.equal(focusedTask(), "t-36");
  pressHere("ArrowRight");
  assert.equal(focusedTask(), "t-40", "→ lands on Todo's stop, its first card");
  pressHere("ArrowDown");
  assert.equal(focusedTask(), "t-39");
  pressHere("ArrowLeft");
  assert.equal(focusedTask(), "t-36", "← lands back on the card Backlog was left at");
  pressHere("ArrowLeft");
  assert.equal(focusedTask(), "t-33", "← from the first column wraps to the last");
  pressHere("ArrowRight");
  assert.equal(focusedTask(), "t-36");
});

test("a refresh that failed after the tasks were read keeps the columns drawn under Could not refresh and Retry, where a first read that failed draws the error alone", async () => {
  let retried = 0;
  const onRetryList = () => {
    retried += 1;
  };
  const board = await mountBoard(TASKS, SHELL_ROOM.WIDE, DEFAULT_BOARD_DISPLAY, {
    listFailed: true,
    onRetryList,
  });

  assert.notEqual(columns(board).length, 0, "the columns stand");
  const note = board.querySelector('[role="alert"]');
  assert.match(note?.textContent ?? "", /Could not refresh/u);
  const retry = [...(note?.querySelectorAll("button") ?? [])].find((each) =>
    each.textContent?.includes("Retry"),
  );
  act(() => retry?.click());
  assert.equal(retried, 1);

  const first = await mountBoard([], SHELL_ROOM.WIDE, DEFAULT_BOARD_DISPLAY, {
    listFailed: true,
    listRead: false,
  });
  assert.equal(columns(first).length, 0);
  assert.match(first.querySelector('[role="alert"]')?.textContent ?? "", /could not be read/u);
});

test("a task from a service before statuses stands under Todo", async () => {
  const { status: _status, ...older } = task(
    30,
    "Older task",
    TASK_STATUS.TODO,
    TASK_PRIORITY.NONE,
  );
  const board = await mountBoard([older]);
  assert.deepEqual(columns(board)[1], ["Todo", ["ACME-30"]]);
});

test("Escape closes the board", async () => {
  await mountBoard();
  act(() => {
    assert.ok(runAppCommand(APP_COMMAND.EXIT_BOARD), "the board's way out is offered");
  });
  assert.equal(closed, 1);
});

test("a press on a card opens its task", async () => {
  const board = await mountBoard();
  act(() => cardOf(board, "t-42").click());
  assert.deepEqual(opened, ["t-42"]);
});

test("a card's box chooses it without opening it, ⌘-click one in another column, and the bar's Status settles both at once", async () => {
  const settled: [string[], string][] = [];
  const board = await mountBoard(TASKS, SHELL_ROOM.WIDE, DEFAULT_BOARD_DISPLAY, {
    onSettleTasks: (taskIds, status) => settled.push([[...taskIds], status]),
  });
  const box =
    board.querySelector<HTMLElement>('li[data-task-id="t-39"] [role="checkbox"]') ??
    assert.fail("the card of t-39 draws its box");
  act(() => box.click());
  act(() => {
    cardOf(board, "t-42").dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true }),
    );
  });
  assert.deepEqual(opened, [], "choosing opens nothing");
  const bar = board.querySelector<HTMLElement>('[role="toolbar"]') ?? assert.fail("the bar stands");
  assert.match(bar.textContent ?? "", /2 selected/u);

  const status = [...bar.querySelectorAll<HTMLButtonElement>("button")].find(
    (each) => each.textContent?.trim() === "Status",
  );
  act(() => (status ?? assert.fail("the bar offers Status")).click());
  const done = [...document.querySelectorAll<HTMLElement>('[role="menu"] .luke-menu-item')].find(
    (each) => each.querySelector(".luke-menu-item-label")?.textContent === "Done",
  );
  act(() => (done ?? assert.fail("Status offers Done")).click());
  assert.deepEqual(settled, [[["t-39", "t-42"], TASK_STATUS.DONE]]);
  assert.equal(board.querySelector('[role="toolbar"]'), null, "the selection is let go");
});

test("the settled finished before the past week give way to a foot counting them, which shows them all; by priority the columns run from the most pressing, empty ones left out where asked", async () => {
  const board = await mountBoard();
  const done = board.querySelector<HTMLElement>('[data-task-column="done"]');
  assert.deepEqual(columns(board).slice(-2), [
    ["Done", []],
    ["Canceled", []],
  ]);
  const older = [...(done?.querySelectorAll<HTMLElement>("button") ?? [])].find(
    (button) => button.textContent === "Show 1 more",
  );
  act(() => (older ?? assert.fail("no Show more line under Done")).click());
  assert.deepEqual(
    displayed.map((each) => each.completed),
    [COMPLETED_WINDOW.ALL],
  );

  redrawBoard({ ...DEFAULT_BOARD_DISPLAY, completed: COMPLETED_WINDOW.ALL });
  assert.deepEqual(columns(board).at(-1), ["Canceled", ["ACME-33"]]);

  redrawBoard({ ...DEFAULT_BOARD_DISPLAY, grouping: TASKS_GROUPING.PRIORITY, emptyGroups: false });
  assert.deepEqual(
    columns(board).map(([name]) => name),
    ["Urgent", "High", "Medium", "No priority"],
  );
});

test("a workspace with no task yet says so", async () => {
  const board = await mountBoard([]);
  assert.equal(board.querySelector("[data-task-column]"), null);
  assert.match(board.textContent ?? "", /No tasks yet/);
});

/**
 * The board laid out for a drag: each column 300px wide and 600px tall, side
 * by side from the window's left, each card 40px tall, 50px apart, from
 * 40px down its column. jsdom lays nothing out and captures no pointer, so
 * this answers the geometry and the capture the browser would.
 */
function layCardsOut(board: HTMLElement): void {
  const COLUMN = 300;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const all = [...document.querySelectorAll("[data-task-column]")];
    if (this.matches(".tasks-board")) return new DOMRect(0, 0, all.length * COLUMN, 600);
    const at = all.indexOf(this);
    if (at >= 0) return new DOMRect(at * COLUMN, 0, COLUMN, 600);
    const column = all.indexOf(this.closest("[data-task-column]") ?? this);
    if (!this.matches("li[data-task-id]") || column < 0) return new DOMRect();
    const row = [...(this.parentElement?.children ?? [])].indexOf(this);
    return new DOMRect(column * COLUMN + 8, 40 + row * 50, COLUMN - 16, 40);
  });
  for (const list of board.querySelectorAll(".tasks-board-cards")) {
    Object.assign(list, { setPointerCapture: () => undefined });
  }
}

/** A pointer event at a point in the window, as the primary button makes one. */
function pointer(type: string, x: number, y: number): PointerEvent {
  return new PointerEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y, pointerId: 1 });
}

/** Presses a task's card, drags it to a point, and lets it go there. */
function dragCard(board: HTMLElement, taskId: string, to: { x: number; y: number }): void {
  const card = cardOf(board, taskId);
  const box = card.closest("li")?.getBoundingClientRect() ?? assert.fail("the card stands");
  const from = { x: box.x + 20, y: box.y + 20 };
  act(() => {
    card.dispatchEvent(pointer("pointerdown", from.x, from.y));
    window.dispatchEvent(pointer("pointermove", from.x + 10, from.y));
    window.dispatchEvent(pointer("pointermove", to.x, to.y));
    window.dispatchEvent(pointer("pointerup", to.x, to.y));
  });
}

test("a Todo card dragged onto In progress is sent in progress, and one let go in its own column is sent nothing", async () => {
  const board = await mountBoard();
  layCardsOut(board);

  dragCard(board, "t-39", { x: 750, y: 120 });
  dragCard(board, "t-40", { x: 450, y: 400 });

  assert.deepEqual(sent, [["t-39", { status: TASK_STATUS.IN_PROGRESS }]]);
  assert.deepEqual(opened, [], "a drag opens no task");
});

test("a column's + opens a draft there whose chips change it, and Return adds it with no agent and opens the next draft", async () => {
  const added: [string, unknown][] = [];
  const board = await mountBoard(TASKS, SHELL_ROOM.WIDE, DEFAULT_BOARD_DISPLAY, {
    onQuickAdd: (name, into) => {
      added.push([name, into]);
      return Promise.resolve(undefined);
    },
  });
  const draft = () => board.querySelector<HTMLInputElement>("[data-quick-add] input");
  act(() =>
    board.querySelector<HTMLButtonElement>('button[aria-label="New task in Backlog"]')?.click(),
  );
  act(() =>
    board
      .querySelector<HTMLButtonElement>('[data-quick-add] button[aria-label^="Priority:"]')
      ?.click(),
  );
  pick("High");
  const field = draft() ?? assert.fail("the draft stands after its chip picked");
  field.value = "Export invoices as CSV";
  act(() => field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  await act(async () => undefined);

  assert.deepEqual(added, [
    [
      "Export invoices as CSV",
      { standing: { status: TASK_STATUS.BACKLOG, priority: TASK_PRIORITY.HIGH } },
    ],
  ]);
  assert.equal(draft()?.value, "", "the next draft stands, empty");
});

test("by priority, a card dragged onto Urgent's column is sent urgent", async () => {
  const board = await mountBoard(TASKS, SHELL_ROOM.WIDE, {
    ...DEFAULT_BOARD_DISPLAY,
    grouping: TASKS_GROUPING.PRIORITY,
  });
  layCardsOut(board);

  dragCard(board, "t-39", { x: 150, y: 120 });

  assert.deepEqual(sent, [["t-39", { priority: TASK_PRIORITY.URGENT }]]);
});

/** A task of `TASKS` assigned to Charles. */
function charles(taskId: string): TaskSummary {
  const held = TASKS.find((each) => each.id === taskId) ?? assert.fail(`no ${taskId}`);
  return { ...held, assignee: { userId: CHARLES, name: "Charles Pan" } };
}

test("by assignee, the reader's column stands first, then each teammate's, then No assignee's; a card dragged onto one is assigned to its person, onto No assignee's to no one, and wears no assignee chip there", async () => {
  const tasks = [charles("t-39"), ...TASKS.filter((each) => each.id !== "t-39")];
  const board = await mountBoard(tasks, SHELL_ROOM.WIDE, {
    ...DEFAULT_BOARD_DISPLAY,
    grouping: TASKS_GROUPING.ASSIGNEE,
  });
  layCardsOut(board);

  assert.deepEqual(
    columns(board).map(([name]) => name),
    ["You", "Charles Pan", "No assignee"],
  );
  assert.equal(
    board.querySelector('li[data-task-id="t-39"] button[aria-label^="Assignee:"]'),
    null,
    "a card under its assignee's column leaves its chip off",
  );
  dragCard(board, "t-40", { x: 150, y: 120 });
  dragCard(board, "t-39", { x: 750, y: 120 });

  assert.deepEqual(sent, [
    ["t-40", { assigneeId: DEAN }],
    ["t-39", { assigneeId: null }],
  ]);
});

test("in a narrow room grouped by assignee, a card keeps its Assignee chip, which moves it without a drag", async () => {
  const deans = { ...(TASKS.find((each) => each.id === "t-40") ?? assert.fail("no t-40")) };
  const board = await mountBoard(
    [{ ...deans, assignee: { userId: DEAN, name: "Dean Stratakos" } }],
    SHELL_ROOM.NARROW,
    { ...DEFAULT_BOARD_DISPLAY, grouping: TASKS_GROUPING.ASSIGNEE },
  );

  act(() => chipOf(board, "t-40", "Assignee").click());
  pick("Charles Pan");

  assert.deepEqual(sent, [["t-40", { assigneeId: CHARLES }]]);
});

test("a card's Assignee chip drops No assignee and the members, the reader first, and sends the one picked", async () => {
  const board = await mountBoard([charles("t-39"), ...TASKS.filter((each) => each.id !== "t-39")]);

  act(() => chipOf(board, "t-40", "Assignee").click());
  assert.deepEqual(
    [...document.querySelectorAll(".luke-menu-item-label")].map((label) => label.textContent),
    ["No assignee", "Dean Stratakos", "Charles Pan"],
  );
  pick("Charles Pan");
  act(() => chipOf(board, "t-39", "Assignee").click());
  pick("No assignee");

  assert.deepEqual(sent, [
    ["t-40", { assigneeId: CHARLES }],
    ["t-39", { assigneeId: null }],
  ]);
  assert.deepEqual(opened, [], "a pick opens no task");
});

test("a card dragged onto Done whose change the service refused says so", async () => {
  keeps = false;
  const board = await mountBoard();
  layCardsOut(board);

  dragCard(board, "t-42", { x: 1050, y: 120 });
  await act(async () => undefined);

  assert.deepEqual(sent, [["t-42", { status: TASK_STATUS.DONE }]]);
  assert.match(newestToastSays() ?? "", /The task could not be changed\. Try again\./);
});

/** What a reader hears of a narrow board's tabs: their names, and the one chosen. */
interface ColumnTabs {
  readonly names: readonly string[];
  readonly chosen: string | undefined;
}

/** The tabs choosing a narrow board's column, by their names, and the one chosen. */
function columnTabs(board: HTMLElement): ColumnTabs {
  const tabs = [...board.querySelectorAll<HTMLElement>('[role="tablist"] [role="tab"]')];
  const name = (tab: HTMLElement) => tab.querySelector(".luke-choice-bar-label")?.textContent ?? "";
  const chosen = tabs.find((tab) => tab.getAttribute("aria-selected") === "true");
  return { names: tabs.map(name), chosen: chosen === undefined ? undefined : name(chosen) };
}

/** Presses the narrow board's tab named `name`. */
function pressTab(board: HTMLElement, name: string): void {
  const tab = [...board.querySelectorAll<HTMLElement>('[role="tab"]')].find(
    (each) => each.querySelector(".luke-choice-bar-label")?.textContent === name,
  );
  act(() => (tab ?? assert.fail(`no ${name} tab`)).click());
}

test("in a narrow room the board shows one column at a time, Todo first, and a tab shows another", async () => {
  const board = await mountBoard(TASKS, SHELL_ROOM.NARROW);

  assert.deepEqual(columnTabs(board), {
    names: ["Backlog", "Todo", "In progress", "Done", "Canceled"],
    chosen: "Todo",
  });
  assert.deepEqual(columns(board), [["Todo", ["ACME-40", "ACME-39"]]]);

  pressTab(board, "In progress");

  assert.equal(columnTabs(board).chosen, "In progress");
  assert.deepEqual(columns(board), [["In progress", ["ACME-42"]]]);
});

test("in a narrow room showing completed adds the Canceled tab, and hiding it again while shown goes back to Todo, which showing it again keeps", async () => {
  const none = { ...DEFAULT_BOARD_DISPLAY, completed: COMPLETED_WINDOW.NONE };
  const board = await mountBoard(TASKS, SHELL_ROOM.NARROW, none);
  const withCanceled = { ...DEFAULT_BOARD_DISPLAY, completed: COMPLETED_WINDOW.ALL };

  redrawBoard(withCanceled);
  pressTab(board, "Canceled");
  assert.deepEqual(columns(board), [["Canceled", ["ACME-33"]]]);

  redrawBoard(none);
  assert.equal(columnTabs(board).chosen, "Todo");
  assert.deepEqual(columns(board), [["Todo", ["ACME-40", "ACME-39"]]]);
  redrawBoard(withCanceled);
  assert.equal(columnTabs(board).chosen, "Todo");
  assert.deepEqual(columns(board), [["Todo", ["ACME-40", "ACME-39"]]]);
});

test("in a narrow room a card's chips draw their marks alone, as the List's do, its Status before its name, and the Status sends the status picked, without a drag", async () => {
  const board = await mountBoard(TASKS, SHELL_ROOM.NARROW);
  const chip = chipOf(board, "t-39", "Status");

  for (const standing of ["Status", "Priority", "Assignee"]) {
    const each = chipOf(board, "t-39", standing);
    assert.equal(each.dataset.iconOnly, "true", `the ${standing} chip draws its mark alone`);
    assert.equal(each.dataset.look, CHIP_LOOK.TOOLBAR, `the ${standing} chip wears no outline`);
  }
  assert.equal(
    chip.closest(".tasks-board-card-title")?.querySelector(".tasks-board-name")?.textContent,
    "Rate limit search",
    "the Status chip stands before the card's name",
  );
  act(() => chip.click());
  pick("In progress");

  assert.deepEqual(sent, [["t-39", { status: TASK_STATUS.IN_PROGRESS }]]);
  assert.deepEqual(opened, [], "a pick opens no task");
});

test("in a wide room every column stands side by side, with no tabs, and a card's chips draw their marks alone", async () => {
  const board = await mountBoard();

  assert.equal(board.querySelector('[role="tablist"]'), null);
  assert.equal(columns(board).length, 5);
  assert.equal(chipOf(board, "t-39", "Status").dataset.iconOnly, "true");
  assert.equal(chipOf(board, "t-39", "Priority").dataset.iconOnly, "true");
});

test("a card's Priority chip sends the priority picked, and a Status chip the status, opening no task", async () => {
  const board = await mountBoard();

  act(() => chipOf(board, "t-39", "Priority").click());
  pick("Urgent");
  act(() => chipOf(board, "t-36", "Status").click());
  pick("Todo");

  assert.deepEqual(sent, [
    ["t-39", { priority: TASK_PRIORITY.URGENT }],
    ["t-36", { status: TASK_STATUS.TODO }],
  ]);
  assert.deepEqual(opened, [], "a pick opens no task");
});

test("Rename from a card's ⋯ makes its name a field in place, and Enter sends the name typed", async () => {
  const board = await mountBoard();
  const more = board.querySelector<HTMLButtonElement>(
    'li[data-task-id="t-42"] .tasks-board-card-more button',
  );
  assert.ok(more, "the card offers its ⋯");

  act(() => more.click());
  pick("Rename");
  const field = board.querySelector<HTMLInputElement>('li[data-task-id="t-42"] input');
  assert.ok(field, "the card's name is its field");
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(
      field,
      "Fix Safari sign-in",
    );
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => {
    field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  await act(async () => undefined);

  assert.deepEqual(renamed, [["t-42", "Fix Safari sign-in"]]);
  assert.deepEqual(opened, [], "a rename opens no task");
});

test("a right-click on a card drops the task's own menu", async () => {
  const board = await mountBoard();
  act(() => {
    cardOf(board, "t-40").dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true }),
    );
  });
  const labels = [...document.querySelectorAll('[role^="menuitem"] .luke-menu-item-label')].map(
    (label) => label.textContent,
  );
  assert.ok(labels.includes("Rename"), "the menu offers Rename");
  assert.ok(labels.includes("Status"), "the menu offers Status");
  assert.deepEqual(opened, []);
});

test("the menu key drops a card's menu from its press or any control in the card, and its ⋯ is named for the task", async () => {
  const board = await mountBoard();
  const key = (target: HTMLElement) =>
    act(() => {
      target.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ContextMenu", bubbles: true, cancelable: true }),
      );
    });
  const offersRename = () =>
    [...document.querySelectorAll('[role^="menuitem"] .luke-menu-item-label')].some(
      (label) => label.textContent === "Rename",
    );
  const closeMenu = () =>
    act(() => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });

  key(cardOf(board, "t-40"));
  assert.ok(offersRename(), "the card's press opens its menu on the menu key");
  closeMenu();
  key(chipOf(board, "t-40", "Priority"));
  assert.ok(offersRename(), "a chip in the card opens the card's menu on the menu key too");
  assert.equal(
    board
      .querySelector('li[data-task-id="t-40"] .tasks-board-card-more button')
      ?.getAttribute("aria-label"),
    "Task actions",
  );
  assert.deepEqual(opened, []);
});

test("a press on a card's chip carried onto another column is that chip's, and moves no card", async () => {
  const board = await mountBoard();
  layCardsOut(board);
  const chip = chipOf(board, "t-39", "Priority");
  const box = chip.closest("li")?.getBoundingClientRect() ?? assert.fail("the card stands");
  const from = { x: box.x + 20, y: box.y + 20 };

  act(() => {
    chip.dispatchEvent(pointer("pointerdown", from.x, from.y));
    window.dispatchEvent(pointer("pointermove", from.x + 10, from.y));
    window.dispatchEvent(pointer("pointermove", 750, 120));
    window.dispatchEvent(pointer("pointerup", 750, 120));
  });

  assert.deepEqual(sent, []);
});

test("a task from a service before priorities offers No priority on its card, and a pick sends one", async () => {
  const { priority: _priority, ...older } = task(
    30,
    "Older task",
    TASK_STATUS.TODO,
    TASK_PRIORITY.NONE,
  );
  const board = await mountBoard([older]);
  const chip = chipOf(board, "t-30", "Priority");

  assert.equal(chip.getAttribute("aria-label"), "Priority: No priority");
  act(() => chip.click());
  pick("High");

  assert.deepEqual(sent, [["t-30", { priority: TASK_PRIORITY.HIGH }]]);
});

test("a card wears one icon for how its agents stand, an agent at work before the pull requests they opened", async () => {
  const working: TaskSummary = {
    ...task(42, "Fix Safari login", TASK_STATUS.IN_PROGRESS, TASK_PRIORITY.HIGH),
    agents: {
      total: 2,
      working: 1,
      agents: [],
      pullRequestTotal: 2,
      pullRequests: [
        {
          number: 4101,
          title: "First try",
          state: "merged",
          checks: "passing",
          additions: 1,
          deletions: 1,
        },
        {
          number: 4120,
          title: "Safari",
          state: "open",
          checks: "passing",
          additions: 9,
          deletions: 3,
        },
      ],
    },
  };
  const board = await mountBoard([working]);
  const card = board.querySelector('li[data-task-id="t-42"]');

  assert.equal(
    card?.querySelector(".task-agents-mark")?.getAttribute("aria-label"),
    "Working",
    "an agent at work outranks its pull requests",
  );
});

test("a card says how many of its sub-tasks are finished, and one with none says nothing of them", async () => {
  const parent = task(42, "Fix Safari login", TASK_STATUS.IN_PROGRESS, TASK_PRIORITY.HIGH);
  const board = await mountBoard([
    parent,
    { ...task(43, "Write the fix", TASK_STATUS.DONE, TASK_PRIORITY.HIGH), parentTaskId: parent.id },
    { ...task(44, "Test on iOS", TASK_STATUS.TODO, TASK_PRIORITY.HIGH), parentTaskId: parent.id },
  ]);
  const said = (id: string) =>
    board.querySelector(`li[data-task-id="${id}"] .luke-progress-count`)?.textContent ?? "";

  assert.match(said("t-42"), /1 of 2 sub-tasks finished/u);
  assert.equal(said("t-44"), "");
});

test("a card's assignee hangs the person's card", async () => {
  const board = await mountBoard([
    {
      ...task(39, "Rate limit search", TASK_STATUS.TODO, TASK_PRIORITY.HIGH),
      assignee: { userId: CHARLES, name: "Charles Pan" },
    },
  ]);

  restOn(chipOf(board, "t-39", "Assignee"));
  const card = document.querySelector(".luke-tooltip-card [data-actor-card]");
  assert.match(card?.textContent ?? "", /Charles Pan/u);
});
