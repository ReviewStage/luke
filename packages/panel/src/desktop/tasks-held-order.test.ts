// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  TASK_PRIORITY,
  TASK_STATUS,
  type TaskPriority,
  type TaskStatus,
  type TaskSummary,
} from "@luke/features/task-wire";
import type { Workspace, WorkspaceMember } from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import {
  DEFAULT_BOARD_DISPLAY,
  DEFAULT_LIST_DISPLAY,
  NO_TASKS_FILTER,
  TASKS_GROUPING,
  TASKS_ORDER,
  type TasksDisplay,
  type TasksFilter,
} from "@luke/ui/tasks-page-model";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, onTestFinished, test, vi } from "vitest";
import { MemberDirectory } from "../member-directory.js";
import { SHELL_ROOM } from "../shell-room.js";
import { fakeActPort, fakeAppBridge } from "../testing/app-bridge.js";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { playListMotions } from "../testing/pane-motion.js";
import { tasksControl } from "../testing/tasks-control.js";
import { ToastHost } from "../toast.js";
import { TasksBoard } from "./tasks-board.js";
import { TasksList } from "./tasks-list.js";

/**
 * tasks-held-order.test.ts -- the Tasks page's List and Columns hold each
 * task in the group and the place it was first drawn in while the page is
 * shown, so a teammate's change moves nothing under the reader's eye, though
 * the row says its new value; hidden and shown again, or under another
 * grouping, each task stands where it is now, and a task the reader moved
 * here, by its chip or a rename, moves at once. Synthetic throughout.
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

beforeEach(() => {
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

/** A task of Acme's, numbered `number`, standing in `status` at `priority`. */
function task(
  number: number,
  name: string,
  status: TaskStatus,
  priority: TaskPriority,
): TaskSummary {
  return {
    id: `t-${number}`,
    workspaceId: ACME.id,
    name,
    repository: "acme/web",
    createdAt: 1,
    updatedAt: 100 - number,
    ownerId: DEAN,
    createdBy: { userId: DEAN, name: "Dean Stratakos" },
    status,
    priority,
    number,
  };
}

const TASKS = [
  task(39, "Rate limit search", TASK_STATUS.TODO, TASK_PRIORITY.HIGH),
  task(40, "Billing after downgrade", TASK_STATUS.TODO, TASK_PRIORITY.URGENT),
  task(41, "Search filters", TASK_STATUS.TODO, TASK_PRIORITY.LOW),
  task(42, "Fix Safari login", TASK_STATUS.IN_PROGRESS, TASK_PRIORITY.HIGH),
];

/** How the page is drawn again: over which tasks, under which display, shown or not, and which tasks wait on a change made here. */
interface Drawing {
  readonly display?: TasksDisplay;
  readonly filter?: TasksFilter;
  readonly shown?: boolean;
  readonly pendingTasks?: ReadonlySet<string>;
}

/** The List or the Board over `tasks`, read by Dean, and a way to draw it again as an update or the reader would. */
async function mountView(
  view: typeof TasksList | typeof TasksBoard,
  tasks: readonly TaskSummary[],
  display: TasksDisplay,
) {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  const registry = AtomRegistry.make();
  const sent: [string, unknown][] = [];
  const draw = (listed: readonly TaskSummary[], drawing: Drawing = {}) => {
    const control = tasksControl({
      tasks: [...listed],
      workspace: ACME,
      workspaces: [ACME],
      me: DEAN,
      listRead: true,
      shown: drawing.shown ?? true,
      ...(drawing.pendingTasks === undefined ? {} : { pendingTasks: drawing.pendingTasks }),
      onSetTaskStanding: (taskId, standing) => {
        sent.push([taskId, standing]);
        return Promise.resolve(true);
      },
    });
    const frame = {
      toolbar: null,
      chips: null,
      filter: drawing.filter ?? NO_TASKS_FILTER,
      display: drawing.display ?? display,
      onDisplay: () => undefined,
      scroll: () => undefined,
    };
    act(() =>
      root.render(
        onRegistry(
          registry,
          createElement(
            Fragment,
            null,
            createElement(MemberDirectory, {
              workspace: ACME,
              readerId: DEAN,
              children: createElement(view, {
                tasks: control,
                room: SHELL_ROOM.WIDE,
                title: "Tasks",
                frame,
              }),
            }),
            createElement(ToastHost),
          ),
        ),
      ),
    );
  };
  draw(tasks);
  await act(async () => undefined);
  return { container, draw, sent };
}

/** Each of the List's groups, or the Board's columns: its name and its tasks' keys, in order. */
function laidOut(page: HTMLElement): [string, string[]][] {
  return [...page.querySelectorAll<HTMLElement>(".tasks-list-group, [data-task-column]")].map(
    (group) => [
      group.getAttribute("aria-label") ?? "",
      [...group.querySelectorAll("[data-task-key]")].map((key) => key.textContent ?? ""),
    ],
  );
}

