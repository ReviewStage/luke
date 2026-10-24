// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CODING_AGENT_STATUS, type TasklessAgent } from "@luke/features/coding-agent-wire";
import {
  TASK_SECTION_ICON_COLOR,
  TASK_SECTION_ICON_KIND,
  TASK_SECTION_WRITE,
  type TaskSections,
  type TaskSectionWrite,
} from "@luke/features/task-section-wire";
import { TASK_STATUS, type TaskSummary } from "@luke/features/task-wire";
import { WORKSPACE_ROLE, type Workspace } from "@luke/features/workspace-wire";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import {
  applySectionWrite,
  memberOf,
  sectionOrder,
  sectionTaskIds,
  workspaceSections,
} from "@luke/ui/task-sections-model";
import { type PinMove, TASK_MARK, type TaskMark } from "@luke/ui/tasks-model";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, onTestFinished, test, vi } from "vitest";
import { appCommandOffered, runAppCommand } from "../app-commands.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { handState } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { sidebarProps } from "../testing/desktop-sidebar.js";
import { playListMotions } from "../testing/pane-motion.js";
import { tasksControl } from "../testing/tasks-control.js";
import { newestToastAction, newestToastSays } from "../testing/toast.js";
import { ToastHost } from "../toast.js";
import { DesktopSidebar } from "./desktop-sidebar.js";

/**
 * sidebar-sections.test.ts -- the account's own sections in the sidebar:
 * each drawn over the tasks kept in it,
 * which Tasks then leaves out, and reached from a task's menu, whose Move
 * to section writes the move and whose section's Delete acts at once with Undo; and
 * the dialog's icon picker, every Lucide glyph in a color and every emoji,
 * found by one search; and a task dragged between Pinned, Tasks, and a
 * section, pinned, unpinned, and moved where it is let go; and, under a finger, which drags nothing, a pin, a
 * section, and a section's task moved a place by its menu, which a long
 * press, a right-click, and the keyboard's ⇧⌘↑ and ⇧⌘↓ all reach, the row
 * kept focused. Synthetic throughout.
 */

const WORKSPACE: Workspace = {
  id: "workspace-personal",
  name: "Ada Lovelace",
  role: WORKSPACE_ROLE.OWNER,
  github: null,
};

const LAUNCH = "0a1b2c3d-0000-4000-8000-000000000001";

const roots: Root[] = [];

beforeEach(() => {
  window.localStorage.clear();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
  handState({});
});

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function task(id: string, name: string): TaskSummary {
  return {
    id,
    workspaceId: WORKSPACE.id,
    name,
    createdAt: 1,
    updatedAt: 2,
    repository: "acme/relay",
  };
}

const INVITES = task("0a1b2c3d-0000-4000-8000-100000000001", "Invite expiry");
const RETRIES = task("0a1b2c3d-0000-4000-8000-100000000002", "Retry audit");

/** Launch, with its rocket, holding Invite expiry. */
const SECTIONS: TaskSections = {
  sections: [
    {
      id: LAUNCH,
      workspaceId: WORKSPACE.id,
      title: "Launch",
      icon: { kind: TASK_SECTION_ICON_KIND.EMOJI, emoji: "🚀" },
      createdAt: 1,
    },
  ],
  entries: [{ taskId: INVITES.id, sectionId: LAUNCH, addedAt: 2 }],
  agentEntries: [],
};

const SOMEDAY = "0a1b2c3d-0000-4000-8000-000000000002";

/** Launch, and Someday, made without an icon, holding Retry audit. */
const ICONLESS: TaskSections = {
  sections: [
    ...SECTIONS.sections,
    { id: SOMEDAY, workspaceId: WORKSPACE.id, title: "Someday", createdAt: 2 },
  ],
  entries: [...SECTIONS.entries, { taskId: RETRIES.id, sectionId: SOMEDAY, addedAt: 3 }],
  agentEntries: [],
};

/** Lets the window's document land, as main hands it, and what it moves settle. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

const STARS = "0a1b2c3d-0000-4000-8000-000000000003";
const LOST = "0a1b2c3d-0000-4000-8000-000000000004";

/** Launch, Stars in a teal telescope, a glyph only Lucide whole draws, and Lost, in a glyph no Lucide knows. */
const GLYPHS: TaskSections = {
  sections: [
    ...SECTIONS.sections,
    {
      id: STARS,
      workspaceId: WORKSPACE.id,
      title: "Stars",
      icon: {
        kind: TASK_SECTION_ICON_KIND.GLYPH,
        glyph: "telescope",
        color: TASK_SECTION_ICON_COLOR.TEAL,
      },
      createdAt: 2,
    },
    {
      id: LOST,
      workspaceId: WORKSPACE.id,
      title: "Lost",
      icon: { kind: TASK_SECTION_ICON_KIND.GLYPH, glyph: "no-such-glyph" },
      createdAt: 3,
    },
  ],
  entries: SECTIONS.entries,
  agentEntries: [],
};

/** Lets what the sidebar and the picker load on demand land: Lucide whole, and the emoji. */
async function settleLoaded(): Promise<void> {
  await act(async () => {
    await Promise.all([import("lucide-react"), import("unicode-emoji-json/data-by-group.json")]);
  });
  await settle();
}

/** Types `words` into a field, as a person would. */
function typeInto(field: HTMLInputElement, words: string): void {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setValue?.call(field, words);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** The dialog's field labelled `label`, failing where none is drawn. */
function dialogField(label: string): HTMLInputElement {
  const named = [...document.querySelectorAll<HTMLLabelElement>("label")].find(
    (candidate) => candidate.textContent === label,
  );
  const found =
    (named === undefined ? null : document.getElementById(named.htmlFor)) ??
    document.querySelector(`input[aria-label="${label}"]`);
  return found instanceof HTMLInputElement ? found : assert.fail(`no ${label} field`);
}

/** The sidebar listing both tasks over `sections`, each write it asks heard by `writes`, and anything else `rest` says of the tasks. */
function sidebarOver(
  sections: TaskSections,
  writes: TaskSectionWrite[],
  rest: Partial<TasksControl> = {},
) {
  const tasks = tasksControl({
    tasks: [INVITES, RETRIES],
    workspaces: [WORKSPACE],
    workspace: WORKSPACE,
    taskSections: sections,
    onWriteSections: (asked) => writes.push(...asked),
    ...rest,
  });
  return createElement(DesktopSidebar, sidebarProps(tasks));
}

/** The sidebar over `sections`, Launch unless said, and a way to draw it again over other sections, as a refresh does. */
async function mountSidebarRedrawn(
  writes: TaskSectionWrite[],
  sections = SECTIONS,
  rest: Partial<TasksControl> = {},
) {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  const registry = AtomRegistry.make();
  const draw = async (sections: TaskSections) => {
    act(() =>
      root.render(
        onRegistry(
          registry,
          createElement(
            Fragment,
            null,
            sidebarOver(sections, writes, rest),
            createElement(ToastHost),
          ),
        ),
      ),
    );
    await settle();
  };
  await draw(sections);
  return { container, draw };
}

/** The sidebar over `sections`, Launch unless said, each write it asks heard by `writes`. */
async function mountSidebar(
  writes: TaskSectionWrite[],
  sections = SECTIONS,
  rest: Partial<TasksControl> = {},
): Promise<HTMLElement> {
  return (await mountSidebarRedrawn(writes, sections, rest)).container;
}

/** The header of the section titled `title`, failing where none is drawn. */
/** The first of a button's words a reader hears: a row's or a fold's name, before its count and its chord. */
function heardName(button: Element): string {
  const heard = [...button.children].find((part) => part.getAttribute("aria-hidden") !== "true");
  return heard?.textContent ?? "";
}

function sectionHeader(sidebar: HTMLElement, title: string): HTMLElement {
  const fold = [
    ...sidebar.querySelectorAll('nav[aria-label="Sections"] button[aria-expanded]'),
  ].find((each) => heardName(each) === title);
  const found = fold?.closest<HTMLElement>(".luke-group-header-head");
  return found ?? assert.fail(`no ${title} section`);
}

/** Opens the task named `name`'s menu, then its Move to section. */
function openMoveToSection(sidebar: HTMLElement, name: string): void {
  const row = [...sidebar.querySelectorAll<HTMLElement>(".sidebar-tasks > li > button")].find(
    (each) => each.textContent?.includes(name),
  );
  assert.ok(row);
  act(() => {
    row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 }));
  });
  act(() => item("Move to section").click());
}

