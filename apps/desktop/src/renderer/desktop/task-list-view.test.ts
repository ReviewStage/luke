// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CODING_AGENT_STATUS, type TasklessAgent } from "@luke/features/coding-agent-wire";
import type { TaskSummary } from "@luke/features/task-wire";
import type { Workspace, WorkspaceMember } from "@luke/features/workspace-wire";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act, type ActOutcome } from "@luke/host/acts";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { fakeAppBridge } from "#testing/app-bridge";
import { copyingInto, fakeAppPlatform, QUIET_PANEL } from "#testing/app-platform";
import { onRegistry } from "#testing/copy-feedback";
import { sidebarProps } from "#testing/desktop-sidebar";
import { tasksControl } from "#testing/tasks-control";
import { newestToastSays } from "#testing/toast";
import { appCommandOffered, runAppCommand } from "../app-commands";
import { ToastHost } from "../toast";
import { DesktopSidebar } from "./desktop-sidebar";
import { SIDEBAR_OVERLAY } from "./sidebar-collapse";

/**
 * task-list-view.test.ts -- the sidebar's Tasks section groups, orders,
 * and filters its tasks as its View options say, each row saying what its
 * group does not, the pins standing apart in a section of their own, and
 * each workspace keeping its own view on this Mac.
 */

const DEAN = "user-dean";
const CHARLES = "user-charles";

const ACME = {
  id: "workspace-acme",
  name: "Acme",
  role: "owner",
  github: null,
  memberCount: 3,
} as const satisfies Workspace;

const PERSONAL = { ...ACME, id: "workspace-personal", name: "Dean", memberCount: 1 };

const MEMBERS: readonly WorkspaceMember[] = [
  { userId: DEAN, name: "Dean Stratakos", email: "dean@acme.dev", role: "owner" },
  { userId: CHARLES, name: "Charles Pan", email: "charles@acme.dev", role: "member" },
  { userId: "user-maya", name: "Maya Okafor", email: "maya@acme.dev", role: "member" },
];

/** The Tasks section, named for the tasks or for the archived ones it stands turned to. */
const TASK_LIST = 'nav:is([aria-label="Tasks"], [aria-label="Archived tasks"])';

const roots: Root[] = [];

beforeEach(() => {
  openedAgents = [];
  copied = [];
  fakeAppPlatform({ ...QUIET_PANEL, ...copyingInto(copied) });
  pinsAsked = [];
  window.localStorage.clear();
  window.sessionStorage.clear();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
  fakeAppBridge({
    act: (request: Act): Promise<ActOutcome> => {
      return Promise.resolve(
        request.kind === ACT_KIND.WORKSPACE_MEMBERS_READ
          ? { status: ACT_OUTCOME_STATUS.DONE, value: MEMBERS }
          : { status: ACT_OUTCOME_STATUS.REFUSED, reason: "Not here." },
      );
    },
  });
});

afterEach(() => {
  unmountAll();
  document.body.innerHTML = "";
});

function unmountAll(): void {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
}

/** A task of the workspace's, by `creator`, on `repository`. */
function task(
  id: string,
  name: string,
  repository: string | null,
  creator: string,
  times: { createdAt: number; updatedAt: number } = { createdAt: 1, updatedAt: 2 },
  pinnedAt?: number,
): TaskSummary {
  return {
    id,
    workspaceId: ACME.id,
    name,
    repository,
    ...times,
    ownerId: creator,
    createdBy: { userId: creator, name: creator === DEAN ? "Dean Stratakos" : "Charles Pan" },
    ...(pinnedAt === undefined ? undefined : { pinnedAt }),
  };
}

const TASKS = [
  task("t-1", "Retry webhooks", "acme/relay", DEAN, { createdAt: 10, updatedAt: 500 }),
  task("t-2", "Fix flaky deploy", "acme/relay", CHARLES, { createdAt: 30, updatedAt: 400 }),
  task("t-3", "Billing empty states", "acme/console", CHARLES, { createdAt: 20, updatedAt: 600 }),
  task("t-4", "Release checklist", "acme/relay", DEAN, { createdAt: 5, updatedAt: 5 }, 900),
];

const ARCHIVED = [
  { ...task("t-9", "Spike: edge caching", "acme/relay", CHARLES), archivedAt: 50 },
  {
    ...task("t-8", "Old dashboard charts", "acme/console", DEAN, { createdAt: 1, updatedAt: 9 }),
    archivedAt: 40,
  },
];