/** The task keyed `key`'s chip that changes its `standing`, Priority or Status. */
function chipOf(page: HTMLElement, key: string, standing: string): HTMLButtonElement {
  const holder = [...page.querySelectorAll<HTMLElement>("li")].find(
    (each) => each.querySelector("[data-task-key]")?.textContent === key,
  );
  const chip = holder?.querySelector<HTMLButtonElement>(`button[aria-label^="${standing}:"]`);
  assert.ok(chip, `${key} wears its ${standing} chip`);
  return chip;
}

/** Presses the item of the open menu whose label is `label`. */
function pick(label: string): void {
  const item = [...document.querySelectorAll<HTMLElement>('[role^="menuitem"]')].find(
    (each) => each.querySelector(".luke-menu-item-label")?.textContent === label,
  );
  act(() => (item ?? assert.fail(`no ${label} item`)).click());
}

/** The tasks with the one numbered `number` changed as `change` says. */
function changed(number: number, change: Partial<TaskSummary>): TaskSummary[] {
  return TASKS.map((each) => (each.number === number ? { ...each, ...change } : each));
}

test("in the List, a teammate's change of status or priority moves no row while the page is shown, though the row says its new value", async () => {
  const { container, draw } = await mountView(TasksList, TASKS, DEFAULT_LIST_DISPLAY);
  const before = [
    ["In progress", ["ACME-42"]],
    ["Todo", ["ACME-40", "ACME-39", "ACME-41"]],
  ];
  assert.deepEqual(laidOut(container), before);

  draw(changed(41, { status: TASK_STATUS.IN_PROGRESS, priority: TASK_PRIORITY.URGENT }));

  assert.deepEqual(laidOut(container), before, "the row stays in its group and its place");
  assert.equal(
    chipOf(container, "ACME-41", "Status").getAttribute("aria-label"),
    "Status: In progress",
  );
});

test("in the List, a group whose last task goes slides out where it stood, out of reach, the groups that stay keeping the order they hold, and leaves once its exit has played", async () => {
  const motions = playListMotions();
  onTestFinished(motions.remove);
  const { container, draw } = await mountView(TasksList, TASKS, DEFAULT_LIST_DISPLAY);
  draw(changed(41, { status: TASK_STATUS.IN_PROGRESS, priority: TASK_PRIORITY.URGENT }));

  draw(TASKS.filter((each) => each.number !== 42));

  const leaving = container.querySelector<HTMLElement>(".tasks-list-group[data-leaving]");
  assert.equal(leaving?.getAttribute("aria-label"), "In progress", "its group is drawn on");
  assert.equal(leaving?.hasAttribute("inert"), true, "out of reach while it goes");
  const out = motions.played.find((each) => each.element === leaving);
  assert.equal(out?.keyframes.at(-1)?.opacity, 0, "it fades out as it slides");
  const standing = [...container.querySelectorAll<HTMLElement>(".tasks-list-group")]
    .filter((group) => group !== leaving)
    .map((group) => [...group.querySelectorAll("[data-task-key]")].map((key) => key.textContent));
  assert.deepEqual(standing, [["ACME-40", "ACME-39", "ACME-41"]], "the rows that stay hold");

  act(() => out?.finish());
  assert.equal(container.querySelector("[data-leaving]"), null);
  assert.deepEqual(laidOut(container), [["Todo", ["ACME-40", "ACME-39", "ACME-41"]]]);
});

test("in the List, a task held still stands where it is now once the page is hidden and shown again, or grouped anew", async () => {
  const { container, draw } = await mountView(TasksList, TASKS, DEFAULT_LIST_DISPLAY);
  const moved = changed(41, { status: TASK_STATUS.IN_PROGRESS, priority: TASK_PRIORITY.URGENT });
  draw(moved);

  draw(moved, { shown: false });
  draw(moved);

  assert.deepEqual(laidOut(container), [
    ["In progress", ["ACME-41", "ACME-42"]],
    ["Todo", ["ACME-40", "ACME-39"]],
  ]);

  draw(changed(41, { priority: TASK_PRIORITY.NONE }));
  draw(changed(41, { priority: TASK_PRIORITY.NONE }), {
    display: { ...DEFAULT_LIST_DISPLAY, grouping: TASKS_GROUPING.NONE },
  });

  assert.deepEqual(laidOut(container), [["Tasks", ["ACME-40", "ACME-39", "ACME-42", "ACME-41"]]]);
});

test("in the List, a status the reader picks on a row's chip moves the row once the view carries it", async () => {
  const { container, draw, sent } = await mountView(TasksList, TASKS, DEFAULT_LIST_DISPLAY);

  act(() => chipOf(container, "ACME-39", "Status").click());
  pick("In progress");
  await act(async () => undefined);
  draw(changed(39, { status: TASK_STATUS.IN_PROGRESS }));

  assert.deepEqual(sent, [["t-39", { status: TASK_STATUS.IN_PROGRESS }]]);
  assert.deepEqual(laidOut(container), [
    ["In progress", ["ACME-39", "ACME-42"]],
    ["Todo", ["ACME-40", "ACME-41"]],
  ]);

  draw(changed(39, { status: TASK_STATUS.IN_PROGRESS, priority: TASK_PRIORITY.LOW }));

  assert.deepEqual(
    laidOut(container),
    [
      ["In progress", ["ACME-39", "ACME-42"]],
      ["Todo", ["ACME-40", "ACME-41"]],
    ],
    "once moved, it holds still again in its new place",
  );
});

