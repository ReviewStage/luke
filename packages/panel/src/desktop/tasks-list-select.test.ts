// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { TaskSection, TaskSections } from "@luke/features/task-section-wire";
import {
  TASK_PRIORITY,
  TASK_STATUS,
  type TaskStatus,
  type TaskSummary,
} from "@luke/features/task-wire";
import { IDLE_TASKS_VIEW, TASKS_READ, type TasksView } from "@luke/features/tasks-view";
import type { Workspace, WorkspaceMember } from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import { RUN_PROFILE } from "@luke/host/app-state";
import type { PortActKind } from "@luke/host/contract";
import { MICROPHONE_STATUS } from "@luke/voice/audio";
import { Option, Schema } from "effect";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import type { ActHandle } from "../act.js";
import { SHELL_ROOM } from "../shell-room.js";
import { useLeaveGuard, useTasksTab } from "../tasks/use-tasks-tab.js";
import { fakeActPort, fakeAppBridge } from "../testing/app-bridge.js";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { newestToastAction, newestToastSays } from "../testing/toast.js";
import { ToastHost } from "../toast.js";
import { TasksPage } from "./tasks-page.js";

/**
 * tasks-list-select.test.ts -- the Tasks page's List chooses rows as a Mac's list does: ⌘-click two tasks and the bar's Mark done sets both Done at once, under one toast whose Undo puts both back where they stood; Set status and Move to section act on them all alike; and Esc lets the selection go.
 *
 * The List stands over the tasks tab itself (`useTasksTab`), so what a
 * press sends is what the service is asked, and what the rows draw is the
 * tab's own word.
 */

const DEAN = "user-dean";

const ACME = {
  id: "workspace-acme",
  name: "Acme",
  role: "owner",
  github: null,
  memberCount: 1,
} as const satisfies Workspace;

const MEMBERS: readonly WorkspaceMember[] = [
  { userId: DEAN, name: "Dean Stratakos", email: "dean@acme.dev", role: "owner" },
];

/** A task of Acme's, numbered `number`, standing in `status`. */
function task(number: number, name: string, status: TaskStatus): TaskSummary {
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
    priority: TASK_PRIORITY.NONE,
    number,
  };
}

const TASKS = [
  task(39, "Rate limit search", TASK_STATUS.TODO),
  task(42, "Fix Safari login", TASK_STATUS.IN_PROGRESS),
  task(36, "Self-hosting guide", TASK_STATUS.BACKLOG),
];

/** Dean's one section in Acme. */
const LAUNCH: TaskSection = {
  id: "section-launch",
  workspaceId: ACME.id,
  title: "Launch",
  createdAt: 1,
};

/** Dean's sections, Launch holding the tasks given. */
function sectionsHolding(taskIds: readonly string[]): TaskSections {
  return {
    sections: [LAUNCH],
    entries: taskIds.map((taskId, at) => ({ taskId, sectionId: LAUNCH.id, addedAt: at })),
    agentEntries: [],
  };
}

/** Acme's tasks as main holds them, read, and Dean's sections, Launch holding none. */
function viewOf(
  tasks: readonly TaskSummary[],
  taskSections: TaskSections = sectionsHolding([]),
): TasksView {
  return {
    ...IDLE_TASKS_VIEW,
    listStatus: TASKS_READ.READY,
    workspaces: [ACME],
    tasks,
    taskSections,
  };
}

/** A status write's payload, read back as the act's own schema admits it. */
const readStanding = Schema.decodeUnknownOption(
  Schema.Struct({ taskId: Schema.String, status: Schema.optionalKey(Schema.String) }),
);

/** A section write's payload, read back as far as a task's place goes. */
const readPlace = Schema.decodeUnknownOption(
  Schema.Struct({ taskId: Schema.String, sectionId: Schema.NullOr(Schema.String) }),
);

const roots: Root[] = [];

/** Each status the service was asked to set, as task id and status, in order. */
let asked: [string, string | undefined][] = [];

/** Each place in a section the service was asked to put a task, as task id and section, in order. */
let placed: [string, string | null][] = [];