/** An agent an automation of `starter`'s started with no task, on `repository`, last moving at `activityAt`. */
function oneOff(
  id: string,
  title: string,
  repository: string,
  starter: string,
  activityAt: number,
  archivedAt?: number,
): TasklessAgent {
  return {
    id,
    planId: null,
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    title,
    createdAt: 1,
    status: CODING_AGENT_STATUS.COMPLETED,
    turnId: null,
    startedBy: { userId: starter, name: starter === DEAN ? "Dean Stratakos" : "Charles Pan" },
    automationId: "5a0c4d2e-8f1b-4c3a-9e7d-2b6f1a8c9d04",
    automationName: "Morning Sentry triage",
    workspaceId: ACME.id,
    repository,
    activityAt,
    ...(archivedAt === undefined ? undefined : { archivedAt }),
  };
}

/** The agents' pages the sidebar opened, in order. */
let openedAgents: string[] = [];

/** What the window copied, in order. */
let copied: string[] = [];

/** Each agent's pin the sidebar asked for, in order, as `agentId:pinned`. */
let pinsAsked: string[] = [];

/** The sidebar listing `plans`, and `archived` archived, in `workspace`, read by Dean, with `agents` among them and the page of `agentShown` standing. */
function mountSidebar(
  workspace: Workspace,
  plans: readonly TaskSummary[] = TASKS,
  archived: readonly TaskSummary[] = ARCHIVED,
  agents: readonly TasklessAgent[] = [],
  agentShown?: string,
): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const control = tasksControl({
    tasks: [...plans],
    archived: [...archived],
    workspace,
    workspaces: [workspace],
    me: DEAN,
    listedAgents: {
      standing: agents.filter((agent) => agent.archivedAt === undefined),
      archived: agents.filter((agent) => agent.archivedAt !== undefined),
    },
    agentView: {
      agentId: agentShown,
      onOpen: (agentId) => openedAgents.push(agentId),
      onClose: () => undefined,
    },
    onPinAgent: (agentId, pinned) => pinsAsked.push(`${agentId}:${String(pinned)}`),
  });
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(
          Fragment,
          null,
          createElement(DesktopSidebar, sidebarProps(control)),
          createElement(ToastHost),
        ),
      ),
    ),
  );
  return container;
}

/** The words each standing menu item says, its glyph left out. */
function itemLabel(item: HTMLElement): string {
  return (item.querySelector(".luke-menu-item-label") ?? item).textContent?.trim() ?? "";
}

/** The menu item that says `label`, in whichever menu stands. */
function menuItem(label: string): HTMLElement {
  const items = [
    ...document.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemcheckbox"]'),
  ];
  const found = items.find((item) => itemLabel(item) === label);
  assert.ok(found, `a menu item named ${label} stands among ${items.map(itemLabel).join(", ")}`);
  return found;
}

/** Chooses `choice` under `submenu` in the Tasks head's View options. */
function choose(sidebar: HTMLElement, submenu: string, choice: string): void {
  const button = sidebar.querySelector<HTMLButtonElement>('button[aria-label="View options"]');
  assert.ok(button, "the Tasks head offers View options");
  act(() => button.click());
  act(() => menuItem(submenu).click());
  act(() => menuItem(choice).click());
}

/** The first of a button's words a reader hears: a row's or a fold's name, before its count and its chord. */
function heardName(button: Element): string {
  const heard = [...button.children].find((part) => part.getAttribute("aria-hidden") !== "true");
  return heard?.textContent ?? "";
}

/** The Tasks section's group headers, in order. */
function groupNames(sidebar: HTMLElement): string[] {
  const tasks = sidebar.querySelector(TASK_LIST);
  assert.ok(tasks, "the Tasks section stands");
  return [
    ...tasks.querySelectorAll(
      ".sidebar-repository-header button[aria-expanded]:not([aria-haspopup])",
    ),
  ].map(heardName);
}

/** The rows of the Tasks section: each name, the repository it says, and whether it wears a face. */
function taskRows(
  sidebar: HTMLElement,
): { name: string; repository: string | undefined; face: boolean }[] {
  const tasks = sidebar.querySelector(TASK_LIST);
  assert.ok(tasks, "the Tasks section stands");
  return [...tasks.querySelectorAll(".sidebar-task")].map((row) => ({
    name: row.querySelector(".sidebar-task-name")?.textContent ?? "",
    repository: row.querySelector(".sidebar-task-repository")?.textContent ?? undefined,
    face: row.querySelector(".actor-mark") !== null,
  }));
}