/** The dialog's button whose words are `label`, or else whose label is, failing where none is drawn; Lucide's Save glyph is no Save button. */
function dialogButton(label: string): HTMLButtonElement {
  const buttons = [...document.querySelectorAll<HTMLButtonElement>("button")];
  const found =
    buttons.find((button) => button.textContent === label) ??
    buttons.find((button) => button.getAttribute("aria-label") === label);
  return found ?? assert.fail(`no ${label} button`);
}

/** The names of the tasks drawn under the region labelled `label`. */
function namesIn(sidebar: HTMLElement, label: string): string[] {
  const region = sidebar.querySelector(`nav[aria-label="${label}"]`);
  return [...(region?.querySelectorAll(".luke-list-row-title") ?? [])].map(
    (name) => name.firstChild?.textContent ?? "",
  );
}

/** The menu item named `label`, failing where none is drawn. */
function item(label: string): HTMLElement {
  const name = [...document.querySelectorAll(".luke-menu-item-label")].find(
    (each) => each.textContent === label,
  );
  const found = name?.closest<HTMLElement>('[role="menuitem"], [role="menuitemcheckbox"]');
  return found ?? assert.fail(`no ${label} in the menu`);
}

test("a section stands over its tasks, which Tasks leaves out", async () => {
  const sidebar = await mountSidebar([]);

  assert.deepEqual(namesIn(sidebar, "Sections"), ["Invite expiry"]);
  assert.deepEqual(namesIn(sidebar, "Tasks"), ["Retry audit"]);
  const header = sidebar.querySelector('nav[aria-label="Sections"] button[aria-expanded]');
  assert.equal(header === null ? undefined : heardName(header), "Launch");
});

test("the column's task rows, a section's and Tasks', are one Tab stop that ↓ walks from one group into the next, wrapping", async () => {
  const sidebar = await mountSidebar([]);
  const row = (name: string) => {
    const found = [
      ...sidebar.querySelectorAll<HTMLButtonElement>(".sidebar-tasks > li > button"),
    ].find((each) => each.querySelector(".luke-list-row-title")?.firstChild?.textContent === name);
    return found ?? assert.fail(`no row for ${name}`);
  };
  const stops = () =>
    [...sidebar.querySelectorAll<HTMLButtonElement>(".sidebar-tasks > li > button")].filter(
      (each) => each.tabIndex === 0,
    );
  const down = () =>
    act(() => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
      );
    });

  assert.equal(stops().length, 1, "Tab lands on the column's rows once");
  act(() => row("Invite expiry").focus());
  down();
  assert.equal(document.activeElement, row("Retry audit"), "↓ goes from Launch into Tasks");
  assert.deepEqual(stops(), [row("Retry audit")]);
  down();
  assert.equal(document.activeElement, row("Invite expiry"), "the walk wraps to the first row");
});

test("a section folds on its title, aria-expanded following, counts its tasks folded, and keeps its ⋯ outside the fold", async () => {
  const sidebar = await mountSidebar([]);
  const launch = () =>
    [
      ...sidebar.querySelectorAll<HTMLButtonElement>(
        'nav[aria-label="Sections"] button[aria-expanded]',
      ),
    ].find((each) => heardName(each) === "Launch") ?? assert.fail("no Launch fold");
  assert.equal(launch().getAttribute("aria-expanded"), "true");
  assert.equal(launch().textContent, "🚀Launch");
  assert.deepEqual(namesIn(sidebar, "Sections"), ["Invite expiry"]);

  act(() => launch().click());
  assert.equal(launch().getAttribute("aria-expanded"), "false");
  assert.equal(launch().textContent, "🚀Launch1 task");
  assert.deepEqual(namesIn(sidebar, "Sections"), []);

  const actions = sidebar.querySelector<HTMLButtonElement>('[aria-label="Launch actions"]');
  act(() => actions?.click());
  assert.equal(launch().getAttribute("aria-expanded"), "false", "the ⋯ folds nothing");

  act(() => launch().click());
  assert.equal(launch().getAttribute("aria-expanded"), "true");
  assert.deepEqual(namesIn(sidebar, "Sections"), ["Invite expiry"]);
});

test("a filter by person leaves out a section's task it would leave out of the list", async () => {
  const shared = { ...WORKSPACE, memberCount: 2 };
  window.localStorage.setItem(
    "luke.sidebarTaskViews",
    JSON.stringify({
      [WORKSPACE.id]: { grouping: "repository", order: "updated", assignedTo: "user-ada" },
    }),
  );
  const sidebar = await mountSidebar([], SECTIONS, {
    workspace: shared,
    workspaces: [shared],
    me: "user-ada",
    tasks: [
      { ...INVITES, assignee: { userId: "user-grace", name: "Grace Hopper" } },
      { ...RETRIES, assignee: { userId: "user-ada", name: "Ada Lovelace" } },
    ],
  });

  assert.deepEqual(namesIn(sidebar, "Sections"), []);
  assert.deepEqual(namesIn(sidebar, "Tasks"), ["Retry audit"]);
});

test("the status filter leaves a section's backlog task out as it does the list's, and counts it among those it hides", async () => {
  const sidebar = await mountSidebar([], SECTIONS, {
    tasks: [
      { ...INVITES, status: TASK_STATUS.BACKLOG },
      { ...RETRIES, status: TASK_STATUS.TODO },
    ],
  });

  assert.deepEqual(namesIn(sidebar, "Sections"), []);
  assert.deepEqual(namesIn(sidebar, "Tasks"), ["Retry audit"]);
  assert.equal(
    sidebar.querySelector(".sidebar-hidden-statuses button")?.textContent,
    "1 more in Backlog",
  );
});

test("a task's Move to section puts it on top of the section chosen", async () => {
  const writes: TaskSectionWrite[] = [];
  const sidebar = await mountSidebar(writes);
  const row = [...sidebar.querySelectorAll<HTMLElement>(".sidebar-tasks > li > button")].find(
    (each) => each.textContent?.includes("Retry audit"),
  );
  assert.ok(row);

  act(() => {
    row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 }));
  });
  act(() => item("Move to section").click());
  act(() => item("Launch").click());

  assert.deepEqual(writes, [
    { kind: TASK_SECTION_WRITE.PLACE, taskId: RETRIES.id, sectionId: LAUNCH },
  ]);
});