beforeEach(() => {
  asked = [];
  placed = [];
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

/** Lets the service's answers, and the redraws they cause, land. */
async function settle(): Promise<void> {
  await act(async () => undefined);
  await act(async () => undefined);
}

/**
 * The Tasks page over the tasks tab, which reads `TASKS` as main holds them;
 * the service keeps every status asked of it. Answers how to hand the tab
 * the list main holds next, as the service's word reaches it.
 */
async function mountPage(): Promise<{
  page: HTMLElement;
  hold: (tasks: readonly TaskSummary[], taskSections?: TaskSections) => void;
}> {
  let restand: ((view: TasksView) => void) | undefined;
  function Page() {
    const [view, setView] = useState(viewOf(TASKS));
    restand = setView;
    const control = useTasksTab({
      acts: {
        // SAFETY: the kinds the test answers are the status and section writes, each answered as kept; every other kind is refused.
        act: ((kind: PortActKind, payload: unknown) => {
          if (kind === ACT_KIND.TASKS_WRITE_SECTION) {
            const place = Option.getOrUndefined(readPlace(payload));
            if (place !== undefined) placed.push([place.taskId, place.sectionId]);
            return Promise.resolve(true);
          }
          if (kind !== ACT_KIND.TASKS_SET_STANDING) return Promise.reject(new Error("unasked"));
          const standing = Option.getOrUndefined(readStanding(payload));
          if (standing !== undefined) asked.push([standing.taskId, standing.status]);
          return Promise.resolve(true);
        }) as ActHandle["act"],
        tell: () => undefined,
      },
      tasks: view,
      run: { fixtureMode: false, profile: RUN_PROFILE.IDLE },
      signedIn: true,
      account: "dean@acme.dev",
      voiceAvailable: true,
      microphoneStatus: MICROPHONE_STATUS.GRANTED,
      shown: true,
      unseenAgents: [],
      inboxWaiting: [],
      inboxTasks: [],
      inboxTaskless: [],
      failedRuns: [],
      onOpenIntegrations: () => undefined,
      onOpenApiKeys: () => undefined,
      onOpenSettings: () => undefined,
      leaveGuard: useLeaveGuard(),
      room: SHELL_ROOM.WIDE,
    });
    return createElement(TasksPage, { tasks: control, room: SHELL_ROOM.WIDE });
  }
  const page = document.createElement("div");
  document.body.append(page);
  const root = createRoot(page);
  roots.push(root);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(Fragment, null, createElement(Page), createElement(ToastHost)),
      ),
    ),
  );
  await settle();
  return {
    page,
    hold: (tasks, taskSections) => act(() => restand?.(viewOf(tasks, taskSections))),
  };
}

/** Each group of the List: its name and its rows' keys, in order. */
function groups(page: HTMLElement): [string, string[]][] {
  return [...page.querySelectorAll<HTMLElement>(".tasks-list-group")].map((group) => [
    group.getAttribute("aria-label") ?? "",
    [...group.querySelectorAll("[data-task-key]")].map((key) => key.textContent ?? ""),
  ]);
}

/** The press of the row of the task keyed `key`. */
function pressOf(page: HTMLElement, key: string): HTMLButtonElement {
  const row = [...page.querySelectorAll<HTMLElement>(".tasks-list-group li")].find(
    (each) => each.querySelector("[data-task-key]")?.textContent === key,
  );
  const press = row?.querySelector<HTMLButtonElement>("[data-card-press]");
  assert.ok(press, `the row of ${key} stands`);
  return press;
}

/** ⌘-clicks the row of the task keyed `key`. */
function commandClick(page: HTMLElement, key: string): void {
  act(() => {
    pressOf(page, key).dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true }),
    );
  });
}

/** The keys of the rows the List holds chosen, in the order drawn. */
function chosen(page: HTMLElement): string[] {
  return [...page.querySelectorAll<HTMLElement>(".tasks-list-group li")]
    .filter((row) => row.querySelector('[data-card-press][data-selected="true"]') !== null)
    .map((row) => row.querySelector("[data-task-key]")?.textContent ?? "");
}

/** Presses the open menu's item named `name`. */
function choose(name: string): void {
  const item = [
    ...document.querySelectorAll<HTMLElement>('[role="menu"]:not([data-leaving]) .luke-menu-item'),
  ].find((each) => each.querySelector(".luke-menu-item-label")?.textContent === name);
  assert.ok(item, `${name} is in the menu`);
  act(() => item.click());
}

/** The selection bar's button named `name`. */
function barButton(page: HTMLElement, name: string): HTMLButtonElement {
  const button = [...page.querySelectorAll<HTMLButtonElement>('[role="toolbar"] button')].find(
    (each) => each.textContent?.trim() === name,
  );
  assert.ok(button, `the bar offers ${name}`);
  return button;
}