test("a shared workspace's tasks group by repository until View options groups them by creator, yours first, each row wearing no face and naming no repository, which its card names", () => {
  const sidebar = mountSidebar(ACME);
  assert.deepEqual(groupNames(sidebar), ["console", "relay"]);
  assert.deepEqual(
    taskRows(sidebar).map((row) => [row.name, row.face]),
    [
      ["Billing empty states", true],
      ["Retry webhooks", false],
      ["Fix flaky deploy", true],
    ],
  );

  choose(sidebar, "Group by", "Creator");
  assert.deepEqual(groupNames(sidebar), ["You", "Charles Pan"]);
  assert.deepEqual(taskRows(sidebar), [
    { name: "Retry webhooks", repository: undefined, face: false },
    { name: "Billing empty states", repository: undefined, face: false },
    { name: "Fix flaky deploy", repository: undefined, face: false },
  ]);
  const row = [...sidebar.querySelectorAll(`${TASK_LIST} .sidebar-task`)].find(
    (each) => each.querySelector(".sidebar-task-name")?.textContent === "Billing empty states",
  );
  assert.ok(row, "the task has a row");
  act(() => {
    row.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });
  assert.match(document.querySelector(".luke-tooltip-card")?.textContent ?? "", /acme\/console/);
});

test("grouped by none, the tasks run in one list, each row naming its repository and a teammate's wearing their face", () => {
  const sidebar = mountSidebar(ACME);
  choose(sidebar, "Group by", "None");
  assert.deepEqual(groupNames(sidebar), []);
  assert.deepEqual(taskRows(sidebar), [
    { name: "Billing empty states", repository: "console", face: true },
    { name: "Retry webhooks", repository: "relay", face: false },
    { name: "Fix flaky deploy", repository: "relay", face: true },
  ]);
});

test("ordered by Created, the tasks run newest started first and each row shows when it was started", () => {
  const sidebar = mountSidebar(ACME);
  choose(sidebar, "Group by", "None");
  choose(sidebar, "Order by", "Created");
  assert.deepEqual(
    taskRows(sidebar).map((row) => row.name),
    ["Fix flaky deploy", "Billing empty states", "Retry webhooks"],
  );
  const times = [...sidebar.querySelectorAll(`${TASK_LIST} .sidebar-task time`)];
  assert.deepEqual(
    times.map((time) => time.getAttribute("datetime")),
    [30, 20, 10].map((at) => new Date(at).toISOString()),
  );
});

test("the pins stand in a section of their own above Tasks, whatever the view groups by", () => {
  const sidebar = mountSidebar(ACME);
  choose(sidebar, "Group by", "Creator");
  const pinned = sidebar.querySelector('nav[aria-label="Pinned"]');
  assert.deepEqual(
    [...(pinned?.querySelectorAll(".sidebar-task-name") ?? [])].map((name) => name.textContent),
    ["Release checklist"],
  );
  assert.ok(
    !taskRows(sidebar).some((row) => row.name === "Release checklist"),
    "a pinned task is not listed again under Tasks",
  );
});

test("each workspace keeps its own view on this Mac across launches", () => {
  choose(mountSidebar(ACME), "Group by", "Creator");
  unmountAll();

  assert.deepEqual(groupNames(mountSidebar(ACME)), ["You", "Charles Pan"]);
  unmountAll();
  const other = { ...ACME, id: "workspace-other", name: "Other" };
  const elsewhere = TASKS.map((each) => ({ ...each, workspaceId: other.id }));
  assert.deepEqual(groupNames(mountSidebar(other, elsewhere)), ["console", "relay"]);
});

test("a workspace nobody shares offers no grouping by creator", () => {
  const sidebar = mountSidebar(PERSONAL);
  const button = sidebar.querySelector<HTMLButtonElement>('button[aria-label="View options"]');
  assert.ok(button, "the Tasks head offers View options");
  act(() => button.click());
  act(() => menuItem("Group by").click());
  const menus = [...document.querySelectorAll('[role="menu"]')];
  const groupBy = menus.at(-1);
  assert.ok(groupBy, "Group by's submenu stands");
  const choices = [...groupBy.querySelectorAll('[role="menuitemcheckbox"]')].map(
    (item) => item.textContent,
  );
  assert.deepEqual(choices, ["Repository", "None"]);
});

