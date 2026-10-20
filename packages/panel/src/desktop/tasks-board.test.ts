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
import {
  DEFAULT_BOARD_DISPLAY,
  NO_TASKS_FILTER,
  TASKS_GROUPING,
  type TasksDisplay,
} from "@luke/ui/tasks-page-model";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { runAppCommand } from "../app-commands.js";
import { MemberDirectory } from "../member-directory.js";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import { fakeActPort, fakeAppBridge } from "../testing/app-bridge.js";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { onRegistry } from "../testing/copy-feedback.js";
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
 * field. In a narrow room, a phone's, one column stands at a time, chosen
 * by its tab, and a card's Status chip, which says its status there, moves it.
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

/** How many times the board was closed. */
let closed = 0;

beforeEach(() => {
  opened = [];
  renamed = [];
  sent = [];
  keeps = true;
  closed = 0;
  window.localStorage.clear();
  fakeAppPlatform(QUIET_PANEL);
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
      return Promise.resolve(keeps);
    },
    onRenameTask: (taskId, name) => {
      renamed.push([taskId, name]);
      return Promise.resolve(true);
    },
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
              frame: { toolbar: null, chips: null, filter: NO_TASKS_FILTER, display: shown },
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
    [...column.querySelectorAll(".tasks-board-key")].map((key) => key.textContent ?? ""),
  ]);
}

/** The chip on a task's card that changes its `standing`, Priority or Status. */
function chipOf(board: HTMLElement, taskId: string, standing: string): HTMLButtonElement {
  const chip = board.querySelector<HTMLButtonElement>(
    `li[data-task-id="${taskId}"] .tasks-board-card-foot button[aria-label^="${standing}:"]`,
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
  const card = board.querySelector<HTMLButtonElement>(`li[data-task-id="${taskId}"] > button`);
  assert.ok(card, `the card of ${taskId} stands`);
  return card;
}

test("each status but Canceled has its column, its cards the most pressing first, each its key, priority, name, and creator's face", async () => {
  const board = await mountBoard();

  assert.deepEqual(columns(board), [
    ["Backlog", ["ACME-38", "ACME-36"]],
    ["Todo", ["ACME-40", "ACME-39"]],
    ["In progress", ["ACME-42"]],
    ["Done", ["ACME-35"]],
  ]);
  const card = cardOf(board, "t-39");
  assert.equal(
    chipOf(board, "t-39", "Priority")
      .querySelector(".luke-task-priority-mark")
      ?.getAttribute("data-priority"),
    TASK_PRIORITY.HIGH,
  );
  assert.equal(card.querySelector(".tasks-board-name")?.textContent, "Rate limit search");
  assert.ok(card.querySelector(".actor-mark"), "the card wears its creator's face");
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

test("Canceled shows its column once the view asks for it, and by priority the columns run from the most pressing, empty ones left out where asked", async () => {
  const board = await mountBoard();
  redrawBoard({ ...DEFAULT_BOARD_DISPLAY, canceled: true });
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

test("by priority, a card dragged onto Urgent's column is sent urgent", async () => {
  const board = await mountBoard(TASKS, SHELL_ROOM.WIDE, {
    ...DEFAULT_BOARD_DISPLAY,
    grouping: TASKS_GROUPING.PRIORITY,
  });
  layCardsOut(board);

  dragCard(board, "t-39", { x: 150, y: 120 });

  assert.deepEqual(sent, [["t-39", { priority: TASK_PRIORITY.URGENT }]]);
});

test("a card dragged onto Done whose change the service refused says so", async () => {
  keeps = false;
  const board = await mountBoard();
  layCardsOut(board);

  dragCard(board, "t-42", { x: 1050, y: 120 });
  await act(async () => undefined);

  assert.deepEqual(sent, [["t-42", { status: TASK_STATUS.DONE }]]);
  assert.match(newestToastSays() ?? "", /Couldn't change the task\. Try again\./);
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
    names: ["Backlog", "Todo", "In progress", "Done"],
    chosen: "Todo",
  });
  assert.deepEqual(columns(board), [["Todo", ["ACME-40", "ACME-39"]]]);

  pressTab(board, "In progress");

  assert.equal(columnTabs(board).chosen, "In progress");
  assert.deepEqual(columns(board), [["In progress", ["ACME-42"]]]);
});

test("in a narrow room Canceled adds its tab, and hiding it again while shown goes back to Todo, which showing it again keeps", async () => {
  const board = await mountBoard(TASKS, SHELL_ROOM.NARROW);
  const withCanceled = { ...DEFAULT_BOARD_DISPLAY, canceled: true };

  redrawBoard(withCanceled);
  pressTab(board, "Canceled");
  assert.deepEqual(columns(board), [["Canceled", ["ACME-33"]]]);

  redrawBoard(DEFAULT_BOARD_DISPLAY);
  assert.equal(columnTabs(board).chosen, "Todo");
  assert.deepEqual(columns(board), [["Todo", ["ACME-40", "ACME-39"]]]);
  redrawBoard(withCanceled);
  assert.equal(columnTabs(board).chosen, "Todo");
  assert.deepEqual(columns(board), [["Todo", ["ACME-40", "ACME-39"]]]);
});

test("in a narrow room a card's Status chip says its status and sends the status picked, without a drag", async () => {
  const board = await mountBoard(TASKS, SHELL_ROOM.NARROW);
  const chip = chipOf(board, "t-39", "Status");

  assert.equal(chip.querySelector(".luke-chip-name")?.textContent, "Todo");
  assert.equal(chip.dataset.iconOnly, undefined, "the chip says its status in words");
  act(() => chip.click());
  pick("In progress");

  assert.deepEqual(sent, [["t-39", { status: TASK_STATUS.IN_PROGRESS }]]);
  assert.deepEqual(opened, [], "a pick opens no task");
});

test("in a wide room every column stands side by side, with no tabs, and a card's chips draw their marks alone", async () => {
  const board = await mountBoard();

  assert.equal(board.querySelector('[role="tablist"]'), null);
  assert.equal(columns(board).length, 4);
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
  assert.ok(labels.includes("Archive"), "the menu offers Archive");
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
