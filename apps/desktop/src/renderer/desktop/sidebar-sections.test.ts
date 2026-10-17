// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
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
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { handState } from "#testing/app-state";
import { onRegistry } from "#testing/copy-feedback";
import { sidebarProps } from "#testing/desktop-sidebar";
import { tasksControl } from "#testing/tasks-control";
import { DesktopSidebar } from "./desktop-sidebar";

/**
 * sidebar-sections.test.ts -- the account's own sections in the sidebar:
 * drawn only while their experiment is on, each over the tasks kept in it,
 * which Tasks then leaves out, and reached from a task's menu, whose Move
 * to section writes the move and whose section's Delete asks first.
 * Synthetic throughout.
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
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: {
      onMenuCommand: () => () => undefined,
      recordSurfaceEvent: () => undefined,
      act: () => Promise.resolve({ status: ACT_OUTCOME_STATUS.REFUSED, reason: "Not here." }),
    },
  });
});

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
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

/** The sidebar listing both tasks over `sections`, each write it asks heard by `writes`. */
function sidebarOver(sections: TaskSections, writes: TaskSectionWrite[]) {
  const tasks = tasksControl({
    tasks: [INVITES, RETRIES],
    workspaces: [WORKSPACE],
    workspace: WORKSPACE,
    taskSections: sections,
    onWriteSections: (asked) => writes.push(...asked),
  });
  return createElement(DesktopSidebar, sidebarProps(tasks));
}

/** The sidebar over `sections`, Launch unless said, and a way to draw it again over other sections, as a refresh does. */
async function mountSidebarRedrawn(writes: TaskSectionWrite[], sections = SECTIONS) {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  const registry = AtomRegistry.make();
  const draw = async (sections: TaskSections) => {
    act(() => root.render(onRegistry(registry, sidebarOver(sections, writes))));
    await settle();
  };
  await draw(sections);
  return { container, draw };
}

/** The sidebar over `sections`, Launch unless said, each write it asks heard by `writes`. */
async function mountSidebar(writes: TaskSectionWrite[], sections = SECTIONS): Promise<HTMLElement> {
  return (await mountSidebarRedrawn(writes, sections)).container;
}

/** The header of the section titled `title`, failing where none is drawn. */
function sectionHeader(sidebar: HTMLElement, title: string): HTMLElement {
  const name = [
    ...sidebar.querySelectorAll('nav[aria-label="Sections"] .sidebar-repository-name'),
  ].find((each) => each.textContent === title);
  const found = name?.closest<HTMLElement>(".sidebar-repository-header");
  return found ?? assert.fail(`no ${title} section`);
}

/** Opens the task named `name`'s menu, then its Move to section. */
function openMoveToSection(sidebar: HTMLElement, name: string): void {
  const row = [...sidebar.querySelectorAll<HTMLElement>(".sidebar-task")].find((each) =>
    each.textContent?.includes(name),
  );
  assert.ok(row);
  act(() => {
    row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 }));
  });
  act(() => item("Move to section").click());
}

/** The dialog's button whose words or label are `label`, failing where none is drawn. */
function dialogButton(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === label || button.getAttribute("aria-label") === label,
  );
  return found ?? assert.fail(`no ${label} button`);
}

/** The names of the tasks drawn under the region labelled `label`. */
function namesIn(sidebar: HTMLElement, label: string): string[] {
  const region = sidebar.querySelector(`nav[aria-label="${label}"]`);
  return [...(region?.querySelectorAll(".sidebar-task-name") ?? [])].map(
    (name) => name.textContent ?? "",
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
  const header = sidebar.querySelector('nav[aria-label="Sections"] .sidebar-repository-name');
  assert.equal(header?.textContent, "Launch");
});

test("a task's Move to section puts it on top of the section chosen", async () => {
  handState(experimentsOn(EXPERIMENT.SECTIONS));
  const writes: TaskSectionWrite[] = [];
  const sidebar = await mountSidebar(writes);
  const row = [...sidebar.querySelectorAll<HTMLElement>(".sidebar-task")].find((each) =>
    each.textContent?.includes("Retry audit"),
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

  const toggle = sectionHeader(sidebar, "Someday").querySelector(".sidebar-repository-toggle");
  assert.equal(toggle?.firstElementChild?.className, "sidebar-repository-name");
  assert.equal(toggle?.querySelector("svg"), null);
  const launch = sectionHeader(sidebar, "Launch").querySelector(".sidebar-repository-glyph");
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

test("choosing No icon and saving clears a section's icon", async () => {
  handState(experimentsOn(EXPERIMENT.SECTIONS));
  const writes: TaskSectionWrite[] = [];
  const sidebar = await mountSidebar(writes);
  const actions = sidebar.querySelector<HTMLButtonElement>('[aria-label="Actions for Launch"]');
  assert.ok(actions);

  act(() => actions.click());
  act(() => item("Edit section").click());
  assert.equal(dialogButton("🚀").getAttribute("aria-pressed"), "true");
  act(() => dialogButton("No icon").click());
  await act(async () => dialogButton("Save").click());

  assert.deepEqual(writes, [
    { kind: TASK_SECTION_WRITE.EDIT, id: LAUNCH, title: "Launch", icon: null },
  ]);
});