/** The sidebar once the workspace's members have answered. */
async function mountRead(
  workspace: Workspace,
  plans?: readonly TaskSummary[],
  archived?: readonly TaskSummary[],
  agents?: readonly TasklessAgent[],
): Promise<HTMLElement> {
  const sidebar = mountSidebar(workspace, plans, archived, agents);
  await act(async () => undefined);
  return sidebar;
}

/** The chip under the Tasks head, if one stands. */
function chip(sidebar: HTMLElement): HTMLElement | null {
  return sidebar.querySelector<HTMLElement>(".sidebar-view-chips > *");
}

/** What the chip under the Tasks head says, its face left out. */
function chipWords(sidebar: HTMLElement): string | undefined {
  return chip(sidebar)?.querySelector(".luke-chip-name")?.textContent ?? undefined;
}

test("Created by › Me lists only your tasks, wearing no faces, says so in a chip and a dot, and the chip's × lists everyone's again", async () => {
  const pinnedTheirs = task("t-5", "Onboarding rewrite", "acme/console", CHARLES, undefined, 950);
  const sidebar = await mountRead(ACME, [...TASKS, pinnedTheirs]);
  choose(sidebar, "Created by", "Me");

  assert.deepEqual(taskRows(sidebar), [
    { name: "Retry webhooks", repository: undefined, face: false },
  ]);
  assert.equal(chipWords(sidebar), "Created by me");
  const options = sidebar.querySelector('button[aria-label="View options"]');
  assert.equal(options?.getAttribute("aria-description"), "Filtered");
  const pinned = sidebar.querySelector('nav[aria-label="Pinned"]');
  assert.deepEqual(
    [...(pinned?.querySelectorAll(".sidebar-task-name") ?? [])].map((name) => name.textContent),
    ["Onboarding rewrite", "Release checklist"],
    "the pins stand unfiltered",
  );

  const clear = chip(sidebar)?.querySelector("button");
  assert.ok(clear, "the chip offers its ×");
  act(() => clear.click());
  assert.equal(chip(sidebar), null);
  assert.equal(options?.getAttribute("aria-description"), null);
  assert.equal(taskRows(sidebar).length, 3);
});

test("Created by a teammate lists only theirs, named in the chip, and the choice is the workspace's to keep", async () => {
  choose(await mountRead(ACME), "Created by", "Charles Pan");
  unmountAll();

  const sidebar = await mountRead(ACME);
  assert.deepEqual(
    taskRows(sidebar).map((row) => row.name),
    ["Billing empty states", "Fix flaky deploy"],
  );
  assert.equal(chipWords(sidebar), "Created by Charles Pan");
});

test("a filter that leaves nothing says so, and Show all lists everyone's again", async () => {
  const theirs = TASKS.filter((each) => each.createdBy?.userId === CHARLES);
  const sidebar = await mountRead(ACME, theirs);
  choose(sidebar, "Created by", "Me");
  assert.equal(taskRows(sidebar).length, 0);
  const note = [...sidebar.querySelectorAll(".sidebar-note")].find((each) =>
    each.textContent?.startsWith("None of your tasks here."),
  );
  const showAll = note?.querySelector("button");
  assert.ok(showAll, "the note offers Show all");
  act(() => showAll.click());
  assert.equal(taskRows(sidebar).length, 2);
});

test("a workspace nobody shares offers no Created by", async () => {
  const sidebar = await mountRead(PERSONAL);
  const button = sidebar.querySelector<HTMLButtonElement>('button[aria-label="View options"]');
  assert.ok(button, "the Tasks head offers View options");
  act(() => button.click());
  const items = [...document.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent);
  assert.ok(!items.some((item) => item?.startsWith("Created by")), "no Created by is offered");
});

test("with every task pinned, a filter still says it leaves nothing under Tasks, with Show all", async () => {
  const pinnedAll = TASKS.map((each, at) => ({ ...each, pinnedAt: 900 + at }));
  const sidebar = await mountRead(ACME, pinnedAll);
  choose(sidebar, "Created by", "Charles Pan");
  const notes = [...sidebar.querySelectorAll(".sidebar-note")].map((note) => note.textContent);
  assert.ok(
    notes.some((note) => note?.startsWith("None of their tasks here.")),
    "the empty filter says so",
  );
});

