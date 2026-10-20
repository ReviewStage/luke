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
import type { AppInboxTask } from "@luke/host/app-state";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { runAppCommand } from "../app-commands.js";
import { SHELL_ROOM } from "../shell-room.js";
import { fakeActPort, fakeAppBridge } from "../testing/app-bridge.js";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { tasksControl } from "../testing/tasks-control.js";
import { TasksPage } from "./tasks-page.js";

/**
 * tasks-page.test.ts -- the Tasks page the inbox-first sidebar opens in the
 * Board's place: its List runs the pinned tasks first, then the rest under
 * their status from the work under way, the settled left out until asked;
 * each row says how many Inbox threads of its task wait on the reader; a
 * press opens the task; the switch beside the title shows the Board, and
 * both the view and the List's filter are kept on this Mac.
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

const roots: Root[] = [];

/** The tasks the page opened, in order. */
let opened: string[] = [];

/** How many times the page was closed. */
let closed = 0;

beforeEach(() => {
  opened = [];
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

/** A task of Acme's, numbered `number`, standing in `status` at `priority`. */
function task(
  number: number,
  name: string,
  status: TaskStatus,
  priority: TaskPriority,
  pinnedAt?: number,
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
    ...(pinnedAt === undefined ? undefined : { pinnedAt }),
  };
}

const TASKS = [
  task(36, "Self-hosting guide", TASK_STATUS.BACKLOG, TASK_PRIORITY.NONE),
  task(39, "Rate limit search", TASK_STATUS.TODO, TASK_PRIORITY.HIGH),
  task(40, "Billing after downgrade", TASK_STATUS.TODO, TASK_PRIORITY.URGENT),
  task(42, "Fix Safari login", TASK_STATUS.IN_PROGRESS, TASK_PRIORITY.HIGH),
  task(44, "Teammate invitations", TASK_STATUS.IN_PROGRESS, TASK_PRIORITY.LOW, 5),
  task(35, "Migrate auth SDK", TASK_STATUS.DONE, TASK_PRIORITY.HIGH),
];

/** Two threads of the invitations' task, and one of Safari's, waiting on Dean. */
const WAITING: readonly AppInboxTask[] = [
  {
    taskId: "t-44",
    items: [
      { id: "i-1", agentId: "a-1", title: "Invite links: 7 days or 14?", postedAt: 3 },
      { id: "i-2", agentId: "a-1", title: "Add the Postmark token", postedAt: 2 },
    ],
  },
  {
    taskId: "t-42",
    items: [{ id: "i-3", agentId: "a-2", title: "Which browsers?", postedAt: 1 }],
  },
];

/** The Tasks page over Acme's tasks, read by Dean, once the members have answered. */
async function mountPage(): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const control = tasksControl({
    tasks: [...TASKS],
    inbox: WAITING,
    workspace: ACME,
    workspaces: [ACME],
    me: DEAN,
    listRead: true,
    onSelect: (taskId) => opened.push(taskId),
    boardView: { open: true, onOpen: () => undefined, onClose: () => (closed += 1) },
  });
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(TasksPage, { tasks: control, room: SHELL_ROOM.WIDE }),
      ),
    ),
  );
  await act(async () => undefined);
  return container;
}

/** Each group of the List: its name and its rows' keys, in order. */
function groups(page: HTMLElement): [string, string[]][] {
  return [...page.querySelectorAll<HTMLElement>(".tasks-list-group")].map((group) => [
    group.getAttribute("aria-label") ?? "",
    [...group.querySelectorAll(".tasks-list-key")].map((key) => key.textContent ?? ""),
  ]);
}

/** The row of the task keyed `key`, its press. */
function rowOf(page: HTMLElement, key: string): HTMLElement {
  const row = [...page.querySelectorAll<HTMLElement>(".tasks-list-group li")].find(
    (each) => each.querySelector(".tasks-list-key")?.textContent === key,
  );
  assert.ok(row, `the row of ${key} stands`);
  return row;
}

/** The toolbar's button named `name`. */
function buttonNamed(page: HTMLElement, name: string): HTMLButtonElement {
  const button = [...page.querySelectorAll<HTMLButtonElement>("button, [role='radio']")].find(
    (each) => each.textContent?.trim() === name,
  );
  assert.ok(button, `${name} is offered`);
  return button;
}

test("the List puts the pins first, then the rest by status from the work under way, the most pressing first, the settled left out", async () => {
  const page = await mountPage();

  assert.deepEqual(groups(page), [
    ["Pinned", ["ACME-44"]],
    ["In progress", ["ACME-42"]],
    ["Todo", ["ACME-40", "ACME-39"]],
    ["Backlog", ["ACME-36"]],
  ]);
});

test("a row says how many of its task's Inbox threads wait on the reader", async () => {
  const page = await mountPage();

  assert.match(rowOf(page, "ACME-44").textContent ?? "", /2 need you/);
  assert.match(rowOf(page, "ACME-42").textContent ?? "", /1 needs you/);
  assert.doesNotMatch(rowOf(page, "ACME-40").textContent ?? "", /needs? you/);
});

test("a press on a row opens its task", async () => {
  const page = await mountPage();
  act(() => rowOf(page, "ACME-40").querySelector<HTMLButtonElement>("button")?.click());
  assert.deepEqual(opened, ["t-40"]);
});

test("Done shows its group once asked for, kept on this Mac", async () => {
  const page = await mountPage();
  act(() => buttonNamed(page, "Done").click());
  assert.deepEqual(groups(page).at(-1), ["Done", ["ACME-35"]]);

  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  assert.deepEqual((await mountPage()).querySelectorAll(".tasks-list-group").length, 5);
});

test("the switch beside the title shows the Board, kept on this Mac", async () => {
  const page = await mountPage();
  act(() => buttonNamed(page, "Board").click());
  assert.equal(page.querySelector(".tasks-list"), null);
  assert.ok(page.querySelector("[data-task-column]"), "the Board's columns stand");
  assert.equal(page.querySelector("h1")?.textContent, "Tasks");

  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  assert.ok((await mountPage()).querySelector("[data-task-column]"), "the Board is shown again");
});

test("Escape closes the page from the List as from the Board", async () => {
  await mountPage();
  act(() => {
    assert.ok(runAppCommand(APP_COMMAND.EXIT_BOARD), "the page's way out is offered");
  });
  assert.equal(closed, 1);
});

test("a row says its key and status to a screen reader, its leading marks being decoration", async () => {
  const page = await mountPage();
  const press = rowOf(page, "ACME-44").querySelector("button");
  assert.match(press?.textContent ?? "", /Teammate invitations, ACME-44, In progress/u);
});

test("find opened in the List is let go as the Board is chosen", async () => {
  const page = await mountPage();
  act(() => {
    assert.ok(runAppCommand(APP_COMMAND.FIND), "the List offers find");
  });
  assert.ok(page.querySelector("search[aria-label='Find']"), "the List's find bar stands");
  act(() => buttonNamed(page, "Board").click());
  assert.equal(page.querySelector("search[aria-label='Find']"), null);
});

test("a row's words said to a screen reader alone are left out of find, so a key searched is found once", async () => {
  const page = await mountPage();
  const press = rowOf(page, "ACME-44").querySelector("button");
  const spoken = press?.querySelector(".visually-hidden");
  assert.ok(spoken, "the key and status are said");
  assert.ok(spoken.hasAttribute("data-find-skip"), "find passes over them");
});