/** Launch holding both tasks, Invite expiry on top, and Someday holding none. */
const BOTH_IN_LAUNCH: TaskSections = {
  sections: ICONLESS.sections,
  entries: [
    { taskId: INVITES.id, sectionId: LAUNCH, addedAt: 3 },
    { taskId: RETRIES.id, sectionId: LAUNCH, addedAt: 2 },
  ],
  agentEntries: [],
};

/** Opens the section titled `title`'s menu from its ⋯. */
function openSectionMenu(sidebar: HTMLElement, title: string): void {
  const actions = sidebar.querySelector<HTMLButtonElement>(`[aria-label="${title} actions"]`);
  assert.ok(actions);
  act(() => actions.click());
}

/** The words of every item the open menus draw, in order. */
function menuLabels(): string[] {
  return [...document.querySelectorAll(".luke-menu-item-label")].map(
    (each) => each.textContent ?? "",
  );
}

/** Opens the menu of the task row named `name` with a right-click. */
function openRowMenu(sidebar: HTMLElement, name: string): void {
  const row = [...sidebar.querySelectorAll<HTMLElement>(".sidebar-tasks > li > button")].find(
    (each) => each.textContent?.includes(name),
  );
  assert.ok(row);
  act(() => {
    row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 }));
  });
}

/** The sections' titles, in the order the sidebar draws them. */
function sectionTitles(sidebar: HTMLElement): string[] {
  const heads = sidebar.querySelectorAll('nav[aria-label="Sections"] .luke-group-header-head');
  return [...heads].map((head) => heardName(head.querySelector("button[aria-expanded]") ?? head));
}

/** `state` once the service has taken every write of `writes`, in order. */
function applied(state: TaskSections, writes: readonly TaskSectionWrite[]): TaskSections {
  return writes.reduce((was, write) => applySectionWrite(was, write, 30), state);
}

test("deleting a section removes it at once with no dialog, and Undo brings it back where it stood with its tasks", async () => {
  const writes: TaskSectionWrite[] = [];
  const { container: sidebar, draw } = await mountSidebarRedrawn(writes, BOTH_IN_LAUNCH);
  const stood = sectionTitles(sidebar);
  openSectionMenu(sidebar, "Launch");

  act(() => item("Delete section").click());
  const deleted = applied(BOTH_IN_LAUNCH, writes.splice(0));
  await draw(deleted);

  assert.equal(document.querySelector('[role="alertdialog"]'), null, "nothing is asked");
  assert.deepEqual(sectionTitles(sidebar), ["Someday"]);
  assert.deepEqual(namesIn(sidebar, "Tasks"), ["Invite expiry", "Retry audit"]);
  assert.match(newestToastSays() ?? "", /Section deleted/u);

  act(() => newestToastAction()?.click());
  await draw(applied(deleted, writes));

  assert.deepEqual(stood, ["Someday", "Launch"]);
  assert.deepEqual(sectionTitles(sidebar), stood);
  assert.deepEqual(namesIn(sidebar, "Sections"), ["Invite expiry", "Retry audit"]);
  assert.deepEqual(namesIn(sidebar, "Tasks"), []);
  const icon = sectionHeader(sidebar, "Launch").querySelector(".luke-group-header-icon");
  assert.equal(icon?.textContent, "🚀");
});

test("a deleted section slides out where it stood, out of reach, and leaves once its exit has played; the one that stays is not held", async () => {
  const motions = playListMotions();
  onTestFinished(motions.remove);
  const writes: TaskSectionWrite[] = [];
  const { container: sidebar, draw } = await mountSidebarRedrawn(writes, ICONLESS);
  openSectionMenu(sidebar, "Launch");

  act(() => item("Delete section").click());
  await draw(applied(ICONLESS, writes.splice(0)));

  const leaving = sidebar.querySelector<HTMLElement>("li[data-leaving]");
  assert.match(leaving?.textContent ?? "", /Launch/u, "it is drawn on");
  assert.equal(leaving?.hasAttribute("inert"), true, "out of reach while it goes");
  const out = motions.played.find((each) => each.element === leaving);
  assert.equal(out?.keyframes.at(-1)?.opacity, 0, "it fades out as it slides");

  act(() => out?.finish());
  assert.equal(sidebar.querySelector("[data-leaving]"), null);
  assert.deepEqual(sectionTitles(sidebar), ["Someday"]);
});

test("the last section deleted slides out too, and takes its group with it once its exit has played", async () => {
  const motions = playListMotions();
  onTestFinished(motions.remove);
  const writes: TaskSectionWrite[] = [];
  const { container: sidebar, draw } = await mountSidebarRedrawn(writes);
  openSectionMenu(sidebar, "Launch");

  act(() => item("Delete section").click());
  await draw(applied(SECTIONS, writes.splice(0)));

  const leaving = sidebar.querySelector<HTMLElement>('nav[aria-label="Sections"] li[data-leaving]');
  assert.match(leaving?.textContent ?? "", /Launch/u, "it is drawn on");

  act(() => motions.played.find((each) => each.element === leaving)?.finish());
  assert.equal(sidebar.querySelector('nav[aria-label="Sections"]'), null);
});

test("deleting the last section hands focus to the first, rather than letting it fall to the window", async () => {
  const writes: TaskSectionWrite[] = [];
  const { container: sidebar, draw } = await mountSidebarRedrawn(writes, BOTH_IN_LAUNCH);
  openSectionMenu(sidebar, "Launch");

  act(() => item("Delete section").click());
  await draw(applied(BOTH_IN_LAUNCH, writes.splice(0)));

  assert.deepEqual(sectionTitles(sidebar), ["Someday"]);
  assert.ok(sectionHeader(sidebar, "Someday").contains(document.activeElement));
});

test("a section holding tasks offers what acts on all of them between Edit and Delete, after its move", async () => {
  const sidebar = await mountSidebar([], ICONLESS);

  openSectionMenu(sidebar, "Launch");

  assert.deepEqual(menuLabels(), [
    "Move up",
    "Edit section",
    "Move all to section",
    "Remove all from section",
    "Mark all done",
    "Delete section",
  ]);
});

test("a section holding no task offers only Edit and Delete, after its move", async () => {
  const sidebar = await mountSidebar([], {
    sections: ICONLESS.sections,
    entries: ICONLESS.entries.filter((entry) => entry.sectionId !== SOMEDAY),
    agentEntries: [],
  });

  openSectionMenu(sidebar, "Someday");

  assert.deepEqual(menuLabels(), ["Move down", "Edit section", "Delete section"]);
});

test("a section's Move all to section puts every task in it on top of the section chosen, in its order", async () => {
  const writes: TaskSectionWrite[] = [];
  const sidebar = await mountSidebar(writes, BOTH_IN_LAUNCH);

  openSectionMenu(sidebar, "Launch");
  act(() => item("Move all to section").click());
  const offered = menuLabels().slice(menuLabels().indexOf("Delete section") + 1);
  act(() => item("Someday").click());
  const moved = writes.reduce((held, write) => applySectionWrite(held, write, 10), BOTH_IN_LAUNCH);

  assert.deepEqual(offered, ["Someday", "New section…"]);
  assert.deepEqual(sectionTaskIds(moved, SOMEDAY), [INVITES.id, RETRIES.id]);
  assert.deepEqual(sectionTaskIds(moved, LAUNCH), []);
});