test("a workspace whose list names no member count still groups and filters by creator once its members are read", async () => {
  const { memberCount: _, ...uncounted } = ACME;
  const sidebar = await mountRead(uncounted);
  choose(sidebar, "Group by", "Creator");
  assert.deepEqual(groupNames(sidebar), ["You", "Charles Pan"]);
});

test("in one run, a task with no repository says so on its row", async () => {
  const notes = task("t-6", "Hiring loop notes", null, CHARLES, { createdAt: 1, updatedAt: 700 });
  const sidebar = await mountRead(ACME, [...TASKS, notes]);
  choose(sidebar, "Group by", "None");
  assert.deepEqual(taskRows(sidebar)[0], {
    name: "Hiring loop notes",
    repository: "No repository",
    face: true,
  });
});

test("an empty workspace under a filter says only that it holds no tasks", async () => {
  const sidebar = await mountRead(ACME, [], []);
  choose(sidebar, "Created by", "Me");
  const notes = [...sidebar.querySelectorAll(".sidebar-note")].map((note) => note.textContent);
  assert.deepEqual(notes, ["No tasks yet."]);
});

/** The Tasks section's head, as it names the section. */
function headName(sidebar: HTMLElement): string | undefined {
  const head = sidebar.querySelector(`${TASK_LIST} .sidebar-section-head > :first-child`);
  if (head?.matches("button") !== true) return head?.textContent ?? undefined;
  return heardName(head);
}

/** Turns the Tasks section to the archived tasks, or back, from View options. */
function toggleArchived(sidebar: HTMLElement): void {
  const button = sidebar.querySelector<HTMLButtonElement>('button[aria-label="View options"]');
  assert.ok(button, "the Tasks head offers View options");
  act(() => button.click());
  act(() => menuItem("Archived tasks").click());
}

test("the archived tasks stand in no group at the list's foot, and View options turns the section to them, the pins aside, a chip leading back", async () => {
  const sidebar = await mountRead(ACME);
  assert.ok(
    !taskRows(sidebar).some((row) => row.name === "Spike: edge caching"),
    "an archived task stands nowhere in the list",
  );
  assert.equal(groupNames(sidebar).includes("Archived"), false);

  toggleArchived(sidebar);
  assert.equal(headName(sidebar), "Archived tasks");
  assert.deepEqual(
    taskRows(sidebar).map((row) => row.name),
    ["Old dashboard charts", "Spike: edge caching"],
  );
  assert.equal(sidebar.querySelector('nav[aria-label="Pinned"]'), null, "the pins stand aside");
  assert.equal(chipWords(sidebar), "Archived");
  const options = sidebar.querySelector('button[aria-label="View options"]');
  assert.equal(options?.getAttribute("aria-description"), "Filtered");

  const back = chip(sidebar)?.querySelector("button");
  assert.ok(back, "the chip offers its ×");
  act(() => back.click());
  assert.equal(headName(sidebar), "Tasks");
  assert.ok(sidebar.querySelector('nav[aria-label="Pinned"]'), "the pins are back");
});

test("the archived view filters by creator as the list does, and is not kept for the next launch", async () => {
  const sidebar = await mountRead(ACME);
  choose(sidebar, "Created by", "Me");
  toggleArchived(sidebar);
  assert.deepEqual(
    taskRows(sidebar).map((row) => row.name),
    ["Old dashboard charts"],
  );
  unmountAll();
  // A launch opens a window with nothing held for its session.
  window.sessionStorage.clear();

  const relaunched = await mountRead(ACME);
  assert.equal(headName(relaunched), "Tasks");
  assert.equal(
    chipWords(relaunched),
    "Created by me",
    "the creator filter is kept, the archive not",
  );
});

test("with nothing archived, the archived view says so", async () => {
  const sidebar = await mountRead(ACME, TASKS, []);
  toggleArchived(sidebar);
  const notes = [...sidebar.querySelectorAll(".sidebar-note")].map((note) => note.textContent);
  assert.ok(notes.includes("No archived tasks."), "the empty archive says so");
});

test("choosing another workspace lets go of the archived view, so coming back opens on the tasks", async () => {
  const other = { ...ACME, id: "workspace-other", name: "Other" };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const listed = (workspace: Workspace) =>
    onRegistry(
      AtomRegistry.make(),
      createElement(
        DesktopSidebar,
        sidebarProps(
          tasksControl({
            tasks: [...TASKS],
            archived: [...ARCHIVED],
            workspace,
            workspaces: [ACME, other],
            me: DEAN,
          }),
        ),
      ),
    );
  const registry = AtomRegistry.make();
  const draw = (workspace: Workspace) =>
    act(() => root.render(onRegistry(registry, listed(workspace))));
  draw(ACME);
  await act(async () => undefined);
  toggleArchived(container);
  assert.equal(headName(container), "Archived tasks");

  draw(other);
  assert.equal(headName(container), "Tasks");
  draw(ACME);
  assert.equal(headName(container), "Tasks");
});

