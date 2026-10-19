// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  TASK_SECTION_ICON_COLOR,
  TASK_SECTION_ICON_KIND,
  TASK_SECTION_WRITE,
  type TaskSections,
  type TaskSectionWrite,
} from "@luke/features/task-section-wire";
import type { TaskSummary } from "@luke/features/task-wire";
import { WORKSPACE_ROLE, type Workspace } from "@luke/features/workspace-wire";
import { ACT_OUTCOME_STATUS } from "@luke/host/acts";
import { EXPERIMENT } from "@luke/settings";
import { experimentsOn } from "@luke/settings/testing";
import { applySectionWrite, sectionOrder } from "@luke/ui/task-sections-model";
import { type PinMove, TASK_MARK, type TaskMark } from "@luke/ui/tasks-model";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { fakeAppBridge } from "../testing/app-bridge.js";
import { handState } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { sidebarProps } from "../testing/desktop-sidebar.js";
import { tasksControl } from "../testing/tasks-control.js";
import { DesktopSidebar } from "./desktop-sidebar.js";

/**
 * sidebar-sections.test.ts -- the account's own sections in the sidebar:
 * drawn only while their experiment is on, each over the tasks kept in it,
 * which Tasks then leaves out, and reached from a task's menu, whose Move
 * to section writes the move and whose section's Delete asks first; and
 * the dialog's icon picker, every Lucide glyph in a color and every emoji,
 * found by one search; and a task dragged between Pinned, Tasks, and a
 * section, pinned, unpinned, and moved where it is let go while the
 * experiment is on. Synthetic throughout.
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
  fakeAppBridge({
    act: () => Promise.resolve({ status: ACT_OUTCOME_STATUS.REFUSED, reason: "Not here." }),
  });
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
};

const SOMEDAY = "0a1b2c3d-0000-4000-8000-000000000002";

/** Launch, and Someday, made without an icon, holding Retry audit. */
const ICONLESS: TaskSections = {
  sections: [
    ...SECTIONS.sections,
    { id: SOMEDAY, workspaceId: WORKSPACE.id, title: "Someday", createdAt: 2 },
  ],
  entries: [...SECTIONS.entries, { taskId: RETRIES.id, sectionId: SOMEDAY, addedAt: 3 }],
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
  const found = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
  return found ?? assert.fail(`no ${label} field`);
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
    act(() => root.render(onRegistry(registry, sidebarOver(sections, writes, rest))));
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
  const found = fold?.closest<HTMLElement>(".sidebar-repository-header");
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

test("with the experiment off no section stands, and a task kept in one stands under Tasks", async () => {
  handState({});
  const sidebar = await mountSidebar([]);

  assert.equal(sidebar.querySelector('nav[aria-label="Sections"]'), null);
  assert.deepEqual(namesIn(sidebar, "Tasks").sort(), ["Invite expiry", "Retry audit"]);
});

test("with the experiment on a section stands over its tasks, which Tasks leaves out", async () => {
  handState(experimentsOn(EXPERIMENT.SECTIONS));
  const sidebar = await mountSidebar([]);

  assert.deepEqual(namesIn(sidebar, "Sections"), ["Invite expiry"]);
  assert.deepEqual(namesIn(sidebar, "Tasks"), ["Retry audit"]);
  const header = sidebar.querySelector('nav[aria-label="Sections"] button[aria-expanded]');
  assert.equal(header === null ? undefined : heardName(header), "Launch");
});

test("a task's Move to section puts it on top of the section chosen", async () => {
  handState(experimentsOn(EXPERIMENT.SECTIONS));
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

test("a section's Delete section asks first, then deletes the section and none of its tasks", async () => {
  handState(experimentsOn(EXPERIMENT.SECTIONS));
  const writes: TaskSectionWrite[] = [];
  const sidebar = await mountSidebar(writes);
  const actions = sidebar.querySelector<HTMLButtonElement>('[aria-label="Actions for Launch"]');
  assert.ok(actions);

  act(() => actions.click());
  act(() => item("Delete section").click());
  const asked = writes.length;
  const confirm = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Delete section",
  );
  assert.ok(confirm, "the question is asked");
  await act(async () => confirm.click());

  assert.equal(asked, 0);
  assert.deepEqual(writes, [{ kind: TASK_SECTION_WRITE.DELETE, id: LAUNCH }]);
});

/** Launch holding both tasks, Invite expiry on top, and Someday holding none. */
const BOTH_IN_LAUNCH: TaskSections = {
  sections: ICONLESS.sections,
  entries: [
    { taskId: INVITES.id, sectionId: LAUNCH, addedAt: 3 },
    { taskId: RETRIES.id, sectionId: LAUNCH, addedAt: 2 },
  ],
};

/** Opens the section titled `title`'s menu from its ⋯. */
function openSectionMenu(sidebar: HTMLElement, title: string): void {
  const actions = sidebar.querySelector<HTMLButtonElement>(`[aria-label="Actions for ${title}"]`);
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

test("a section holding tasks offers what acts on all of them between Edit and Delete", async () => {
  handState(experimentsOn(EXPERIMENT.SECTIONS));
  const sidebar = await mountSidebar([], ICONLESS);

  openSectionMenu(sidebar, "Launch");

  assert.deepEqual(menuLabels(), [
    "Edit section",
    "Move tasks to",
    "Remove tasks from section",
    "Archive tasks",
    "Delete section",
  ]);
});

test("a section holding no task offers only Edit and Delete", async () => {
  handState(experimentsOn(EXPERIMENT.SECTIONS));
  const sidebar = await mountSidebar([], {
    sections: ICONLESS.sections,
    entries: ICONLESS.entries.filter((entry) => entry.sectionId !== SOMEDAY),
  });

  openSectionMenu(sidebar, "Someday");

  assert.deepEqual(menuLabels(), ["Edit section", "Delete section"]);
});

test("a section's Move tasks to puts every task in it on top of the section chosen, in its order", async () => {
  handState(experimentsOn(EXPERIMENT.SECTIONS));
  const writes: TaskSectionWrite[] = [];
  const sidebar = await mountSidebar(writes, BOTH_IN_LAUNCH);

  openSectionMenu(sidebar, "Launch");
  act(() => item("Move tasks to").click());
  const offered = menuLabels().slice(menuLabels().indexOf("Delete section") + 1);
  act(() => item("Someday").click());
  const moved = writes.reduce((held, write) => applySectionWrite(held, write, 10), BOTH_IN_LAUNCH);

  assert.deepEqual(offered, ["Someday", "New section…"]);
  assert.deepEqual(
    sectionOrder(moved, SOMEDAY).map((entry) => entry.taskId),
    [INVITES.id, RETRIES.id],
  );
  assert.deepEqual(sectionOrder(moved, LAUNCH), []);
});

test("a section's Remove tasks from section takes every task in it out of every section", async () => {
  handState(experimentsOn(EXPERIMENT.SECTIONS));
  const writes: TaskSectionWrite[] = [];
  const sidebar = await mountSidebar(writes, BOTH_IN_LAUNCH);

  openSectionMenu(sidebar, "Launch");
  act(() => item("Remove tasks from section").click());

  assert.deepEqual(writes, [
    { kind: TASK_SECTION_WRITE.PLACE, taskId: INVITES.id, sectionId: null },
    { kind: TASK_SECTION_WRITE.PLACE, taskId: RETRIES.id, sectionId: null },
  ]);
});

test("a section's Archive tasks archives every task in it at once where none has agents", async () => {
  handState(experimentsOn(EXPERIMENT.SECTIONS));
  const archived: string[][] = [];
  const sidebar = await mountSidebar([], BOTH_IN_LAUNCH, {
    onArchiveTasks: (taskIds) => archived.push([...taskIds]),
  });

  openSectionMenu(sidebar, "Launch");
  act(() => item("Archive tasks").click());

  assert.equal(document.querySelector('[role="alertdialog"]'), null);
  assert.deepEqual(archived, [[INVITES.id, RETRIES.id]]);
});

test("a section's Archive tasks asks first where a task in it has agents, then archives them all", async () => {
  handState(experimentsOn(EXPERIMENT.SECTIONS));
  const archived: string[][] = [];
  const working: TaskSummary = {
    ...RETRIES,
    agents: { total: 1, working: 1, agents: [], pullRequestTotal: 0, pullRequests: [] },
  };
  const sidebar = await mountSidebar([], BOTH_IN_LAUNCH, {
    tasks: [INVITES, working],
    onArchiveTasks: (taskIds) => archived.push([...taskIds]),
  });

  openSectionMenu(sidebar, "Launch");
  act(() => item("Archive tasks").click());
  const asked = archived.length;
  const question = document.querySelector('[role="alertdialog"]')?.textContent ?? "";
  await act(async () => dialogButton("Archive").click());

  assert.equal(asked, 0);
  assert.match(question, /Archive 2 tasks\?/);
  assert.deepEqual(archived, [[INVITES.id, RETRIES.id]]);
});

test("a section's Archive question goes when a task it asked about leaves the section, and archives nothing", async () => {
  handState(experimentsOn(EXPERIMENT.SECTIONS));
  const archived: string[][] = [];
  const working: TaskSummary = {
    ...RETRIES,
    agents: { total: 1, working: 1, agents: [], pullRequestTotal: 0, pullRequests: [] },
  };
  const { container, draw } = await mountSidebarRedrawn([], BOTH_IN_LAUNCH, {
    tasks: [INVITES, working],
    onArchiveTasks: (taskIds) => archived.push([...taskIds]),
  });
  openSectionMenu(container, "Launch");
  act(() => item("Archive tasks").click());
  assert.ok(document.querySelector('[role="alertdialog"]'), "the question is asked");

  await draw({
    sections: BOTH_IN_LAUNCH.sections,
    entries: [
      { taskId: INVITES.id, sectionId: LAUNCH, addedAt: 3 },
      { taskId: RETRIES.id, sectionId: SOMEDAY, addedAt: 4 },
    ],
  });

  assert.equal(document.querySelector('[role="alertdialog"]'), null);
  assert.deepEqual(archived, []);
});

test("a section's Mark all as read stands while a task in it is unread, and marks every one read", async () => {
  handState(experimentsOn(EXPERIMENT.SECTIONS));
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

test("a section's Delete question goes when the section does, deleted on another Mac", async () => {
  handState(experimentsOn(EXPERIMENT.SECTIONS));
  const writes: TaskSectionWrite[] = [];
  const { container, draw } = await mountSidebarRedrawn(writes);
  const actions = container.querySelector<HTMLButtonElement>('[aria-label="Actions for Launch"]');
  assert.ok(actions);
  act(() => actions.click());
  act(() => item("Delete section").click());
  assert.ok(document.querySelector('[role="alertdialog"]'), "the question is asked");

  await draw({ sections: [], entries: [] });

  assert.equal(document.querySelector('[role="alertdialog"]'), null);
  assert.deepEqual(writes, []);
});

test("a section without an icon draws its title alone, with no glyph before it", async () => {
  handState(experimentsOn(EXPERIMENT.SECTIONS));
  const sidebar = await mountSidebar([], ICONLESS);

  const toggle = sectionHeader(sidebar, "Someday").querySelector("button[aria-expanded]");
  assert.equal(toggle?.querySelector('[aria-hidden="true"]'), null);
  assert.equal(toggle?.querySelector("svg"), null);
  const launch = sectionHeader(sidebar, "Launch").querySelector(
    'button[aria-expanded] > [aria-hidden="true"]',
  );
  assert.equal(launch?.textContent, "🚀");
});

test("Move to section names a section without an icon with no glyph beside it", async () => {
  handState(experimentsOn(EXPERIMENT.SECTIONS));
  const sidebar = await mountSidebar([], ICONLESS);

  openMoveToSection(sidebar, "Invite expiry");

  assert.equal(item("Someday").querySelector(".luke-menu-item-glyph")?.childElementCount, 0);
  assert.equal(item("Launch").querySelector(".luke-menu-item-glyph")?.textContent, "🚀");
});

test("a new section starts with no icon and is made without one", async () => {
  handState(experimentsOn(EXPERIMENT.SECTIONS));
  const writes: TaskSectionWrite[] = [];
  const sidebar = await mountSidebar(writes);

  openMoveToSection(sidebar, "Retry audit");
  act(() => item("New section…").click());
  assert.equal(dialogButton("No icon").getAttribute("aria-pressed"), "true");
  const title = document.querySelector<HTMLInputElement>('[aria-label="Section title"]');
  assert.ok(title);
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

test("a title typed after a refusal keeps the card up, takes the refusal away, and can still be made", async () => {
  handState(experimentsOn(EXPERIMENT.SECTIONS));
  const writes: TaskSectionWrite[] = [];
  const sidebar = await mountSidebar(writes);

  openMoveToSection(sidebar, "Retry audit");
  act(() => item("New section…").click());
  await act(async () => dialogButton("Create section").click());
  const refused = document.querySelector('[role="alertdialog"] [role="alert"]')?.textContent;
  const title = document.querySelector<HTMLInputElement>('[aria-label="Section title"]');
  assert.ok(title);
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setValue?.call(title, "S");
    title.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const typed = document.querySelector<HTMLInputElement>(
    '[role="alertdialog"] [aria-label="Section title"]',
  )?.value;
  const refusalAfterTyping = document.querySelector('[role="alertdialog"] [role="alert"]');
  await act(async () => dialogButton("Create section").click());

  assert.equal(refused, "Name the section.");
  assert.equal(typed, "S", "the card stays up with what was typed");
  assert.equal(refusalAfterTyping, null);
  assert.equal(writes[0]?.kind, TASK_SECTION_WRITE.CREATE);
  assert.equal(writes[0]?.kind === TASK_SECTION_WRITE.CREATE && writes[0].title, "S");
});

test("choosing No icon and saving clears a section's icon", async () => {
  handState(experimentsOn(EXPERIMENT.SECTIONS));
  const writes: TaskSectionWrite[] = [];
  const sidebar = await mountSidebar(writes);
  const actions = sidebar.querySelector<HTMLButtonElement>('[aria-label="Actions for Launch"]');
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
  const slots = () => [...document.querySelectorAll(".sidebar-tasks > li, .sidebar-section-empty")];
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
): Promise<HTMLElement> {
  const tasks = tasksControl({
    tasks: [...summaries],
    workspaces: [WORKSPACE],
    workspace: WORKSPACE,
    taskSections: sections,
    onWriteSections: (writes) => asked.writes.push(...writes),
    onMarkTask: (taskId, mark) => asked.marks.push([taskId, mark]),
    onMovePins: (moves) => asked.moves.push(...moves),
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
  const label = [...sidebar.querySelectorAll<HTMLElement>(".luke-list-row-title")].find(
    (each) => each.textContent === name,
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
  handState(experimentsOn(EXPERIMENT.SECTIONS));
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
  handState(experimentsOn(EXPERIMENT.SECTIONS));
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
  handState(experimentsOn(EXPERIMENT.SECTIONS));
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
  handState(experimentsOn(EXPERIMENT.SECTIONS));
  const asked = noneAsked();
  const sidebar = await mountDraggable([PINNED, INVITES, RETRIES], SECTIONS, asked);

  drag(sidebar, "Pin audit", 2 * ROW_HEIGHT - 4);

  assert.deepEqual(asked.marks, [[PINNED.id, TASK_MARK.UNPIN]]);
  const after = asked.writes.reduce(
    (state, write) => applySectionWrite(state, write, AFTER_FIXTURES),
    SECTIONS,
  );
  assert.deepEqual(
    sectionOrder(after, LAUNCH).map((entry) => entry.taskId),
    [INVITES.id, PINNED.id],
  );
});

test("with sections on, Pinned stands while nothing is pinned and takes the first pin", async () => {
  handState(experimentsOn(EXPERIMENT.SECTIONS));
  const asked = noneAsked();
  const sidebar = await mountDraggable([INVITES, RETRIES], SECTIONS, asked);
  assert.ok(sidebar.querySelector('nav[aria-label="Pinned"] .sidebar-section-empty'));

  drag(sidebar, "Retry audit", 4);

  assert.deepEqual(asked.marks, [[RETRIES.id, TASK_MARK.PIN]]);
});

test("with the experiment off, Pinned takes no task dragged at it and its pins still reorder", async () => {
  handState({});
  const asked = noneAsked();
  const second = {
    ...task("0a1b2c3d-0000-4000-8000-100000000004", "Pin review"),
    pinnedAt: 4,
    pinPosition: "a1",
  };
  // Down the column: Pin audit and Pin review under Pinned, then both others under Tasks.
  const sidebar = await mountDraggable([PINNED, second, INVITES, RETRIES], SECTIONS, asked);
  assert.equal(
    sidebar.querySelector('nav[aria-label="Pinned"]')?.hasAttribute("data-row-drop"),
    false,
  );

  drag(sidebar, "Retry audit", 4);
  drag(sidebar, "Pin audit", 2 * ROW_HEIGHT - 4);

  assert.deepEqual(asked.marks, []);
  assert.deepEqual(
    asked.moves.map((move) => move.id),
    [PINNED.id],
  );
  assert.ok((asked.moves[0]?.position ?? "") > second.pinPosition, "it sorts after Pin review");
});

test("a section's glyph beyond the suggested ones is drawn in its color, and one no Lucide knows draws none", async () => {
  handState(experimentsOn(EXPERIMENT.SECTIONS));
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
  handState(experimentsOn(EXPERIMENT.SECTIONS));
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
  handState(experimentsOn(EXPERIMENT.SECTIONS));
  const writes: TaskSectionWrite[] = [];
  const sidebar = await mountSidebar(writes, GLYPHS);
  const actions = sidebar.querySelector<HTMLButtonElement>('[aria-label="Actions for Stars"]');
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
  handState(experimentsOn(EXPERIMENT.SECTIONS));
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
  handState(experimentsOn(EXPERIMENT.SECTIONS));
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
  handState(experimentsOn(EXPERIMENT.SECTIONS));
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
  handState(experimentsOn(EXPERIMENT.SECTIONS));
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
  handState(experimentsOn(EXPERIMENT.SECTIONS));
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
  handState(experimentsOn(EXPERIMENT.SECTIONS));
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
  handState(experimentsOn(EXPERIMENT.SECTIONS));
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
  };
  const sidebar = await mountSidebar([], newest);
  const actions = sidebar.querySelector<HTMLButtonElement>('[aria-label="Actions for Launch"]');
  assert.ok(actions);

  act(() => actions.click());
  act(() => item("Edit section").click());
  await settleLoaded();

  assert.equal(dialogField("Any emoji").value, "🫩");
});