test("a section's Remove all from section takes every task in it out of every section", async () => {
  const writes: TaskSectionWrite[] = [];
  const sidebar = await mountSidebar(writes, BOTH_IN_LAUNCH);

  openSectionMenu(sidebar, "Launch");
  act(() => item("Remove all from section").click());

  assert.deepEqual(writes, [
    { kind: TASK_SECTION_WRITE.PLACE, taskId: INVITES.id, sectionId: null },
    { kind: TASK_SECTION_WRITE.PLACE, taskId: RETRIES.id, sectionId: null },
  ]);
});

test("a section's Mark all done marks every task in it done at once, asking nothing even where a task has agents", async () => {
  const settled: [string[], string][] = [];
  const working: TaskSummary = {
    ...RETRIES,
    agents: { total: 1, working: 1, agents: [], pullRequestTotal: 0, pullRequests: [] },
  };
  const sidebar = await mountSidebar([], BOTH_IN_LAUNCH, {
    tasks: [INVITES, working],
    onSettleTasks: (taskIds, status) => settled.push([[...taskIds], status]),
  });

  openSectionMenu(sidebar, "Launch");
  act(() => item("Mark all done").click());

  assert.equal(document.querySelector('[role="alertdialog"]'), null);
  assert.deepEqual(settled, [[[INVITES.id, RETRIES.id], TASK_STATUS.DONE]]);
});

test("a section's Mark all as read stands while a task in it is unread, and marks every one read", async () => {
  const sidebar = await mountSidebar([], BOTH_IN_LAUNCH);

  for (const name of ["Invite expiry", "Retry audit"]) {
    openRowMenu(sidebar, name);
    act(() => item("Mark as unread").click());
  }
  openSectionMenu(sidebar, "Launch");
  act(() => item("Mark all as read").click());
  const marks = ["Invite expiry", "Retry audit"].map((name) => {
    openRowMenu(sidebar, name);
    const offered = menuLabels().filter((label) => label.startsWith("Mark as"));
    act(() => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    return offered;
  });
  openSectionMenu(sidebar, "Launch");

  assert.deepEqual(marks, [["Mark as unread"], ["Mark as unread"]]);
  assert.ok(!menuLabels().includes("Mark all as read"));
});

test("a section without an icon draws its title behind the fold's chevron alone, and one with an icon behind its icon", async () => {
  const sidebar = await mountSidebar([], ICONLESS);

  const toggle = sectionHeader(sidebar, "Someday").querySelector("button[aria-expanded]");
  assert.ok(toggle?.querySelector(".luke-group-header-icon") === null, "no glyph is drawn");
  assert.ok(toggle?.querySelector(".luke-group-header-chevron"), "the chevron stands at rest");
  const launch = sectionHeader(sidebar, "Launch").querySelector(".luke-group-header-icon");
  assert.equal(launch?.textContent, "🚀");
});

test("Move to section names a section without an icon with no glyph beside it", async () => {
  const sidebar = await mountSidebar([], ICONLESS);

  openMoveToSection(sidebar, "Invite expiry");

  assert.equal(item("Someday").querySelector(".luke-menu-item-glyph")?.childElementCount, 0);
  assert.equal(item("Launch").querySelector(".luke-menu-item-glyph")?.textContent, "🚀");
});

test("a new section starts with no icon and is made without one", async () => {
  const writes: TaskSectionWrite[] = [];
  const sidebar = await mountSidebar(writes);

  openMoveToSection(sidebar, "Retry audit");
  act(() => item("New section…").click());
  assert.equal(dialogButton("No icon").getAttribute("aria-pressed"), "true");
  const title = dialogField("Section title");
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setValue?.call(title, "Someday");
    title.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => dialogButton("Create section").click());

  const made = writes[0];
  assert.equal(made?.kind, TASK_SECTION_WRITE.CREATE);
  assert.equal(made.title, "Someday");
  assert.equal("icon" in made, false);
});

test("New section waits on a title, and Enter in it makes the section", async () => {
  const writes: TaskSectionWrite[] = [];
  const sidebar = await mountSidebar(writes);

  openMoveToSection(sidebar, "Retry audit");
  act(() => item("New section…").click());
  assert.equal(dialogButton("Create section").disabled, true, "a blank title is not offered");
  const title = dialogField("Section title");
  assert.ok(title.closest('[role="dialog"]'), "a form is a dialog, not an alert");
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setValue?.call(title, "S");
    title.dispatchEvent(new Event("input", { bubbles: true }));
  });
  assert.equal(dialogButton("Create section").disabled, false);
  await act(async () => {
    title.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });

  assert.equal(writes[0]?.kind, TASK_SECTION_WRITE.CREATE);
  assert.equal(writes[0]?.kind === TASK_SECTION_WRITE.CREATE && writes[0].title, "S");
});

test("New section's field is labelled, and Enter on a blank title marks it invalid with the reason on it", async () => {
  const writes: TaskSectionWrite[] = [];
  const sidebar = await mountSidebar(writes);

  openMoveToSection(sidebar, "Retry audit");
  act(() => item("New section…").click());
  const title = dialogField("Section title");
  assert.equal(title.getAttribute("aria-label"), null, "the visible label names the field");
  assert.notEqual(title.placeholder, "Section title", "the placeholder is not the label again");
  assert.equal(title.getAttribute("aria-invalid"), null);

  await act(async () => {
    title.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  const error = document.querySelector('[role="dialog"] [data-slot="field-error"]');
  assert.equal(title.getAttribute("aria-invalid"), "true");
  assert.equal(error?.textContent, "Name the section.");
  assert.ok(
    title
      .getAttribute("aria-describedby")
      ?.split(" ")
      .includes(error?.id ?? "missing"),
  );
  assert.deepEqual(writes, [], "no section is made from a blank title");
});

test("choosing No icon and saving clears a section's icon", async () => {
  const writes: TaskSectionWrite[] = [];
  const sidebar = await mountSidebar(writes);
  const actions = sidebar.querySelector<HTMLButtonElement>('[aria-label="Launch actions"]');
  assert.ok(actions);

  act(() => actions.click());
  act(() => item("Edit section").click());
  await settleLoaded();
  assert.equal(dialogButton("🚀").getAttribute("aria-pressed"), "true");
  act(() => dialogButton("No icon").click());
  await act(async () => dialogButton("Save").click());

  assert.deepEqual(writes, [
    { kind: TASK_SECTION_WRITE.EDIT, id: LAUNCH, title: "Launch", icon: null },
  ]);
});

/** Each row's height as laid out here, in CSS pixels. */
const ROW_HEIGHT = 30;

/** What a drag in the sidebar asked: each pin or unpin, each pin's new place, and each write to the sections. */
interface Asked {
  marks: [string, TaskMark][];
  moves: PinMove[];
  writes: TaskSectionWrite[];
}

/**
 * Lays the sidebar out down one column, as jsdom does not: each row, and
 * each empty section's word, a row's height below the one before, and
 * everything holding some of them over exactly those, so each drop zone
 * stands over its own rows and no other's.
 */
function layOutRows(): void {
  const slots = () => [...document.querySelectorAll(".sidebar-tasks > li, .sidebar-section-slot")];
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const all = slots();
    const own = all.indexOf(this);
    const held = own >= 0 ? [own] : all.flatMap((slot, at) => (this.contains(slot) ? [at] : []));
    const first = held[0];
    const last = held.at(-1);
    if (first === undefined || last === undefined) return DOMRect.fromRect();
    return DOMRect.fromRect({
      y: first * ROW_HEIGHT,
      width: 200,
      height: (last - first + 1) * ROW_HEIGHT,
    });
  });
  // jsdom captures no pointer; a drag asks its list to, as the window's would.
  for (const list of document.querySelectorAll(".sidebar-tasks")) {
    Object.assign(list, { setPointerCapture: () => undefined });
  }
}