test("a repository's menu among the archived tasks offers no Archive", async () => {
  const sidebar = await mountRead(ACME);
  toggleArchived(sidebar);
  const ellipsis = sidebar.querySelector<HTMLButtonElement>(
    'button[aria-label="Actions for relay"]',
  );
  assert.ok(ellipsis, "the group offers its actions");
  act(() => ellipsis.click());
  const menu = document.querySelector('[role="menu"][aria-label="relay actions"]');
  assert.deepEqual(
    [...(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])].map(itemLabel),
    ["Pin", "Open on GitHub"],
  );
});

test("before the list is first read, the archived view says nothing of being empty", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const control = tasksControl({ workspace: ACME, workspaces: [ACME], me: DEAN, listRead: false });
  act(() =>
    root.render(
      onRegistry(AtomRegistry.make(), createElement(DesktopSidebar, sidebarProps(control))),
    ),
  );
  toggleArchived(container);
  const notes = [...container.querySelectorAll(".sidebar-note")].map((note) => note.textContent);
  assert.ok(!notes.includes("No archived tasks."), "nothing is said before the read");
  assert.ok(!notes.includes("No tasks yet."), "nor that no task stands");
});

test("with every task archived, the list says so and offers the archived tasks", async () => {
  const sidebar = await mountRead(ACME, [], ARCHIVED);
  const note = [...sidebar.querySelectorAll(".sidebar-note")].find((each) =>
    each.textContent?.startsWith("Every task is archived."),
  );
  const show = note?.querySelector("button");
  assert.ok(show, "the note offers Show archived");
  act(() => show.click());
  assert.equal(headName(sidebar), "Archived tasks");
});

test("⌘K offers each view choice only while it would change the list, and running one changes it as the menu would", async () => {
  const sidebar = await mountRead(ACME);
  assert.equal(appCommandOffered(APP_COMMAND.GROUP_TASKS_BY_REPOSITORY), false);
  assert.equal(appCommandOffered(APP_COMMAND.SHOW_EVERYONES_TASKS), false);
  assert.equal(appCommandOffered(APP_COMMAND.HIDE_ARCHIVED_TASKS), false);

  act(() => {
    runAppCommand(APP_COMMAND.GROUP_TASKS_BY_CREATOR);
  });
  assert.deepEqual(groupNames(sidebar), ["You", "Charles Pan"]);
  assert.equal(appCommandOffered(APP_COMMAND.GROUP_TASKS_BY_CREATOR), false);
  assert.equal(appCommandOffered(APP_COMMAND.GROUP_TASKS_BY_REPOSITORY), true);

  act(() => {
    runAppCommand(APP_COMMAND.SHOW_MY_TASKS);
  });
  assert.equal(chipWords(sidebar), "Created by me");
  assert.equal(appCommandOffered(APP_COMMAND.SHOW_EVERYONES_TASKS), true);

  act(() => {
    runAppCommand(APP_COMMAND.SHOW_ARCHIVED_TASKS);
  });
  assert.equal(headName(sidebar), "Archived tasks");
  assert.equal(appCommandOffered(APP_COMMAND.HIDE_ARCHIVED_TASKS), true);
});

test("a workspace nobody shares offers ⌘K no grouping or filtering by creator", async () => {
  await mountRead(PERSONAL);
  assert.equal(appCommandOffered(APP_COMMAND.GROUP_TASKS_BY_CREATOR), false);
  assert.equal(appCommandOffered(APP_COMMAND.SHOW_MY_TASKS), false);
  assert.equal(appCommandOffered(APP_COMMAND.LIST_TASKS_UNGROUPED), true);
});

test("a creator grouping kept for a workspace nobody shares now reads as by repository, so ⌘K offers no grouping it already draws", async () => {
  window.localStorage.setItem(
    "luke.sidebarTaskViews",
    JSON.stringify({ [PERSONAL.id]: { grouping: "creator", order: "updated" } }),
  );
  const sidebar = await mountRead(PERSONAL);
  assert.deepEqual(groupNames(sidebar), ["console", "relay"]);
  assert.equal(appCommandOffered(APP_COMMAND.GROUP_TASKS_BY_REPOSITORY), false);
  assert.equal(appCommandOffered(APP_COMMAND.LIST_TASKS_UNGROUPED), true);
});

