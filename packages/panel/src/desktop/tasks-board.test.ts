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
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { runAppCommand } from "../app-commands.js";
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
 * dragged onto another column is sent that column's status, and Canceled
 * is a filter kept on this Mac. In a narrow room, a phone's, one column
 * stands at a time, chosen by its tab, and a card's Status chip moves it.
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

/** Each change of where a task stands the board sent, in order. */
let sent: [string, TaskStanding][] = [];

/** Whether the service keeps the changes sent. */
let keeps = true;

/** How many times the board was closed. */
let closed = 0;

beforeEach(() => {
  opened = [];
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

/** The Board over `tasks`, read by Dean, once the workspace's members have answered. */
async function mountBoard(
  tasks: readonly TaskSummary[] = TASKS,
  room: ShellRoom = SHELL_ROOM.WIDE,
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
  });
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(
          Fragment,
          null,
          createElement(TasksBoard, { tasks: control, room }),
          createElement(ToastHost),
        ),
      ),
    ),
  );
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
    card.querySelector(".luke-task-priority-mark")?.getAttribute("data-priority"),
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

test("Canceled shows its column once asked for, kept on this Mac", async () => {
  const board = await mountBoard();
  const canceled = board.querySelector<HTMLButtonElement>("button[aria-pressed]");
  assert.ok(canceled, "the toolbar offers Canceled");
  act(() => canceled.click());
  assert.deepEqual(columns(board).at(-1), ["Canceled", ["ACME-33"]]);

  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  assert.deepEqual((await mountBoard()).querySelectorAll("[data-task-column]").length, 5);
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

test("a card dragged onto Done whose change the service refused says so", async () => {
  keeps = false;
  const board = await mountBoard();
  layCardsOut(board);

  dragCard(board, "t-42", { x: 1050, y: 120 });
  await act(async () => undefined);

  assert.deepEqual(sent, [["t-42", { status: TASK_STATUS.DONE }]]);
  assert.match(newestToastSays() ?? "", /Couldn't change the task\. Try again\./);
});

/** The tabs choosing a narrow board's column, by their names, and the one chosen. */
function columnTabs(board: HTMLElement): { names: string[]; chosen: string | undefined } {
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

/** The Status chip on a task's card, where its card wears one. */
function statusChipOf(board: HTMLElement, taskId: string): HTMLButtonElement | null {
  return board.querySelector<HTMLButtonElement>(
    `li[data-task-id="${taskId}"] .tasks-board-card-status button`,
  );
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

test("in a narrow room Canceled adds its tab, and hiding it again while shown goes back to Todo", async () => {
  const board = await mountBoard(TASKS, SHELL_ROOM.NARROW);
  const canceled = board.querySelector<HTMLButtonElement>("button[aria-pressed]");
  assert.ok(canceled, "the toolbar offers Canceled");

  act(() => canceled.click());
  pressTab(board, "Canceled");
  assert.deepEqual(columns(board), [["Canceled", ["ACME-33"]]]);

  act(() => canceled.click());
  assert.equal(columnTabs(board).chosen, "Todo");
  assert.deepEqual(columns(board), [["Todo", ["ACME-40", "ACME-39"]]]);
});

test("in a narrow room a card's Status chip sends the status picked, without a drag", async () => {
  const board = await mountBoard(TASKS, SHELL_ROOM.NARROW);
  const chip = statusChipOf(board, "t-39") ?? assert.fail("the card wears its Status chip");

  act(() => chip.click());
  const row = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((each) =>
    each.textContent?.includes("In progress"),
  );
  act(() => (row ?? assert.fail("no In progress row")).click());

  assert.deepEqual(sent, [["t-39", { status: TASK_STATUS.IN_PROGRESS }]]);
  assert.deepEqual(opened, [], "a pick opens no task");
});

test("in a wide room every column stands side by side, with no tabs, and no card wears a Status chip", async () => {
  const board = await mountBoard();

  assert.equal(board.querySelector('[role="tablist"]'), null);
  assert.equal(columns(board).length, 4);
  assert.equal(statusChipOf(board, "t-39"), null);
});