/** The sidebar listing `plans` over `sections`, laid out down one column, what a drag asks heard by `asked`. */
async function mountDraggable(
  summaries: readonly TaskSummary[],
  sections: TaskSections,
  asked: Asked,
  rest: Partial<TasksControl> = {},
): Promise<HTMLElement> {
  const tasks = tasksControl({
    tasks: [...summaries],
    workspaces: [WORKSPACE],
    workspace: WORKSPACE,
    taskSections: sections,
    onWriteSections: (writes) => asked.writes.push(...writes),
    onMarkTask: (taskId, mark) => asked.marks.push([taskId, mark]),
    onMovePins: (moves) => asked.moves.push(...moves),
    ...rest,
  });
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      onRegistry(AtomRegistry.make(), createElement(DesktopSidebar, sidebarProps(tasks))),
    ),
  );
  await settle();
  layOutRows();
  return container;
}

const pointer = (type: string, y: number) =>
  new PointerEvent(type, { bubbles: true, button: 0, clientY: y, pointerId: 1 });

/** Drags the row named `name` from its middle to `y` down the column and lets it go there. */
function drag(sidebar: HTMLElement, name: string, y: number): void {
  // Note that a row's name is its title's first words, before what only a screen reader hears of it.
  const label = [...sidebar.querySelectorAll<HTMLElement>(".luke-list-row-title")].find(
    (each) => each.firstChild?.textContent === name,
  );
  const row = label?.closest("li") ?? assert.fail(`no ${name} in the sidebar`);
  const top = row.getBoundingClientRect().top + ROW_HEIGHT / 2;
  act(() => {
    label?.dispatchEvent(pointer("pointerdown", top));
    window.dispatchEvent(pointer("pointermove", top + (y > top ? 10 : -10)));
    window.dispatchEvent(pointer("pointermove", y));
    window.dispatchEvent(pointer("pointerup", y));
  });
}

/** A moment after every stamp the fixtures carry, at which a drag's writes are taken. */
const AFTER_FIXTURES = 10;

const noneAsked = (): Asked => ({ marks: [], moves: [], writes: [] });

/** A task pinned at the first place a drag gives. */
const PINNED = {
  ...task("0a1b2c3d-0000-4000-8000-100000000003", "Pin audit"),
  pinnedAt: 5,
  pinPosition: "a0",
};

test("a task dragged from Tasks into Pinned is pinned below the pin it was let go under", async () => {
  const asked = noneAsked();
  // Down the column: Pin audit under Pinned, Invite expiry under Launch, Retry audit under Tasks.
  const sidebar = await mountDraggable([PINNED, INVITES, RETRIES], SECTIONS, asked);

  drag(sidebar, "Retry audit", ROW_HEIGHT - 4);

  assert.deepEqual(asked.marks, [[RETRIES.id, TASK_MARK.PIN]]);
  assert.deepEqual(
    asked.moves.map((move) => move.id),
    [RETRIES.id],
  );
  assert.ok((asked.moves[0]?.position ?? "") > PINNED.pinPosition, "it sorts after Pin audit");
  assert.deepEqual(asked.writes, []);
});

test("a task dragged from a section onto the top of Pinned leaves the section and is pinned on top", async () => {
  const asked = noneAsked();
  const sidebar = await mountDraggable([PINNED, INVITES, RETRIES], SECTIONS, asked);

  drag(sidebar, "Invite expiry", 4);

  assert.deepEqual(asked.marks, [[INVITES.id, TASK_MARK.PIN]]);
  assert.deepEqual(
    asked.moves.map((move) => move.id),
    [INVITES.id],
  );
  assert.ok((asked.moves[0]?.position ?? "~") < PINNED.pinPosition, "it sorts before Pin audit");
  assert.deepEqual(asked.writes, [
    { kind: TASK_SECTION_WRITE.PLACE, taskId: INVITES.id, sectionId: null },
  ]);
});

test("a pinned task dragged onto Tasks is unpinned and leaves the section it was kept in", async () => {
  const asked = noneAsked();
  const kept: TaskSections = {
    ...SECTIONS,
    entries: [...SECTIONS.entries, { taskId: PINNED.id, sectionId: LAUNCH, addedAt: 3 }],
  };
  const sidebar = await mountDraggable([PINNED, INVITES, RETRIES], kept, asked);

  drag(sidebar, "Pin audit", 3 * ROW_HEIGHT - 4);

  assert.deepEqual(asked.marks, [[PINNED.id, TASK_MARK.UNPIN]]);
  assert.deepEqual(asked.writes, [
    { kind: TASK_SECTION_WRITE.PLACE, taskId: PINNED.id, sectionId: null },
  ]);
});

test("a pinned task dragged into a section is unpinned and lands where it was let go", async () => {
  const asked = noneAsked();
  const sidebar = await mountDraggable([PINNED, INVITES, RETRIES], SECTIONS, asked);

  drag(sidebar, "Pin audit", 2 * ROW_HEIGHT - 4);

  assert.deepEqual(asked.marks, [[PINNED.id, TASK_MARK.UNPIN]]);
  const after = asked.writes.reduce(
    (state, write) => applySectionWrite(state, write, AFTER_FIXTURES),
    SECTIONS,
  );
  assert.deepEqual(sectionTaskIds(after, LAUNCH), [INVITES.id, PINNED.id]);
});

test("Pinned stands while nothing is pinned and takes the first pin", async () => {
  const asked = noneAsked();
  const sidebar = await mountDraggable([INVITES, RETRIES], SECTIONS, asked);
  assert.ok(sidebar.querySelector('nav[aria-label="Pinned"] .sidebar-section-slot'));

  drag(sidebar, "Retry audit", 4);

  assert.deepEqual(asked.marks, [[RETRIES.id, TASK_MARK.PIN]]);
});

test("a pin dragged below the next one reorders the pins", async () => {
  const asked = noneAsked();
  const second = {
    ...task("0a1b2c3d-0000-4000-8000-100000000004", "Pin review"),
    pinnedAt: 4,
    pinPosition: "a1",
  };
  // Down the column: Pin audit and Pin review under Pinned, then the section and Tasks.
  const sidebar = await mountDraggable([PINNED, second, INVITES, RETRIES], SECTIONS, asked);

  drag(sidebar, "Pin audit", 2 * ROW_HEIGHT - 4);

  assert.deepEqual(asked.marks, []);
  assert.deepEqual(
    asked.moves.map((move) => move.id),
    [PINNED.id],
  );
  assert.ok((asked.moves[0]?.position ?? "") > second.pinPosition, "it sorts after Pin review");
});