test("the sidebar stepping aside for Settings and coming back finds the archived view as it was, named so to a screen reader", async () => {
  toggleArchived(await mountRead(ACME));
  unmountAll();

  const back = await mountRead(ACME);
  assert.equal(headName(back), "Archived tasks");
  assert.ok(
    back.querySelector('nav[aria-label="Archived tasks"]'),
    "the list is named for the archive",
  );
});

const TRIAGE = oneOff("a-1", "Triage overnight issues", "acme/relay", DEAN, 550);
const SWEEP = oneOff("a-2", "Sweep flaky tests", "acme/console", CHARLES, 100);

test("a one-off agent stands among its repository's tasks by its last activity, led by its harness mark and ending with its automation's clock, and a press opens its page", () => {
  const sidebar = mountSidebar(ACME, TASKS, ARCHIVED, [TRIAGE, SWEEP]);
  assert.deepEqual(groupNames(sidebar), ["console", "relay"]);
  assert.deepEqual(
    taskRows(sidebar).map((row) => row.name),
    [
      "Billing empty states",
      "Sweep flaky tests",
      "Triage overnight issues",
      "Retry webhooks",
      "Fix flaky deploy",
    ],
  );
  const row = [...sidebar.querySelectorAll<HTMLButtonElement>(".sidebar-agent")].find(
    (each) => each.textContent?.includes("Triage overnight issues") === true,
  );
  assert.ok(row, "the agent's row stands");
  assert.ok(row.querySelector(".sidebar-agent-glyph svg"), "it leads with its harness mark");
  assert.ok(row.querySelector(".sidebar-task-time .actor-mark"), "it ends with its starter");

  act(() => row.click());
  assert.deepEqual(openedAgents, ["a-1"]);
});

test("grouped by creator a one-off agent stands under whoever started it, and Created by filters it as a task", async () => {
  const sidebar = await mountRead(ACME, TASKS, ARCHIVED, [TRIAGE, SWEEP]);
  choose(sidebar, "Group by", "Creator");
  assert.deepEqual(groupNames(sidebar), ["You", "Charles Pan"]);
  assert.deepEqual(
    taskRows(sidebar).map((row) => row.name),
    [
      "Triage overnight issues",
      "Retry webhooks",
      "Billing empty states",
      "Fix flaky deploy",
      "Sweep flaky tests",
    ],
  );

  choose(sidebar, "Created by", "Me");
  assert.deepEqual(
    taskRows(sidebar).map((row) => row.name),
    ["Triage overnight issues", "Retry webhooks"],
  );
});

test("an archived one-off agent stands only in the archived view, among the archived tasks", async () => {
  const shelved = oneOff("a-3", "Digest of open pull requests", "acme/relay", DEAN, 45, 60);
  const sidebar = await mountRead(ACME, TASKS, ARCHIVED, [TRIAGE, shelved]);
  assert.ok(!taskRows(sidebar).some((row) => row.name === "Digest of open pull requests"));

  toggleArchived(sidebar);
  assert.deepEqual(
    taskRows(sidebar).map((row) => row.name),
    ["Digest of open pull requests", "Spike: edge caching", "Old dashboard charts"],
  );
});

test("the agent whose page stands is the row the sidebar marks", () => {
  const sidebar = mountSidebar(ACME, TASKS, ARCHIVED, [TRIAGE], "a-1");
  const marked = [...sidebar.querySelectorAll('[aria-current="page"]')].map(
    (row) => row.querySelector(".sidebar-task-name")?.textContent,
  );
  assert.deepEqual(marked, ["Triage overnight issues"]);
});

test("with every task archived but a one-off agent standing, the list holds the agent and says nothing of every task being archived", async () => {
  const sidebar = await mountRead(ACME, [], ARCHIVED, [TRIAGE]);
  assert.deepEqual(
    taskRows(sidebar).map((row) => row.name),
    ["Triage overnight issues"],
  );
  const notes = [...sidebar.querySelectorAll(".sidebar-note")].map((note) => note.textContent);
  assert.ok(!notes.some((note) => note?.startsWith("Every task is archived")), notes.join(" | "));
});