test("in the List ordered by name, a task the reader renamed here moves at once, and one a teammate renamed holds its place", async () => {
  const byName = {
    ...DEFAULT_LIST_DISPLAY,
    grouping: TASKS_GROUPING.NONE,
    order: TASKS_ORDER.NAME,
  };
  const { container, draw } = await mountView(TasksList, TASKS, byName);
  assert.deepEqual(laidOut(container), [["Tasks", ["ACME-40", "ACME-42", "ACME-39", "ACME-41"]]]);

  draw(changed(39, { name: "Add rate limits" }));

  assert.deepEqual(laidOut(container), [["Tasks", ["ACME-40", "ACME-42", "ACME-39", "ACME-41"]]]);

  draw(changed(41, { name: "A search filter" }), { pendingTasks: new Set(["t-41"]) });

  assert.deepEqual(laidOut(container), [["Tasks", ["ACME-41", "ACME-40", "ACME-42", "ACME-39"]]]);
});

test("on the Columns, a teammate's change holds a card in its column, and the reader's own pick on its chip moves it once the view carries it", async () => {
  const { container, draw } = await mountView(TasksBoard, TASKS, DEFAULT_BOARD_DISPLAY);
  const todo = (columns: [string, string[]][]) => columns.find(([name]) => name === "Todo")?.[1];
  const inProgress = (columns: [string, string[]][]) =>
    columns.find(([name]) => name === "In progress")?.[1];
  assert.deepEqual(todo(laidOut(container)), ["ACME-40", "ACME-39", "ACME-41"]);

  const teammate = changed(41, { status: TASK_STATUS.IN_PROGRESS });
  draw(teammate);

  assert.deepEqual(todo(laidOut(container)), ["ACME-40", "ACME-39", "ACME-41"]);
  assert.deepEqual(inProgress(laidOut(container)), ["ACME-42"]);

  act(() => chipOf(container, "ACME-40", "Status").click());
  pick("In progress");
  await act(async () => undefined);
  draw(
    teammate.map((each) =>
      each.number === 40 ? { ...each, status: TASK_STATUS.IN_PROGRESS } : each,
    ),
  );

  assert.deepEqual(todo(laidOut(container)), ["ACME-39", "ACME-41"]);
  assert.deepEqual(inProgress(laidOut(container)), ["ACME-40", "ACME-42"]);
});

test("in the List filtered to Todo, a task a teammate brings into Todo comes in, though the rows already drawn hold still", async () => {
  const todo: TasksFilter = { status: [TASK_STATUS.TODO] };
  const { container, draw } = await mountView(TasksList, TASKS, DEFAULT_LIST_DISPLAY);
  draw(TASKS, { filter: todo });
  assert.deepEqual(laidOut(container), [["Todo", ["ACME-40", "ACME-39", "ACME-41"]]]);

  draw(
    TASKS.map((each) =>
      each.number === 42
        ? { ...each, status: TASK_STATUS.TODO }
        : each.number === 41
          ? { ...each, priority: TASK_PRIORITY.URGENT }
          : each,
    ),
    { filter: todo },
  );

  assert.deepEqual(laidOut(container), [["Todo", ["ACME-40", "ACME-39", "ACME-42", "ACME-41"]]]);
});

/** Whether the row or the card of the task keyed `key` wears an Assignee chip. */
function wearsAssignee(page: HTMLElement, key: string): boolean {
  const holder = [...page.querySelectorAll<HTMLElement>("li")].find(
    (each) => each.querySelector("[data-task-key]")?.textContent === key,
  );
  assert.ok(holder, `${key} stands`);
  return holder.querySelector('button[aria-label^="Assignee:"]') !== null;
}

for (const [name, view, display] of [
  ["List", TasksList, DEFAULT_LIST_DISPLAY],
  ["Columns", TasksBoard, DEFAULT_BOARD_DISPLAY],
] as const) {
  test(`in the ${name} grouped by assignee, a task a teammate reassigns holds its group and wears its new assignee's chip`, async () => {
    const assigned = TASKS.map((each) => ({
      ...each,
      assignee: { userId: DEAN, name: "Dean Stratakos" },
    }));
    const byAssignee = { ...display, grouping: TASKS_GROUPING.ASSIGNEE };
    const { container, draw } = await mountView(view, assigned, byAssignee);
    const under = (key: string) => laidOut(container).find(([, keys]) => keys.includes(key))?.[0];
    const deans = under("ACME-41");
    assert.equal(wearsAssignee(container, "ACME-41"), false, "its group says who already");

    draw(
      assigned.map((each) =>
        each.number === 41 ? { ...each, assignee: { userId: CHARLES, name: "Charles Pan" } } : each,
      ),
    );

    assert.equal(under("ACME-41"), deans);
    assert.equal(wearsAssignee(container, "ACME-41"), true);
  });
}