test("a section's glyph beyond the suggested ones is drawn in its color, and one no Lucide knows draws none", async () => {
  const sidebar = await mountSidebar([], GLYPHS);
  await settleLoaded();

  // Note that each check reads words off the nodes, since a failed check printing a node prints the whole document.
  const glyphOf = (title: string) =>
    sectionHeader(sidebar, title).querySelector(
      'button[aria-expanded] > [aria-hidden="true"] > :first-child',
    )?.firstElementChild;
  assert.equal(glyphOf("Stars")?.tagName.toLowerCase(), "svg");
  assert.equal(glyphOf("Stars")?.getAttribute("data-icon-color"), TASK_SECTION_ICON_COLOR.TEAL);
  assert.equal(glyphOf("Lost")?.getAttribute("class"), "section-glyph-blank");
  assert.equal(glyphOf("Lost")?.childElementCount, 0);
  openMoveToSection(sidebar, "Invite expiry");
  assert.equal(
    item("Stars").querySelector("svg")?.getAttribute("data-icon-color"),
    TASK_SECTION_ICON_COLOR.TEAL,
  );
});

test("an icon found by searching, in a color chosen, is the new section's", async () => {
  const writes: TaskSectionWrite[] = [];
  const sidebar = await mountSidebar(writes);

  openMoveToSection(sidebar, "Retry audit");
  act(() => item("New section…").click());
  typeInto(dialogField("Section title"), "Stars");
  await settleLoaded();
  act(() => dialogButton("Teal").click());
  typeInto(dialogField("Search icons"), "telescope");
  act(() => dialogButton("Telescope").click());
  await act(async () => dialogButton("Create section").click());

  const made = writes[0];
  assert.equal(made?.kind, TASK_SECTION_WRITE.CREATE);
  assert.deepEqual(made.icon, {
    kind: TASK_SECTION_ICON_KIND.GLYPH,
    glyph: "telescope",
    color: TASK_SECTION_ICON_COLOR.TEAL,
  });
});

test("a color chosen recolors the glyph a section wears", async () => {
  const writes: TaskSectionWrite[] = [];
  const sidebar = await mountSidebar(writes, GLYPHS);
  const actions = sidebar.querySelector<HTMLButtonElement>('[aria-label="Stars actions"]');
  assert.ok(actions);

  act(() => actions.click());
  act(() => item("Edit section").click());
  await settleLoaded();
  assert.equal(dialogButton("Telescope").getAttribute("aria-pressed"), "true");
  act(() => dialogButton("No color").click());
  await act(async () => dialogButton("Save").click());

  assert.deepEqual(writes, [
    {
      kind: TASK_SECTION_WRITE.EDIT,
      id: STARS,
      title: "Stars",
      icon: { kind: TASK_SECTION_ICON_KIND.GLYPH, glyph: "telescope" },
    },
  ]);
});

test("Enter in the Emoji tab's search chooses the first emoji it found", async () => {
  const writes: TaskSectionWrite[] = [];
  const sidebar = await mountSidebar(writes);

  openMoveToSection(sidebar, "Retry audit");
  act(() => item("New section…").click());
  typeInto(dialogField("Section title"), "Errands");
  act(() => dialogButton("Emoji").click());
  await settleLoaded();
  const search = dialogField("Search emoji");
  typeInto(search, "pickup truck");
  act(() => {
    search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  await act(async () => dialogButton("Create section").click());

  const made = writes[0];
  assert.equal(made?.kind, TASK_SECTION_WRITE.CREATE);
  assert.deepEqual(made.icon, { kind: TASK_SECTION_ICON_KIND.EMOJI, emoji: "🛻" });
});

test("Icons and Emoji are tabs over the picker's panel, which the tab shown names, its search following the kind", async () => {
  const sidebar = await mountSidebar([]);

  openMoveToSection(sidebar, "Retry audit");
  act(() => item("New section…").click());
  await settleLoaded();
  const kinds =
    document.querySelector<HTMLElement>('[role="tablist"][aria-label="Icon kind"]') ??
    assert.fail("the icon kinds are tabs");
  const tab = (label: string) =>
    [...kinds.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
      (each) => each.textContent === label,
    ) ?? assert.fail(`no ${label} tab`);
  const shown = (label: string) => {
    const panel =
      document.getElementById(tab(label).getAttribute("aria-controls") ?? "") ??
      assert.fail(`${label} controls no panel`);
    assert.equal(panel.getAttribute("role"), "tabpanel");
    assert.equal(panel.getAttribute("aria-labelledby"), tab(label).id);
    return panel;
  };
  assert.equal(tab("Icons").getAttribute("aria-selected"), "true");
  assert.ok(shown("Icons").querySelector('input[aria-label="Search icons"]'));

  act(() => tab("Emoji").click());
  await settleLoaded();

  assert.equal(tab("Emoji").getAttribute("aria-selected"), "true");
  const emoji = shown("Emoji");
  assert.ok(emoji.querySelector('input[aria-label="Search emoji"]'));
  assert.ok(emoji.querySelector('input[aria-label="Any emoji"]'));
  assert.equal(
    emoji.contains(dialogButton("No icon")),
    false,
    "No icon stands beside the tabs, whichever is shown",
  );
});

test("Shift-Enter in the icon search chooses the first glyph it found, as Enter does", async () => {
  const writes: TaskSectionWrite[] = [];
  const sidebar = await mountSidebar(writes);

  openMoveToSection(sidebar, "Retry audit");
  act(() => item("New section…").click());
  typeInto(dialogField("Section title"), "Stars");
  await settleLoaded();
  const search = dialogField("Search icons");
  typeInto(search, "telescope");
  act(() => {
    search.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true }),
    );
  });
  await act(async () => dialogButton("Create section").click());

  assert.deepEqual(writes[0]?.kind === TASK_SECTION_WRITE.CREATE ? writes[0].icon : undefined, {
    kind: TASK_SECTION_ICON_KIND.GLYPH,
    glyph: "telescope",
  });
});

test("Clear search empties the icon search, every glyph is offered again, and the caret stays in the search", async () => {
  const sidebar = await mountSidebar([]);

  openMoveToSection(sidebar, "Retry audit");
  act(() => item("New section…").click());
  await settleLoaded();
  const search = dialogField("Search icons");
  typeInto(search, "telescope");
  assert.equal(document.querySelector('button[aria-label="Folder"]'), null);
  act(() => dialogButton("Clear search").click());

  assert.equal(search.value, "");
  assert.ok(dialogButton("Folder"));
  assert.equal(document.activeElement, search);
});

test("ArrowDown in the icon search hands the focus to the grid's tab stop", async () => {
  const sidebar = await mountSidebar([]);

  openMoveToSection(sidebar, "Retry audit");
  act(() => item("New section…").click());
  await settleLoaded();
  const search = dialogField("Search icons");
  typeInto(search, "telescope");
  act(() => {
    search.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  });

  assert.equal(document.activeElement?.getAttribute("aria-label"), "Telescope");
});

