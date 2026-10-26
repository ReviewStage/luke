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
import { applySectionWrite } from "@luke/ui/task-sections-model";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { SHELL_ROOM } from "../shell-room.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { handState } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { tasksControl } from "../testing/tasks-control.js";
import { newestToastAction, newestToastSays } from "../testing/toast.js";
import { ToastHost } from "../toast.js";
import { TasksPage } from "./tasks-page.js";

/**
 * tasks-list-sections.test.ts -- the account's own sections on the Tasks
 * page: reached from a task's menu, whose Move to section writes the move,
 * and from a section's ⋯, whose Edit section opens the dialog and whose
 * Delete section acts at once with Undo; and the dialog's icon picker,
 * every Lucide glyph in a color and every emoji, found by one search.
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

/** The Tasks page listing both tasks over `sections`, each write it asks heard by `writes`, and anything else `rest` says of the tasks. */
function pageOver(
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
  return createElement(TasksPage, { tasks, room: SHELL_ROOM.WIDE });
}

/** The Tasks page over `sections`, Launch unless said, and a way to draw it again over other sections, as a refresh does. */
async function mountPageRedrawn(
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
          createElement(Fragment, null, pageOver(sections, writes, rest), createElement(ToastHost)),
        ),
      ),
    );
    await settle();
  };
  await draw(sections);
  return { container, draw };
}

/** The Tasks page over `sections`, Launch unless said, each write it asks heard by `writes`. */
async function mountPage(
  writes: TaskSectionWrite[],
  sections = SECTIONS,
  rest: Partial<TasksControl> = {},
): Promise<HTMLElement> {
  return (await mountPageRedrawn(writes, sections, rest)).container;
}

/** The header of the section titled `title`, failing where none is drawn. */
function sectionHeader(page: HTMLElement, title: string): HTMLElement {
  const found = page.querySelector<HTMLElement>(
    `section.tasks-list-group[aria-label="${title}"] .luke-group-header-head`,
  );
  return found ?? assert.fail(`no ${title} section`);
}

/** Opens the task named `name`'s menu, then its Move to section. */
function openMoveToSection(sidebar: HTMLElement, name: string): void {
  const row = [...sidebar.querySelectorAll<HTMLElement>("li.tasks-list-row")].find((each) =>
    each.textContent?.includes(name),
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
function namesIn(page: HTMLElement, title: string): string[] {
  return [
    ...page.querySelectorAll(
      `section.tasks-list-group[aria-label="${title}"] li.tasks-list-row [data-cell="name"]`,
    ),
  ].map((name) => (name.textContent ?? "").split(", ")[0] ?? "");
}

/** The menu item named `label`, failing where none is drawn. */
function item(label: string): HTMLElement {
  const name = [...document.querySelectorAll(".luke-menu-item-label")].find(
    (each) => each.textContent === label,
  );
  const found = name?.closest<HTMLElement>('[role="menuitem"], [role="menuitemcheckbox"]');
  return found ?? assert.fail(`no ${label} in the menu`);
}

test("a task's Move to section puts it on top of the section chosen", async () => {
  const writes: TaskSectionWrite[] = [];
  const sidebar = await mountPage(writes);
  const row = [...sidebar.querySelectorAll<HTMLElement>("li.tasks-list-row")].find((each) =>
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

/** The sections' titles, in the order the sidebar draws them. */
function sectionTitles(page: HTMLElement): string[] {
  return [...page.querySelectorAll<HTMLElement>("section.tasks-list-group")]
    .filter(
      (group) => group.querySelector('.luke-group-header-head [aria-label$=" actions"]') !== null,
    )
    .map((group) => group.getAttribute("aria-label") ?? "");
}

/** `state` once the service has taken every write of `writes`, in order. */
function applied(state: TaskSections, writes: readonly TaskSectionWrite[]): TaskSections {
  return writes.reduce((was, write) => applySectionWrite(was, write, 30), state);
}

test("deleting a section removes it at once with no dialog, and Undo brings it back where it stood with its tasks", async () => {
  const writes: TaskSectionWrite[] = [];
  const { container: sidebar, draw } = await mountPageRedrawn(writes, BOTH_IN_LAUNCH);
  const stood = sectionTitles(sidebar);
  openSectionMenu(sidebar, "Launch");

  act(() => item("Delete section").click());
  const deleted = applied(BOTH_IN_LAUNCH, writes.splice(0));
  await draw(deleted);

  assert.equal(document.querySelector('[role="alertdialog"]'), null, "nothing is asked");
  assert.deepEqual(sectionTitles(sidebar), ["Someday"]);
  assert.match(newestToastSays() ?? "", /Section deleted/u);

  act(() => newestToastAction()?.click());
  await draw(applied(deleted, writes));

  assert.deepEqual(stood, ["Someday", "Launch"]);
  assert.deepEqual(sectionTitles(sidebar), stood);
  assert.deepEqual(namesIn(sidebar, "Launch"), ["Invite expiry", "Retry audit"]);
  const icon = sectionHeader(sidebar, "Launch").querySelector(".luke-group-header-icon");
  assert.equal(icon?.textContent, "🚀");
});

test("Move to section names a section without an icon with no glyph beside it", async () => {
  const sidebar = await mountPage([], ICONLESS);

  openMoveToSection(sidebar, "Invite expiry");

  assert.equal(item("Launch").querySelector(".luke-menu-item-glyph")?.textContent, "🚀");
});

test("a new section starts with no icon and is made without one", async () => {
  const writes: TaskSectionWrite[] = [];
  const sidebar = await mountPage(writes);

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
  const sidebar = await mountPage(writes);

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
  const sidebar = await mountPage(writes);

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
  const sidebar = await mountPage(writes);
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

test("an icon found by searching, in a color chosen, is the new section's", async () => {
  const writes: TaskSectionWrite[] = [];
  const sidebar = await mountPage(writes);

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
  const sidebar = await mountPage(writes, GLYPHS);
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
  const sidebar = await mountPage(writes);

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
  const sidebar = await mountPage([]);

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
  const sidebar = await mountPage(writes);

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
  const sidebar = await mountPage([]);

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
  const sidebar = await mountPage([]);

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
  const sidebar = await mountPage([]);

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
  const sidebar = await mountPage([], newest);
  const actions = sidebar.querySelector<HTMLButtonElement>('[aria-label="Launch actions"]');
  assert.ok(actions);

  act(() => actions.click());
  act(() => item("Edit section").click());
  await settleLoaded();

  assert.equal(dialogField("Any emoji").value, "🫩");
});
