// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { TaskSections, TaskSectionWrite } from "@luke/features/task-section-wire";
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
import type { AppInboxTask } from "@luke/host/app-state";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import { NO_TASK_SECTIONS } from "@luke/ui/task-sections-model";
import { TASK_MARK, type TaskMark } from "@luke/ui/tasks-model";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { runAppCommand } from "../app-commands.js";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import { fakeActPort, fakeAppBridge } from "../testing/app-bridge.js";
import { fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { restOn } from "../testing/hint-rest.js";
import { tasksControl } from "../testing/tasks-control.js";
import { ToastHost } from "../toast.js";
import { TasksPage } from "./tasks-page.js";

/**
 * tasks-page.test.ts -- the Tasks page the sidebar's Tasks row opens: its List runs the pinned tasks first, then the rest under
 * their status from the work under way, the settled left out until asked;
 * each row says how many Inbox threads of its task wait on the reader; a
 * press opens the task; the switch beside the title shows the Board; the
 * Filter narrows the tasks and its chips lift it; View options groups them,
 * shows the settled, and draws a row's properties; and the view, the
 * filter, and the display are kept on this Mac. Every row draws a cell for
 * each property the view draws, so the columns line up down the page; a
 * row's chips send the priority and status picked, and a right-click drops
 * the task's own menu; a group's head folds it, kept on this Mac; and a row
 * dragged onto another group is sent its status, pinned, or kept in its
 * section, leaving Pinned or its section where it came from one.
 */

const DEAN = "user-dean";

const ACME = {
  id: "workspace-acme",
  name: "Acme",
  role: "owner",
  github: null,
  memberCount: 1,
} as const satisfies Workspace;

const BETA = { ...ACME, id: "workspace-beta", name: "Beta" } as const satisfies Workspace;

const MEMBERS: readonly WorkspaceMember[] = [
  { userId: DEAN, name: "Dean Stratakos", email: "dean@acme.dev", role: "owner" },
];

const roots: Root[] = [];

/** The tasks the page opened, in order. */
let opened: string[] = [];

/** How many times the page was closed. */
let closed = 0;

/** Each change of where a task stands the page sent, in order. */
let sent: [string, TaskStanding][] = [];

/** Each pin, unpin, or archive the page sent, in order. */
let marked: [string, TaskMark][] = [];

/** Each batch of section writes the page sent, in order. */
let written: (readonly TaskSectionWrite[])[] = [];

/** The account's sections the page is drawn over. */
let sections: TaskSections = NO_TASK_SECTIONS;

/** Whether the service keeps the changes of where a task stands sent. */
let keeps = true;

beforeEach(() => {
  opened = [];
  closed = 0;
  sent = [];
  marked = [];
  written = [];
  sections = NO_TASK_SECTIONS;
  keeps = true;
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

/** The Tasks page over Acme's tasks, or `tasks`, read by Dean, once the members have answered. */
async function mountPage(
  tasks: readonly TaskSummary[] = TASKS,
  room: ShellRoom = SHELL_ROOM.WIDE,
): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const registry = AtomRegistry.make();
  const draw = (workspace: Workspace) => {
    const control = tasksControl({
      tasks: tasks.map((each) => ({ ...each, workspaceId: workspace.id })),
      inbox: WAITING,
      workspace,
      workspaces: [ACME, BETA],
      me: DEAN,
      listRead: true,
      taskSections: sections,
      onSelect: (taskId) => opened.push(taskId),
      boardView: { open: true, onOpen: () => undefined, onClose: () => (closed += 1) },
      onSetTaskStanding: (taskId, standing) => {
        sent.push([taskId, standing]);
        return Promise.resolve(keeps);
      },
      onMarkTask: (taskId, mark) => marked.push([taskId, mark]),
      onWriteSections: (writes) => written.push(writes),
    });
    root.render(
      onRegistry(
        registry,
        createElement(
          Fragment,
          null,
          createElement(TasksPage, { tasks: control, room }),
          createElement(ToastHost),
        ),
      ),
    );
  };
  listWorkspace = (workspace) => act(() => draw(workspace));
  act(() => draw(ACME));
  await act(async () => undefined);
  return container;
}

/** Lists another workspace on the page last mounted, as the sidebar's switcher does. */
let listWorkspace: (workspace: Workspace) => void = () => undefined;

/** Each group of the List: its name and its rows' keys, in order. */
function groups(page: HTMLElement): [string, string[]][] {
  return [...page.querySelectorAll<HTMLElement>(".tasks-list-group")].map((group) => [
    group.getAttribute("aria-label") ?? "",
    [...group.querySelectorAll("[data-task-key]")].map((key) => key.textContent ?? ""),
  ]);
}

/** The row of the task keyed `key`, its press. */
function rowOf(page: HTMLElement, key: string): HTMLElement {
  const row = [...page.querySelectorAll<HTMLElement>(".tasks-list-group li")].find(
    (each) => each.querySelector("[data-task-key]")?.textContent === key,
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

/** The toolbar's button named `label`, Filter or View options, pressed. */
function openOptions(page: HTMLElement, label: string): void {
  const button = page.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  assert.ok(button, `${label} is offered`);
  act(() => button.click());
}

/** Presses the open menus' items named `names`, in order: a submenu, then its items. */
function choose(...names: string[]): void {
  for (const name of names) {
    const item = [
      ...document.querySelectorAll<HTMLElement>(
        '[role="menu"]:not([data-leaving]) .luke-menu-item',
      ),
    ].find((each) => each.querySelector(".luke-menu-item-label")?.textContent === name);
    assert.ok(item, `${name} is in the menu`);
    act(() => item.click());
  }
}

/** Closes whatever menus stand, a submenu and then its menu, as Escape does each. */
function closeMenus(): void {
  while (document.querySelector('[role="menu"]:not([data-leaving])') !== null) {
    act(() => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
  }
}

test("Show completed stands Done with a line counting the tasks finished before its window, which shows them all, kept on this Mac", async () => {
  const page = await mountPage();
  openOptions(page, "View options");
  choose("Show completed", "Past week");
  closeMenus();
  assert.deepEqual(groups(page).at(-1), ["Done", []]);
  const older = [...page.querySelectorAll<HTMLButtonElement>(".tasks-list-group button")].find(
    (button) => button.textContent === "+ 1 older",
  );
  act(() => (older ?? assert.fail("no older line under Done")).click());
  assert.deepEqual(groups(page).at(-1), ["Done", ["ACME-35"]]);

  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  assert.deepEqual((await mountPage()).querySelectorAll(".tasks-list-group").length, 5);
});

test("the Filter narrows the List to the values chosen, several in one visit, a chip says so and its × lifts it, and it is kept on this Mac", async () => {
  const page = await mountPage();
  openOptions(page, "Filter");
  choose("Priority", "High", "Urgent");
  closeMenus();

  assert.deepEqual(groups(page), [
    ["In progress", ["ACME-42"]],
    ["Todo", ["ACME-40", "ACME-39"]],
  ]);
  assert.match(page.textContent ?? "", /Priority: Urgent, High/);
  assert.equal(
    page.querySelector("[data-filtered='true'] button")?.getAttribute("aria-label"),
    "Filter",
  );

  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  const again = await mountPage();
  assert.equal(groups(again).length, 2, "the filter is kept");
  const lift = again.querySelector<HTMLButtonElement>(
    "button[aria-label='Clear the priority filter']",
  );
  assert.ok(lift, "the chip lifts its filter");
  act(() => lift.click());
  assert.equal(groups(again).length, 4);
  assert.equal(again.querySelector("[data-filtered='true']"), null);
});

/** The list motion's tokens, as the app's sheets set them, and an engine that records each motion rather than playing it; answers what was played and a way to take both away. */
function recordMotions() {
  const tokens = {
    "--luke-duration-exit": "90ms",
    "--luke-motion-exit": "ease",
    "--luke-duration-quick": "140ms",
    "--luke-duration-shape": "460ms",
    "--luke-spring": "ease-out",
    "--luke-row-stagger": "32ms",
  };
  for (const [name, value] of Object.entries(tokens)) {
    document.documentElement.style.setProperty(name, value);
  }
  const played: { element: Element; keyframes: Keyframe[]; finish: () => void }[] = [];
  Object.defineProperty(Element.prototype, "animate", {
    configurable: true,
    value(this: Element, keyframes: Keyframe[]) {
      const motion = { onfinish: null as (() => void) | null, cancel: () => undefined };
      played.push({ element: this, keyframes, finish: () => motion.onfinish?.() });
      return motion;
    },
  });
  return {
    played,
    scaled: (element: Element | null | undefined) =>
      played.some(
        (motion) =>
          motion.element === element &&
          motion.keyframes.some((frame) => String(frame.transform).includes("scale")),
      ),
    remove: () => {
      for (const name of Object.keys(tokens)) document.documentElement.style.removeProperty(name);
      Reflect.deleteProperty(Element.prototype, "animate");
    },
  };
}

test("a field's chip scales in as it is filtered, and lifted, the list widens at once while the chip scales out out of reach", async () => {
  const motion = recordMotions();
  try {
    const page = await mountPage();
    const line = () => page.querySelector<HTMLElement>(".tasks-filter-line");
    assert.equal(line()?.hidden, true, "the line stands ready, hidden");
    openOptions(page, "Filter");
    choose("Priority", "High");
    closeMenus();
    const chip = page.querySelector("[data-motion-key='priority']");
    assert.ok(motion.scaled(chip), "the first chip scales in");

    const lift = page.querySelector<HTMLButtonElement>(
      "button[aria-label='Clear the priority filter']",
    );
    act(() => (lift ?? assert.fail("a way to lift it")).click());
    assert.equal(groups(page).length, 4, "the list widens on the press");
    const leaving = page.querySelector("[data-motion-key='priority']");
    assert.equal(leaving?.hasAttribute("data-leaving"), true, "drawn through its exit");
    assert.equal(leaving?.hasAttribute("inert"), true);
    assert.ok(motion.scaled(leaving), "it scales out");

    act(() => {
      for (const each of motion.played.splice(0)) each.finish();
    });
    assert.equal(page.querySelector("[data-motion-key='priority']"), null);
    assert.equal(line()?.hidden, true);
  } finally {
    motion.remove();
  }
});

test("a filter chosen here keeps another workspace's filter that another tab kept meanwhile", async () => {
  const page = await mountPage();
  const elsewhere = { "workspace-beta": { priority: [TASK_PRIORITY.LOW] } };
  window.localStorage.setItem("luke.tasksFilter", JSON.stringify(elsewhere));
  openOptions(page, "Filter");
  choose("Priority", "High");
  closeMenus();

  assert.deepEqual(JSON.parse(window.localStorage.getItem("luke.tasksFilter") ?? "{}"), {
    ...elsewhere,
    [ACME.id]: { priority: [TASK_PRIORITY.HIGH] },
  });
});

test("with storage refusing every write, each workspace's filter still stands while the page does", async () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("quota");
  });
  const page = await mountPage();
  openOptions(page, "Filter");
  choose("Priority", "Urgent");
  closeMenus();
  listWorkspace(BETA);
  openOptions(page, "Filter");
  choose("Priority", "Low");
  closeMenus();
  listWorkspace(ACME);

  assert.deepEqual(groups(page), [["Todo", ["ACME-40"]]]);
});

test("grouped by priority, the pins not leading, the List runs from the most pressing, and a property turned off leaves every row", async () => {
  const page = await mountPage();
  openOptions(page, "View options");
  choose("Group by", "Priority");
  openOptions(page, "View options");
  choose("Pinned and sections first", "Properties", "Repository");
  closeMenus();

  assert.deepEqual(groups(page), [
    ["Urgent", ["ACME-40"]],
    ["High", ["ACME-39", "ACME-42"]],
    ["Low", ["ACME-44"]],
    ["No priority", ["ACME-36"]],
  ]);
  assert.equal(page.querySelector(".tasks-list [data-cell='repository']"), null);
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

test("on a phone the page is headed by New task and one ⋯, its title centred between them, and the ⋯ chooses the Board and opens the Filter's and View options' own menus, so nothing is lost", async () => {
  const page = await mountPage(TASKS, SHELL_ROOM.NARROW);
  assert.deepEqual(
    [...page.querySelectorAll(".tasks-head button")].map((each) => each.getAttribute("aria-label")),
    ["New task", "More"],
  );
  assert.equal(page.querySelector(".tasks-head h1")?.textContent, "Tasks");
  assert.equal(page.querySelector('[role="radiogroup"]'), null, "no List | Board bar in the head");

  openOptions(page, "More");
  choose("Filter");
  choose("Priority", "High", "Urgent");
  closeMenus();
  // Note that a phone's rows draw no key, so the groups are read by name and the filter by its chip.
  assert.deepEqual(
    groups(page).map(([name]) => name),
    ["In progress", "Todo"],
  );
  assert.match(page.textContent ?? "", /Priority: Urgent, High/);

  openOptions(page, "More");
  choose("View options");
  assert.ok(
    document.querySelector('[role="menu"][aria-label="View options"]:not([data-leaving])'),
    "View options' own menu stands",
  );
  closeMenus();

  openOptions(page, "More");
  choose("Board");
  assert.ok(page.querySelector("[data-task-column]"), "the Board's columns stand");
  assert.equal(
    document.querySelector('[role="menu"]:not([data-leaving])'),
    null,
    "a menu closed before is not opened again by the switch",
  );
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
  assert.ok(page.querySelector("[role='search'][aria-label='Find']"), "the List's find bar stands");
  act(() => buttonNamed(page, "Board").click());
  assert.equal(page.querySelector("[role='search'][aria-label='Find']"), null);
});

test("a row's words said to a screen reader alone are left out of find, so a key searched is found once", async () => {
  const page = await mountPage();
  const press = rowOf(page, "ACME-44").querySelector("button");
  const spoken = press?.querySelector(".luke-visually-hidden");
  assert.ok(spoken, "the key and status are said");
  assert.ok(spoken.hasAttribute("data-find-skip"), "find passes over them");
});

test("every row draws a cell for each property the view draws, an empty one where its task has nothing to say, so the columns line up down the page", async () => {
  const page = await mountPage();
  const cells = (key: string) =>
    [...rowOf(page, key).querySelectorAll("[data-cell]")].map((cell) =>
      cell.getAttribute("data-cell"),
    );

  assert.deepEqual(cells("ACME-44"), cells("ACME-40"), "a row with Inbox threads and one without");
  assert.ok(
    rowOf(page, "ACME-40").querySelector("[data-cell='waiting']"),
    "a row waits on nobody in a cell of its own",
  );
});

/** The chip on a task's row that changes its `standing`, Priority or Status. */
function rowChip(page: HTMLElement, key: string, standing: string): HTMLButtonElement {
  const chip = rowOf(page, key).querySelector<HTMLButtonElement>(
    `button[aria-label^="${standing}:"]`,
  );
  assert.ok(chip, `the row of ${key} wears its ${standing} chip`);
  return chip;
}

test("a row's Priority chip sends the priority picked, and its Status chip the status, opening no task", async () => {
  const page = await mountPage();

  act(() => rowChip(page, "ACME-39", "Priority").click());
  choose("Urgent");
  act(() => rowChip(page, "ACME-36", "Status").click());
  choose("In progress");

  assert.deepEqual(sent, [
    ["t-39", { priority: TASK_PRIORITY.URGENT }],
    ["t-36", { status: TASK_STATUS.IN_PROGRESS }],
  ]);
  assert.deepEqual(opened, [], "a pick opens no task");
});

test("a right-click on a row drops the task's own menu, and its ⋯ the same", async () => {
  const page = await mountPage();
  act(() => {
    rowOf(page, "ACME-40")
      .querySelector("button")
      ?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  });
  const labels = () =>
    [...document.querySelectorAll('[role="menu"]:not([data-leaving]) .luke-menu-item-label')].map(
      (label) => label.textContent,
    );
  assert.ok(labels().includes("Rename"), "the menu offers Rename");
  closeMenus();

  const more = rowOf(page, "ACME-40").querySelector<HTMLButtonElement>(
    "button[aria-label='Actions for Billing after downgrade']",
  );
  assert.ok(more, "the row offers its ⋯");
  act(() => more.click());
  assert.ok(labels().includes("Rename"), "the ⋯ drops the same menu");
  assert.deepEqual(opened, []);
});

test("a row draws the pull requests its agents opened, each its mark and its number", async () => {
  const withPullRequest: TaskSummary = {
    ...task(39, "Rate limit search", TASK_STATUS.TODO, TASK_PRIORITY.HIGH),
    agents: {
      total: 1,
      working: 0,
      agents: [],
      pullRequestTotal: 1,
      pullRequests: [
        {
          number: 4222,
          title: "Rate limit search",
          state: "open",
          checks: "passing",
          additions: 10,
          deletions: 2,
        },
      ],
    },
  };
  const page = await mountPage([withPullRequest, ...TASKS.slice(2)]);
  const agents = rowOf(page, "ACME-39").querySelector("[data-cell='agents']");

  assert.ok(
    agents?.querySelector("[data-pull-request-mark]"),
    "the row wears the pull request's mark",
  );
  assert.match(agents?.textContent ?? "", /#4222/);
});

test("a row whose agents rest keeps the working mark's room before its pull request, so its pull request lines up with a working row's", async () => {
  const pullRequest = (number: number) => ({
    number,
    title: "Rate limit search",
    state: "open" as const,
    checks: "passing" as const,
    additions: 10,
    deletions: 2,
  });
  const resting: TaskSummary = {
    ...task(39, "Rate limit search", TASK_STATUS.TODO, TASK_PRIORITY.HIGH),
    agents: {
      total: 1,
      working: 0,
      agents: [],
      pullRequestTotal: 1,
      pullRequests: [pullRequest(4222)],
    },
  };
  const working: TaskSummary = {
    ...task(38, "Billing after downgrade", TASK_STATUS.TODO, TASK_PRIORITY.HIGH),
    agents: {
      total: 1,
      working: 1,
      agents: [],
      pullRequestTotal: 1,
      pullRequests: [pullRequest(4223)],
    },
  };
  const page = await mountPage([resting, working, ...TASKS.slice(2)]);
  const lead = (key: string) =>
    [...(rowOf(page, key).querySelector("[data-cell='agents'] .task-work-marks")?.children ?? [])]
      .map((mark) => mark.getAttribute("data-task-work"))
      .slice(0, 2);

  assert.deepEqual(lead("ACME-38"), ["agents", "pull-request"]);
  assert.deepEqual(lead("ACME-39"), ["agents", "pull-request"]);
  assert.equal(
    rowOf(page, "ACME-39").querySelector("[data-cell='agents'] [data-state='working']"),
    null,
    "a resting row draws no working mark",
  );
});

test("a group's head folds it, its count still standing, and the fold is kept on this Mac", async () => {
  const page = await mountPage();
  const fold = () => {
    const head = [...page.querySelectorAll<HTMLElement>(".tasks-list-group")].find(
      (group) => group.getAttribute("aria-label") === "Todo",
    );
    const button = head?.querySelector<HTMLButtonElement>(".tasks-list-head button");
    assert.ok(button, "Todo's head folds it");
    return button;
  };

  act(() => fold().click());
  assert.deepEqual(groups(page)[2], ["Todo", []]);
  assert.equal(fold().getAttribute("aria-expanded"), "false");
  assert.match(fold().textContent ?? "", /2/);

  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  const again = await mountPage();
  assert.deepEqual(groups(again)[2], ["Todo", []], "the fold is kept");
});

/**
 * The List laid out for a drag: each group 200px tall, one under another
 * from the window's top, 1000px wide, each row 30px tall, 36px apart, from
 * 40px down its group. jsdom lays nothing out and captures no pointer, so
 * this answers the geometry and the capture the browser would.
 */
function layRowsOut(page: HTMLElement): void {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const all = [...document.querySelectorAll(".tasks-list-group")];
    const at = all.indexOf(this);
    if (at >= 0) return new DOMRect(0, at * 200, 1000, 200);
    const group = all.indexOf(this.closest(".tasks-list-group") ?? this);
    if (group < 0) return new DOMRect();
    if (this.matches(".tasks-list-rows")) return new DOMRect(0, group * 200 + 40, 1000, 160);
    if (!this.matches("li[data-task-id]")) return new DOMRect();
    const row = [...(this.parentElement?.children ?? [])].indexOf(this);
    return new DOMRect(0, group * 200 + 40 + row * 36, 1000, 30);
  });
  for (const list of page.querySelectorAll(".tasks-list-rows")) {
    Object.assign(list, { setPointerCapture: () => undefined });
  }
}

/** A pointer event at a point in the window, as the primary button makes one. */
function pointer(type: string, x: number, y: number): PointerEvent {
  return new PointerEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y, pointerId: 1 });
}

/** Presses a task's row, drags it into the group named `onto`, and lets it go at the top of its rows. */
function dragRow(page: HTMLElement, key: string, onto: string): void {
  const press = rowOf(page, key).querySelector("button") ?? assert.fail("the row stands");
  const box = press.closest("li")?.getBoundingClientRect() ?? assert.fail("the row stands");
  const target = [...page.querySelectorAll<HTMLElement>(".tasks-list-group")].find(
    (group) => group.getAttribute("aria-label") === onto,
  );
  const to = target?.getBoundingClientRect() ?? assert.fail(`${onto} stands`);
  const from = { x: 500, y: box.y + 15 };
  act(() => {
    press.dispatchEvent(pointer("pointerdown", from.x, from.y));
    window.dispatchEvent(pointer("pointermove", from.x + 10, from.y));
    window.dispatchEvent(pointer("pointermove", 500, to.y + 20));
    window.dispatchEvent(pointer("pointerup", 500, to.y + 20));
  });
}

test("a Todo row dragged onto In progress's group is sent in progress, opening no task", async () => {
  const page = await mountPage();
  layRowsOut(page);

  dragRow(page, "ACME-39", "In progress");

  assert.deepEqual(sent, [["t-39", { status: TASK_STATUS.IN_PROGRESS }]]);
  assert.deepEqual(marked, []);
  assert.deepEqual(opened, [], "a drag opens no task");
});

test("a row dragged out of Pinned onto Todo is unpinned and sent todo, and one dragged onto Pinned is pinned", async () => {
  const page = await mountPage();
  layRowsOut(page);

  dragRow(page, "ACME-44", "Todo");
  dragRow(page, "ACME-36", "Pinned");
  await act(async () => undefined);

  // Note that the unpin waits on the status being kept, so it lands after the pin sent at once.
  assert.deepEqual(marked, [
    ["t-36", TASK_MARK.PIN],
    ["t-44", TASK_MARK.UNPIN],
  ]);
  assert.deepEqual(sent, [["t-44", { status: TASK_STATUS.TODO }]]);
});

test("a row dragged into a section is kept there, and one dragged out of its section onto a status leaves it", async () => {
  const LAUNCH = "a1b2c3d4-0000-4000-8000-000000000001";
  sections = {
    sections: [{ id: LAUNCH, workspaceId: ACME.id, title: "Launch week", createdAt: 1 }],
    entries: [{ taskId: "t-42", sectionId: LAUNCH, addedAt: 1 }],
    agentEntries: [],
  };
  const page = await mountPage();
  layRowsOut(page);
  assert.deepEqual(groups(page)[1], ["Launch week", ["ACME-42"]]);

  dragRow(page, "ACME-40", "Launch week");
  dragRow(page, "ACME-42", "Backlog");
  await act(async () => undefined);

  assert.deepEqual(
    written.map((writes) =>
      writes.map((write) => [
        write.kind,
        "taskId" in write ? write.taskId : undefined,
        "sectionId" in write ? write.sectionId : undefined,
      ]),
    ),
    [[["place", "t-40", LAUNCH]], [["place", "t-42", null]]],
  );
  assert.deepEqual(sent, [["t-42", { status: TASK_STATUS.BACKLOG }]]);
});

/** A task of `TASKS` assigned to Dean, the reader. */
function deans(key: number): TaskSummary {
  const held = TASKS.find((each) => each.number === key) ?? assert.fail(`no ACME-${key}`);
  return { ...held, assignee: { userId: DEAN, name: "Dean Stratakos" } };
}

/** The properties a row drew before it drew the assignee, every one of them, as an earlier build kept them. */
const BEFORE_ASSIGNEE = [
  "priority",
  "key",
  "status",
  "waiting",
  "repository",
  "creator",
  "agents",
  "updated",
];

test("a row draws its assignee and not its creator at first, and a List display kept before rows offered the assignee draws it, its creator as kept", async () => {
  const cells = (page: HTMLElement) =>
    [...rowOf(page, "ACME-40").querySelectorAll("[data-cell]")].map((cell) =>
      cell.getAttribute("data-cell"),
    );
  const fresh = await mountPage();
  assert.ok(cells(fresh).includes("assignee"));
  assert.ok(!cells(fresh).includes("creator"));

  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  for (const kept of [
    { properties: BEFORE_ASSIGNEE, offered: BEFORE_ASSIGNEE },
    { properties: BEFORE_ASSIGNEE },
  ]) {
    window.localStorage.setItem("luke.tasksListDisplay", JSON.stringify(kept));
    const page = await mountPage();
    assert.ok(cells(page).includes("assignee"), "the assignee is drawn without turning it on");
    assert.ok(cells(page).includes("creator"), "the creator stays on, as kept");
    act(() => {
      for (const root of roots.splice(0)) root.unmount();
    });
  }
});

test("a row's Assignee chip sends the member picked, and No assignee assigns it to no one, opening no task", async () => {
  const page = await mountPage([deans(39), ...TASKS.filter((each) => each.number !== 39)]);

  act(() => rowChip(page, "ACME-40", "Assignee").click());
  choose("Dean Stratakos");
  act(() => rowChip(page, "ACME-39", "Assignee").click());
  choose("No assignee");

  assert.deepEqual(sent, [
    ["t-40", { assigneeId: DEAN }],
    ["t-39", { assigneeId: null }],
  ]);
  assert.deepEqual(opened, [], "a pick opens no task");
});

test("grouped by assignee, the reader's group leads and No assignee's ends, a row there leaves its assignee's cell empty, and a row dragged onto a group is assigned to its person, onto No assignee's to no one", async () => {
  window.localStorage.setItem(
    "luke.tasksListDisplay",
    JSON.stringify({ grouping: "assignee", pinnedFirst: false }),
  );
  const page = await mountPage([deans(39), ...TASKS.filter((each) => each.number !== 39)]);
  layRowsOut(page);

  assert.deepEqual(
    groups(page).map(([name]) => name),
    ["You", "No assignee"],
  );
  const cell = rowOf(page, "ACME-39").querySelector("[data-cell='assignee']");
  assert.ok(cell, "the row keeps its assignee's column");
  assert.equal(
    cell.querySelector("button"),
    null,
    "the group's head says who, so the cell is empty",
  );
  dragRow(page, "ACME-40", "You");
  dragRow(page, "ACME-39", "No assignee");

  assert.deepEqual(sent, [
    ["t-40", { assigneeId: DEAN }],
    ["t-39", { assigneeId: null }],
  ]);
});

test("on a phone grouped by assignee, a row keeps its Assignee chip, which moves it without a drag", async () => {
  window.localStorage.setItem(
    "luke.tasksListDisplay",
    JSON.stringify({ grouping: "assignee", pinnedFirst: false }),
  );
  const page = await mountPage(
    [deans(39), ...TASKS.filter((each) => each.number !== 39)],
    SHELL_ROOM.NARROW,
  );

  // Note that a phone's row draws no key, so the row is found by its task.
  const chip = page.querySelector<HTMLButtonElement>(
    'li[data-task-id="t-39"] button[aria-label^="Assignee:"]',
  );
  act(() => (chip ?? assert.fail("the row keeps its Assignee chip")).click());
  choose("No assignee");

  assert.deepEqual(sent, [["t-39", { assigneeId: null }]]);
});

test("a Board display kept before its cards offered Agents and Needs you draws them, the rest as kept", async () => {
  window.localStorage.setItem("luke.tasksPageView", JSON.stringify("board"));
  window.localStorage.setItem(
    "luke.tasksBoardDisplay",
    JSON.stringify({ properties: ["priority", "status"] }),
  );
  const page = await mountPage();
  const card = page.querySelector<HTMLElement>('li[data-task-id="t-44"]');

  assert.match(card?.textContent ?? "", /2 need you/, "the card says what waits on the reader");
  assert.equal(card?.querySelector("[data-task-key]"), null, "the key stays off, as kept");
});

/** The section writes sent, each as its kind, its task, and its section. */
function writesSent(): unknown[] {
  return written.map((writes) =>
    writes.map((write) => [
      write.kind,
      "taskId" in write ? write.taskId : undefined,
      "sectionId" in write ? write.sectionId : undefined,
    ]),
  );
}

test("a row dragged out of its section onto a status the service refuses stays in its section and pinned", async () => {
  const LAUNCH = "a1b2c3d4-0000-4000-8000-000000000002";
  sections = {
    sections: [{ id: LAUNCH, workspaceId: ACME.id, title: "Launch week", createdAt: 1 }],
    entries: [{ taskId: "t-42", sectionId: LAUNCH, addedAt: 1 }],
    agentEntries: [],
  };
  keeps = false;
  const page = await mountPage();
  layRowsOut(page);

  dragRow(page, "ACME-42", "Backlog");
  dragRow(page, "ACME-44", "Backlog");
  await act(async () => undefined);

  assert.deepEqual(sent, [
    ["t-42", { status: TASK_STATUS.BACKLOG }],
    ["t-44", { status: TASK_STATUS.BACKLOG }],
  ]);
  assert.deepEqual(written, [], "the row keeps its section");
  assert.deepEqual(marked, [], "the row keeps its pin");
  assert.match(document.body.textContent ?? "", /The task could not be changed/);
});

test("a section holding no task stands in the List, empty, and a row dragged into it is kept there", async () => {
  const LATER = "a1b2c3d4-0000-4000-8000-000000000003";
  sections = {
    sections: [{ id: LATER, workspaceId: ACME.id, title: "Later", createdAt: 1 }],
    entries: [],
    agentEntries: [],
  };
  const page = await mountPage();
  layRowsOut(page);
  assert.deepEqual(groups(page)[1], ["Later", []]);
  assert.match(page.textContent ?? "", /Drag tasks here/);

  dragRow(page, "ACME-40", "Later");

  assert.deepEqual(writesSent(), [[["place", "t-40", LATER]]]);
});

test("a view that leaves no task standing says so, though an empty section still stands", async () => {
  sections = {
    sections: [
      {
        id: "a1b2c3d4-0000-4000-8000-000000000004",
        workspaceId: ACME.id,
        title: "Later",
        createdAt: 1,
      },
    ],
    entries: [],
    agentEntries: [],
  };
  window.localStorage.setItem(
    "luke.tasksFilter",
    JSON.stringify({ [ACME.id]: { status: [TASK_STATUS.CANCELED] } }),
  );
  const page = await mountPage();

  assert.deepEqual(groups(page), [["Later", []]]);
  assert.match(page.textContent ?? "", /No tasks match this view/);
});

test("a row leads its repository with its owner's picture, one address for every row of that owner, so the window asks GitHub for it once", async () => {
  const page = await mountPage();
  const pictures = [
    ...page.querySelectorAll<HTMLImageElement>("[data-cell='repository'] img.luke-avatar-picture"),
  ].map((picture) => picture.getAttribute("src"));

  assert.equal(pictures.length, page.querySelectorAll(".tasks-list-row").length);
  assert.deepEqual(new Set(pictures), new Set(["https://github.com/acme.png?size=32"]));
});

test("the Filter's Repository leads each repository with its owner's picture, on the List and the Board alike", async () => {
  const page = await mountPage();
  const offered = () =>
    [...document.querySelectorAll<HTMLElement>('[role="menu"]:not([data-leaving]) .luke-menu-item')]
      .filter((item) => item.querySelector(".luke-menu-item-label")?.textContent === "web")
      .map((item) => item.querySelector("img.luke-avatar-picture")?.getAttribute("src"));

  openOptions(page, "Filter");
  choose("Repository");
  assert.deepEqual(offered(), ["https://github.com/acme.png?size=32"]);
  closeMenus();

  act(() => buttonNamed(page, "Board").click());
  openOptions(page, "Filter");
  choose("Repository");
  assert.deepEqual(offered(), ["https://github.com/acme.png?size=32"]);
});

test("a row hangs no card for its whole task; its pull request's mark hangs that pull request's card", async () => {
  const withPullRequest: TaskSummary = {
    ...task(39, "Rate limit search", TASK_STATUS.TODO, TASK_PRIORITY.HIGH),
    agents: {
      total: 1,
      working: 0,
      agents: [],
      pullRequestTotal: 1,
      pullRequests: [
        {
          number: 4222,
          title: "Rate limit the search endpoint",
          state: "merged",
          checks: "passing",
          additions: 30,
          deletions: 5,
          url: "https://github.com/acme/web/pull/4222",
        },
      ],
    },
  };
  const page = await mountPage([withPullRequest, ...TASKS.slice(2)]);
  const row = rowOf(page, "ACME-39");

  restOn(row.querySelector("[data-card-press]") ?? assert.fail("the row has its press"));
  assert.equal(document.querySelector("[data-task-card]"), null, "the row hangs no task card");

  restOn(
    row.querySelector("[data-cell='agents'] [data-task-work='pull-request']") ??
      assert.fail("the row wears its pull request"),
  );
  const card = document.querySelector(".luke-tooltip-card [data-pull-request-card]");
  assert.equal(
    card?.querySelector(".luke-hover-card-name")?.textContent,
    "Rate limit the search endpoint",
  );
  assert.match(card?.textContent ?? "", /acme\/web#4222 · Merged/u);
});

test("a row's pull request mark and its count are presses: one from a service before it sent its page opens the task, and so does the count", async () => {
  const line = (number: number) => ({
    number,
    title: `Change ${number}`,
    state: "open" as const,
    checks: "passing" as const,
    additions: 1,
    deletions: 1,
  });
  const withPullRequests: TaskSummary = {
    ...task(39, "Rate limit search", TASK_STATUS.TODO, TASK_PRIORITY.HIGH),
    agents: {
      total: 1,
      working: 0,
      agents: [],
      pullRequestTotal: 2,
      pullRequests: [line(4222), line(4223)],
    },
  };
  const page = await mountPage([withPullRequests, ...TASKS.slice(2)]);
  const part = (kind: string) =>
    rowOf(page, "ACME-39").querySelector<HTMLButtonElement>(
      `[data-cell='agents'] button[data-task-work='${kind}']`,
    ) ?? assert.fail(`the row wears its ${kind}`);

  act(() => part("pull-request").click());
  act(() => part("more").click());
  assert.deepEqual(opened, ["t-39", "t-39"]);
});