test("the arrows move the grid's one tab stop with the focus", async () => {
  const sidebar = await mountSidebar([]);

  openMoveToSection(sidebar, "Retry audit");
  act(() => item("New section…").click());
  await settleLoaded();
  const folder = dialogButton("Folder");
  act(() => folder.focus());
  act(() => {
    folder.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  });

  assert.equal(document.activeElement?.getAttribute("aria-label"), "Star");
  assert.equal(dialogButton("Star").getAttribute("tabindex"), "0");
  assert.equal(folder.getAttribute("tabindex"), "-1");
});

test("editing a section in an emoji the grid leaves out names it in the emoji field", async () => {
  const newest: TaskSections = {
    sections: [
      {
        id: LAUNCH,
        workspaceId: WORKSPACE.id,
        title: "Launch",
        icon: { kind: TASK_SECTION_ICON_KIND.EMOJI, emoji: "🫩" },
        createdAt: 1,
      },
    ],
    entries: SECTIONS.entries,
    agentEntries: [],
  };
  const sidebar = await mountSidebar([], newest);
  const actions = sidebar.querySelector<HTMLButtonElement>('[aria-label="Launch actions"]');
  assert.ok(actions);

  act(() => actions.click());
  act(() => item("Edit section").click());
  await settleLoaded();

  assert.equal(dialogField("Any emoji").value, "🫩");
});

/** Answers the window's media queries as a phone does, its pointer a finger. */
function underAFinger(): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: query === "(pointer: coarse)",
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
}

/** A finger's touch of `type` at the row's corner, as the browser sends it. */
const touch = (type: string) =>
  new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    pointerId: 7,
    pointerType: "touch",
    isPrimary: true,
    clientX: 10,
    clientY: 10,
  });

/** A finger held still on `target` well past a long press, then lifted. */
function longPress(target: HTMLElement): void {
  vi.useFakeTimers();
  try {
    act(() => {
      target.dispatchEvent(touch("pointerdown"));
    });
    act(() => {
      vi.advanceTimersByTime(2000);
    });
  } finally {
    vi.useRealTimers();
  }
  act(() => {
    target.dispatchEvent(touch("pointerup"));
    target.dispatchEvent(new TouchEvent("touchend", { bubbles: true, cancelable: true }));
  });
}

/** The words of every item of the menus standing. */
function menuWords(): string[] {
  return [...document.querySelectorAll(".luke-menu-item-label")].map(
    (each) => each.textContent ?? "",
  );
}

/** The press of the sidebar row named `name`. */
function rowPress(sidebar: HTMLElement, name: string): HTMLElement {
  const row = [...sidebar.querySelectorAll<HTMLElement>(".sidebar-tasks > li > button")].find(
    (each) => each.textContent?.includes(name),
  );
  return row ?? assert.fail(`no ${name} row`);
}

/** A second pin, after Pin audit. */
const SECOND_PIN = {
  ...task("0a1b2c3d-0000-4000-8000-100000000004", "Pin review"),
  pinnedAt: 4,
  pinPosition: "a1",
};

test("under a finger, a pin held offers Move down, which moves it below the next pin, and no Move up from the top", async () => {
  underAFinger();
  const asked = noneAsked();
  const sidebar = await mountDraggable([PINNED, SECOND_PIN, INVITES], SECTIONS, asked);

  longPress(rowPress(sidebar, "Pin audit"));

  assert.ok(menuWords().includes("Move down"), "the menu offers Move down");
  assert.ok(!menuWords().includes("Move up"), "the top pin has no Move up");
  act(() => item("Move down").click());
  assert.deepEqual(
    asked.moves.map((move) => move.id),
    [PINNED.id],
  );
  assert.ok((asked.moves[0]?.position ?? "") > SECOND_PIN.pinPosition, "it sorts after Pin review");
});

test("with a mouse, a pin's menu offers its move too, with its chord", async () => {
  const sidebar = await mountDraggable([PINNED, SECOND_PIN, INVITES], SECTIONS, noneAsked());

  act(() => {
    rowPress(sidebar, "Pin review").dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 }),
    );
  });

  assert.ok(menuWords().includes("Unpin"), "the pin's menu stands");
  assert.deepEqual(
    menuWords().filter((words) => words === "Move up" || words === "Move down"),
    ["Move up"],
  );
  assert.equal(item("Move up").querySelector(".luke-menu-item-hint")?.textContent, "⇧⌘↑");
});

test("under a finger, a section's menu moves it up among the sections", async () => {
  underAFinger();
  const writes: TaskSectionWrite[] = [];
  const sidebar = await mountSidebar(writes, ICONLESS);
  const drawn = workspaceSections(ICONLESS, WORKSPACE.id).map((section) => section.title);
  const last = drawn.at(-1) ?? assert.fail("two sections stand");
  const actions = sidebar.querySelector<HTMLButtonElement>(`[aria-label="${last} actions"]`);
  assert.ok(actions);

  act(() => actions.click());
  assert.ok(!menuWords().includes("Move down"), "the last section has no Move down");
  act(() => item("Move up").click());

  const after = writes.reduce(
    (state, write) => applySectionWrite(state, write, AFTER_FIXTURES),
    ICONLESS,
  );
  assert.deepEqual(
    workspaceSections(after, WORKSPACE.id).map((section) => section.title),
    [...drawn].reverse(),
  );
});

test("under a finger, a task held in a section moves down within it by its menu", async () => {
  underAFinger();
  const asked = noneAsked();
  const both: TaskSections = {
    ...SECTIONS,
    entries: [...SECTIONS.entries, { taskId: RETRIES.id, sectionId: LAUNCH, addedAt: 3 }],
  };
  const sidebar = await mountDraggable([INVITES, RETRIES], both, asked);
  const first = sectionTaskIds(both, LAUNCH)[0] === INVITES.id ? INVITES : RETRIES;
  const second = first === INVITES ? RETRIES : INVITES;

  longPress(rowPress(sidebar, first.name));
  act(() => item("Move down").click());

  const after = asked.writes.reduce(
    (state, write) => applySectionWrite(state, write, AFTER_FIXTURES),
    both,
  );
  assert.deepEqual(sectionTaskIds(after, LAUNCH), [second.id, first.id]);
});

/** The sidebar over two pins that sorts them by each place `onMovePins` hears, as the window's own state does. */
function PinsThatMove(): React.JSX.Element {
  const [pins, setPins] = useState([PINNED, SECOND_PIN]);
  const tasks = tasksControl({
    tasks: pins,
    workspaces: [WORKSPACE],
    workspace: WORKSPACE,
    onMovePins: (moves) =>
      setPins((held) =>
        held.map((pin) => {
          const place = moves.find((move) => move.id === pin.id)?.position;
          return place === undefined ? pin : { ...pin, pinPosition: place };
        }),
      ),
  });
  return createElement(DesktopSidebar, sidebarProps(tasks));
}