test("⌘-clicking two tasks chooses them without opening either, and the bar's Mark done sets both Done under one toast", async () => {
  const { page } = await mountPage();

  commandClick(page, "ACME-39");
  commandClick(page, "ACME-42");
  assert.deepEqual(chosen(page), ["ACME-42", "ACME-39"]);
  assert.match(page.querySelector('[role="toolbar"]')?.textContent ?? "", /2 selected/u);

  act(() => barButton(page, "Mark done").click());
  await settle();

  assert.deepEqual(asked, [
    ["t-39", TASK_STATUS.DONE],
    ["t-42", TASK_STATUS.DONE],
  ]);
  assert.deepEqual(groups(page), [
    ["Launch", []],
    ["Backlog", ["ACME-36"]],
  ]);
  assert.match(newestToastSays() ?? "", /2 tasks marked done/u);
  assert.equal(page.querySelector('[role="toolbar"]'), null, "the selection is let go");
});

test("Mark done's Undo puts both tasks back at the status each stood at", async () => {
  const { page, hold } = await mountPage();
  commandClick(page, "ACME-39");
  commandClick(page, "ACME-42");
  act(() => barButton(page, "Mark done").click());
  await settle();
  // The service's word reaches the tab: both tasks now stand Done.
  hold(TASKS.map((each) => (each.number === 36 ? each : { ...each, status: TASK_STATUS.DONE })));

  const undo = newestToastAction();
  assert.equal(undo?.textContent, "Undo");
  act(() => undo?.click());
  await settle();

  assert.deepEqual(asked.slice(2), [
    ["t-39", TASK_STATUS.TODO],
    ["t-42", TASK_STATUS.IN_PROGRESS],
  ]);
  assert.deepEqual(groups(page), [
    ["Launch", []],
    ["In progress", ["ACME-42"]],
    ["Todo", ["ACME-39"]],
    ["Backlog", ["ACME-36"]],
  ]);
});

test("Esc lets the selection go, and the bar with it", async () => {
  const { page } = await mountPage();
  commandClick(page, "ACME-39");
  commandClick(page, "ACME-36");
  assert.deepEqual(chosen(page), ["ACME-39", "ACME-36"]);

  act(() => {
    pressOf(page, "ACME-36").dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
  });

  assert.deepEqual(chosen(page), []);
  assert.equal(page.querySelector('[role="toolbar"]'), null);
});

test("Set status sets every task chosen at the status picked, under one toast", async () => {
  const { page } = await mountPage();
  commandClick(page, "ACME-39");
  commandClick(page, "ACME-36");

  act(() => barButton(page, "Set status").click());
  choose("In progress");
  await settle();

  assert.deepEqual(asked, [
    ["t-39", TASK_STATUS.IN_PROGRESS],
    ["t-36", TASK_STATUS.IN_PROGRESS],
  ]);
  assert.deepEqual(groups(page), [
    ["Launch", []],
    ["In progress", ["ACME-36", "ACME-39", "ACME-42"]],
  ]);
  assert.match(newestToastSays() ?? "", /2 tasks moved to In progress/u);
});

test("Move to section keeps every task chosen in the section picked, and its Undo takes them out again", async () => {
  const { page, hold } = await mountPage();
  commandClick(page, "ACME-39");
  commandClick(page, "ACME-42");

  act(() => barButton(page, "Move to section").click());
  choose("Launch");
  await settle();
  hold(TASKS, sectionsHolding(["t-42", "t-39"]));

  assert.deepEqual(groups(page)[0], ["Launch", ["ACME-39", "ACME-42"]]);
  assert.match(newestToastSays() ?? "", /2 tasks moved to Launch/u);
  act(() => newestToastAction()?.click());
  await settle();
  assert.deepEqual(placed.slice(-2), [
    ["t-39", null],
    ["t-42", null],
  ]);
});

test("a task folded away leaves the selection, and reopening its group chooses it no more", async () => {
  const { page } = await mountPage();
  commandClick(page, "ACME-39");
  const fold = () => {
    const head = page.querySelector<HTMLButtonElement>('section[aria-label="Todo"] h2 button');
    assert.ok(head, "Todo folds by its head");
    act(() => head.click());
  };

  fold();
  assert.equal(page.querySelector('[role="toolbar"]'), null);
  fold();

  assert.deepEqual(chosen(page), []);
  assert.equal(page.querySelector('[role="toolbar"]'), null);
});