test("a one-off agent's row offers Copy link on a right-click, copying the agent's link under its workspace, and says Link copied", async () => {
  const sidebar = await mountRead({ ...ACME, slug: "acme" }, TASKS, ARCHIVED, [TRIAGE]);
  const row = [...sidebar.querySelectorAll<HTMLButtonElement>(".sidebar-agent")].find(
    (each) => each.textContent?.includes("Triage overnight issues") === true,
  );
  assert.ok(row, "the agent's row stands");
  act(() => {
    row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  });
  await act(async () => menuItem("Copy link").click());

  assert.deepEqual(copied, ["https://tryluke.dev/acme/agent/a-1"]);
  assert.equal(newestToastSays(), "Link copied");
});

test("a one-off agent's menu goes with a floating sidebar as it is put away", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const registry = AtomRegistry.make();
  const props = sidebarProps(
    tasksControl({
      tasks: [...TASKS],
      workspace: { ...ACME, slug: "acme" },
      workspaces: [{ ...ACME, slug: "acme" }],
      me: DEAN,
      listedAgents: { standing: [TRIAGE], archived: [] },
    }),
  );
  const float = (overlay: (typeof SIDEBAR_OVERLAY)[keyof typeof SIDEBAR_OVERLAY]) =>
    act(() =>
      root.render(
        onRegistry(
          registry,
          createElement(DesktopSidebar, {
            ...props,
            sidebar: { ...props.sidebar, collapsed: true, overlay },
          }),
        ),
      ),
    );
  float(SIDEBAR_OVERLAY.OPEN);
  await act(async () => undefined);
  const row = container.querySelector<HTMLButtonElement>(".sidebar-agent");
  assert.ok(row, "the agent's row stands");
  act(() => {
    row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  });
  const opened = document.querySelectorAll('[role="menuitem"]').length;

  float(SIDEBAR_OVERLAY.CLOSED);

  assert.equal(opened, 2);
  assert.equal(document.querySelectorAll('[role="menuitem"]').length, 0);
});

/** The menu a right-click on the agent's row named `title` opens, by its items' words. */
function agentMenu(sidebar: HTMLElement, title: string): string[] {
  const row = [...sidebar.querySelectorAll<HTMLButtonElement>(".sidebar-agent")].find(
    (each) => each.textContent?.includes(title) === true,
  );
  assert.ok(row, `the row of ${title} stands`);
  act(() => {
    row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  });
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].map(itemLabel);
}

test("a pinned one-off agent stands under Pinned beside the pinned tasks, newest pinned first, and not among its repository's tasks", () => {
  const pinned = { ...TRIAGE, pinnedAt: 950 };
  const sidebar = mountSidebar(ACME, TASKS, ARCHIVED, [pinned, SWEEP]);
  const section = sidebar.querySelector('nav[aria-label="Pinned"]');
  assert.deepEqual(
    [...(section?.querySelectorAll(".sidebar-task-name") ?? [])].map((name) => name.textContent),
    ["Triage overnight issues", "Release checklist"],
  );
  assert.ok(section?.querySelector(".sidebar-agent .sidebar-agent-glyph svg"), "it wears its mark");
  assert.ok(
    !taskRows(sidebar).some((row) => row.name === "Triage overnight issues"),
    "a pinned agent is not listed again under Tasks",
  );
  assert.ok(taskRows(sidebar).some((row) => row.name === "Sweep flaky tests"));
});

test("a one-off agent's row offers Pin after Copy link, Unpin once pinned, and an archived one offers no pin", async () => {
  const shelved = oneOff("a-3", "Digest of open pull requests", "acme/relay", DEAN, 45, 60);
  const sidebar = await mountRead({ ...ACME, slug: "acme" }, TASKS, ARCHIVED, [
    TRIAGE,
    { ...SWEEP, pinnedAt: 950 },
    shelved,
  ]);

  assert.deepEqual(agentMenu(sidebar, "Triage overnight issues"), ["Copy link", "Pin"]);
  await act(async () => menuItem("Pin").click());
  assert.deepEqual(agentMenu(sidebar, "Sweep flaky tests"), ["Copy link", "Unpin"]);
  await act(async () => menuItem("Unpin").click());
  assert.deepEqual(pinsAsked, ["a-1:true", "a-2:false"]);

  toggleArchived(sidebar);
  assert.deepEqual(agentMenu(sidebar, "Digest of open pull requests"), ["Copy link"]);
});