test("⇧⌘↓ moves the pin that has the keyboard below the next and leaves it focused, so ⇧⌘↑ can move it back", async () => {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(onRegistry(AtomRegistry.make(), createElement(PinsThatMove))));
  await settle();
  assert.equal(appCommandOffered(APP_COMMAND.MOVE_ROW_DOWN), false, "no row has the keyboard");

  act(() => rowPress(container, "Pin audit").focus());
  assert.equal(appCommandOffered(APP_COMMAND.MOVE_ROW_DOWN), true);
  act(() => {
    runAppCommand(APP_COMMAND.MOVE_ROW_DOWN);
  });
  assert.deepEqual(namesIn(container, "Pinned"), ["Pin review", "Pin audit"]);
  assert.equal(document.activeElement, rowPress(container, "Pin audit"));

  // Note that the last row has nowhere further down, so the chord leaves it where it stands.
  act(() => {
    runAppCommand(APP_COMMAND.MOVE_ROW_DOWN);
  });
  assert.deepEqual(namesIn(container, "Pinned"), ["Pin review", "Pin audit"]);
  act(() => {
    runAppCommand(APP_COMMAND.MOVE_ROW_UP);
  });
  assert.deepEqual(namesIn(container, "Pinned"), ["Pin audit", "Pin review"]);
  assert.equal(document.activeElement, rowPress(container, "Pin audit"));

  act(() => (document.activeElement as HTMLElement).blur());
  assert.equal(appCommandOffered(APP_COMMAND.MOVE_ROW_DOWN), false, "the keyboard left the list");
});

test("⇧⌘↓ on a task in a section moves the task within it, and ⇧⌘↑ on the section's header moves the section", async () => {
  const asked = noneAsked();
  const sidebar = await mountDraggable([INVITES, RETRIES], BOTH_IN_LAUNCH, asked);
  const written = () =>
    asked.writes.reduce(
      (state, write) => applySectionWrite(state, write, AFTER_FIXTURES),
      BOTH_IN_LAUNCH,
    );
  const before = workspaceSections(BOTH_IN_LAUNCH, WORKSPACE.id).map((section) => section.title);

  act(() => rowPress(sidebar, "Invite expiry").focus());
  act(() => {
    runAppCommand(APP_COMMAND.MOVE_ROW_DOWN);
  });
  assert.deepEqual(sectionTaskIds(written(), LAUNCH), [RETRIES.id, INVITES.id]);
  assert.deepEqual(
    workspaceSections(written(), WORKSPACE.id).map((section) => section.title),
    before,
    "the section stayed where it stood",
  );

  const fold = sectionHeader(sidebar, "Launch").querySelector<HTMLElement>("button[aria-expanded]");
  act(() => fold?.focus());
  act(() => {
    runAppCommand(APP_COMMAND.MOVE_ROW_UP);
  });
  assert.deepEqual(
    workspaceSections(written(), WORKSPACE.id).map((section) => section.title),
    [...before].reverse(),
  );
});

/** An agent Ada started with no task, last active before either task was saved. */
const SWEEP: TasklessAgent = {
  id: "0a1b2c3d-0000-4000-8000-200000000001",
  planId: null,
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "Sweep flaky tests",
  createdAt: 1,
  status: CODING_AGENT_STATUS.COMPLETED,
  turnId: null,
  startedBy: { userId: "user-ada", name: "Ada Lovelace" },
  automationId: null,
  workspaceId: WORKSPACE.id,
  repository: "acme/relay",
  activityAt: 1,
};

/** The sidebar's agents with no task: Sweep flaky tests alone. */
const WITH_SWEEP: Partial<TasksControl> = { listedAgents: { standing: [SWEEP], archived: [] } };

/** Launch holding Invite expiry and, put there after it, Sweep flaky tests. */
const SWEEP_IN_LAUNCH: TaskSections = {
  ...SECTIONS,
  agentEntries: [{ agentId: SWEEP.id, sectionId: LAUNCH, addedAt: 3 }],
};

test("an agent kept in a section stands among its tasks in its order, which Tasks leaves out, and goes back under Tasks once the section is deleted", async () => {
  const writes: TaskSectionWrite[] = [];
  const { container: sidebar, draw } = await mountSidebarRedrawn(
    writes,
    SWEEP_IN_LAUNCH,
    WITH_SWEEP,
  );

  // Put there last and never dragged, it stands on top.
  assert.deepEqual(namesIn(sidebar, "Sections"), ["Sweep flaky tests", "Invite expiry"]);
  assert.deepEqual(namesIn(sidebar, "Tasks"), ["Retry audit"]);

  await draw(
    applySectionWrite(SWEEP_IN_LAUNCH, { kind: TASK_SECTION_WRITE.DELETE, id: LAUNCH }, 9),
  );
  assert.deepEqual(namesIn(sidebar, "Sections"), []);
  assert.deepEqual(namesIn(sidebar, "Tasks"), [
    "Invite expiry",
    "Retry audit",
    "Sweep flaky tests",
  ]);
});

test("an agent's menu offers Move to section after Pin and Archive, as a task's does, and a section chosen writes it there", async () => {
  const writes: TaskSectionWrite[] = [];
  const sidebar = await mountSidebar(writes, SECTIONS, WITH_SWEEP);

  openRowMenu(sidebar, "Sweep flaky tests");
  const labels = menuLabels();
  assert.deepEqual(labels.slice(labels.indexOf("Pin"), labels.indexOf("Pin") + 3), [
    "Pin",
    "Archive",
    "Move to section",
  ]);
  act(() => item("Move to section").click());
  act(() => item("Launch").click());

  assert.deepEqual(writes, [
    { kind: TASK_SECTION_WRITE.PLACE_AGENT, agentId: SWEEP.id, sectionId: LAUNCH },
  ]);
});

test("an agent's Move to section checks the section it stands in and offers Remove from section", async () => {
  const writes: TaskSectionWrite[] = [];
  const sidebar = await mountSidebar(writes, SWEEP_IN_LAUNCH, WITH_SWEEP);

  openMoveToSection(sidebar, "Sweep flaky tests");
  assert.equal(item("Launch").getAttribute("aria-checked"), "true");
  act(() => item("Remove from section").click());

  assert.deepEqual(writes, [
    { kind: TASK_SECTION_WRITE.PLACE_AGENT, agentId: SWEEP.id, sectionId: null },
  ]);
});

test("an agent dragged from Tasks into a section lands where it was let go, among the section's tasks", async () => {
  const asked = noneAsked();
  // Down the column: Pinned's word, Invite expiry under Launch, then Retry audit and Sweep flaky tests under Tasks.
  const sidebar = await mountDraggable([INVITES, RETRIES], SECTIONS, asked, WITH_SWEEP);

  drag(sidebar, "Sweep flaky tests", 2 * ROW_HEIGHT - 4);

  assert.deepEqual(asked.marks, []);
  const after = asked.writes.reduce(
    (state, write) => applySectionWrite(state, write, AFTER_FIXTURES),
    SECTIONS,
  );
  assert.deepEqual(
    sectionOrder(after, LAUNCH).map((entry) => memberOf(entry)),
    [
      { agent: false, id: INVITES.id },
      { agent: true, id: SWEEP.id },
    ],
  );
});

test("an agent dragged from a section onto Tasks leaves every section", async () => {
  const asked = noneAsked();
  // Down the column: Pinned's word, Sweep flaky tests and Invite expiry under Launch, Retry audit under Tasks.
  const sidebar = await mountDraggable([INVITES, RETRIES], SWEEP_IN_LAUNCH, asked, WITH_SWEEP);

  drag(sidebar, "Sweep flaky tests", 4 * ROW_HEIGHT - 4);

  assert.deepEqual(asked.writes, [
    { kind: TASK_SECTION_WRITE.PLACE_AGENT, agentId: SWEEP.id, sectionId: null },
  ]);
});
