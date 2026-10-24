// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CODING_AGENT_STATUS, type TasklessAgent } from "@luke/features/coding-agent-wire";
import { TASK_STATUS, type TaskStatus, type TaskSummary } from "@luke/features/task-wire";
import type { Workspace, WorkspaceMember } from "@luke/features/workspace-wire";
import { ACT_KIND } from "@luke/host/acts";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { appCommandOffered, runAppCommand } from "../app-commands.js";
import { fakeActPort, fakeAppBridge } from "../testing/app-bridge.js";
import { copyingInto, fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { sidebarProps } from "../testing/desktop-sidebar.js";
import { restOn } from "../testing/hint-rest.js";
import { tasksControl } from "../testing/tasks-control.js";
import { newestToastSays } from "../testing/toast.js";
import { ToastHost } from "../toast.js";
import { DesktopSidebar } from "./desktop-sidebar.js";
import { SIDEBAR_OVERLAY } from "./sidebar-collapse.js";

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

/** The Tasks section. */
const TASK_LIST = 'nav[aria-label="Tasks"]';

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
  fakeAppBridge({});
  fakeActPort({ [ACT_KIND.WORKSPACE_MEMBERS_READ]: () => Promise.resolve(MEMBERS) });
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

/** `TASKS` with Dean on Fix flaky deploy and Charles on Retry webhooks, Billing empty states with no one on it. */
const ASSIGNED = TASKS.map((each) =>
  each.id === "t-2"
    ? { ...each, assignee: { userId: DEAN, name: "Dean Stratakos" } }
    : each.id === "t-1"
      ? { ...each, assignee: { userId: CHARLES, name: "Charles Pan" } }
      : each,
);

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

/** The sidebar listing `plans` in `workspace`, read by Dean, with `agents` among them and the page of `agentShown` standing. */
function mountSidebar(
  workspace: Workspace,
  tasks: readonly TaskSummary[] = TASKS,
  agents: readonly TasklessAgent[] = [],
  agentShown?: string,
): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const control = tasksControl({
    tasks: [...tasks],
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
    ...tasks.querySelectorAll(".luke-group-header-head button[aria-expanded]:not([aria-haspopup])"),
  ].map(heardName);
}

/** The rows of the Tasks section: each name, the repository it says, and whether it wears a face. */
function taskRows(
  sidebar: HTMLElement,
): { name: string; repository: string | undefined; face: boolean }[] {
  const tasks = sidebar.querySelector(TASK_LIST);
  assert.ok(tasks, "the Tasks section stands");
  return [...tasks.querySelectorAll(".sidebar-tasks > li > button")].map((row) => ({
    name: row.querySelector(".luke-list-row-title")?.firstChild?.textContent ?? "",
    repository: row.querySelector(".sidebar-task-repository")?.textContent ?? undefined,
    face: row.querySelector(".actor-mark") !== null,
  }));
}

test("a shared workspace's tasks group by repository until View options groups them by creator, yours first, each row wearing who is on it and naming no repository, which its card names", () => {
  const sidebar = mountSidebar(ACME);
  assert.deepEqual(groupNames(sidebar), ["console", "relay"]);

  choose(sidebar, "Group by", "Creator");
  assert.deepEqual(groupNames(sidebar), ["You", "Charles Pan"]);
  // No one is on any of them, which each row's unassigned mark says.
  assert.deepEqual(taskRows(sidebar), [
    { name: "Retry webhooks", repository: undefined, face: true },
    { name: "Billing empty states", repository: undefined, face: true },
    { name: "Fix flaky deploy", repository: undefined, face: true },
  ]);
  const row = [...sidebar.querySelectorAll(`${TASK_LIST} .sidebar-tasks > li > button`)].find(
    (each) =>
      each.querySelector(".luke-list-row-title")?.firstChild?.textContent ===
      "Billing empty states",
  );
  assert.ok(row, "the task has a row");
  restOn(row);
  assert.match(document.querySelector(".luke-tooltip-card")?.textContent ?? "", /acme\/console/);
});

test("grouped by none, the tasks run in one list, each row naming its repository and wearing who is on it", () => {
  const sidebar = mountSidebar(ACME, ASSIGNED);
  choose(sidebar, "Group by", "None");
  assert.deepEqual(groupNames(sidebar), []);
  assert.deepEqual(taskRows(sidebar), [
    { name: "Billing empty states", repository: "console", face: true },
    { name: "Retry webhooks", repository: "relay", face: true },
    { name: "Fix flaky deploy", repository: "relay", face: false },
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
  const times = [...sidebar.querySelectorAll(`${TASK_LIST} .sidebar-tasks > li > button time`)];
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
    [...(pinned?.querySelectorAll(".luke-list-row-title") ?? [])].map(
      (name) => name.firstChild?.textContent,
    ),
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
  tasks?: readonly TaskSummary[],
  agents?: readonly TasklessAgent[],
): Promise<HTMLElement> {
  const sidebar = mountSidebar(workspace, tasks, agents);
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

test("Created by › Me lists only your tasks, says so in a chip and a dot, and the chip's × lists everyone's again", async () => {
  const pinnedTheirs = task("t-5", "Onboarding rewrite", "acme/console", CHARLES, undefined, 950);
  const sidebar = await mountRead(ACME, [...TASKS, pinnedTheirs]);
  choose(sidebar, "Created by", "Me");

  assert.deepEqual(taskRows(sidebar), [
    { name: "Retry webhooks", repository: undefined, face: true },
  ]);
  assert.equal(chipWords(sidebar), "Created by me");
  const options = sidebar.querySelector('button[aria-label="View options"]');
  assert.equal(options?.getAttribute("aria-description"), "Filtered");
  const pinned = sidebar.querySelector('nav[aria-label="Pinned"]');
  assert.deepEqual(
    [...(pinned?.querySelectorAll(".luke-list-row-title") ?? [])].map(
      (name) => name.firstChild?.textContent,
    ),
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
  const note = [...sidebar.querySelectorAll(".luke-note-line")].find((each) =>
    each.textContent?.startsWith("No tasks match this view."),
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
  const notes = [...sidebar.querySelectorAll(".luke-note-line")].map((note) => note.textContent);
  assert.ok(
    notes.some((note) => note?.startsWith("No tasks match this view.")),
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
  const sidebar = await mountRead(ACME, []);
  choose(sidebar, "Created by", "Me");
  // Note that the pinned section's own "Drag tasks here to pin them" is a line of the sidebar too.
  const notes = [...sidebar.querySelectorAll(".luke-note-line")]
    .map((note) => note.textContent)
    .filter((note) => !note?.startsWith("Drag tasks here"));
  assert.deepEqual(notes, ["No tasks yet."]);
});

test("⌘K offers each view choice only while it would change the list, and running one changes it as the menu would", async () => {
  const sidebar = await mountRead(ACME);
  assert.equal(appCommandOffered(APP_COMMAND.GROUP_TASKS_BY_REPOSITORY), false);
  assert.equal(appCommandOffered(APP_COMMAND.SHOW_EVERYONES_TASKS), false);

  act(() => {
    runAppCommand(APP_COMMAND.GROUP_TASKS_BY_CREATOR);
  });
  assert.deepEqual(groupNames(sidebar), ["You", "Charles Pan"]);
  assert.equal(appCommandOffered(APP_COMMAND.GROUP_TASKS_BY_CREATOR), false);
  assert.equal(appCommandOffered(APP_COMMAND.GROUP_TASKS_BY_REPOSITORY), true);

  act(() => {
    runAppCommand(APP_COMMAND.SHOW_MY_TASKS);
  });
  assert.equal(chipWords(sidebar), "Assigned to me");
  assert.equal(appCommandOffered(APP_COMMAND.SHOW_EVERYONES_TASKS), true);
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

const TRIAGE = oneOff("a-1", "Triage overnight issues", "acme/relay", DEAN, 550);
const SWEEP = oneOff("a-2", "Sweep flaky tests", "acme/console", CHARLES, 100);

test("a one-off agent stands among its repository's tasks by its last activity, led by its harness mark and ending with its automation's clock, and a press opens its page", () => {
  const sidebar = mountSidebar(ACME, TASKS, [TRIAGE, SWEEP]);
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
  const row = [
    ...sidebar.querySelectorAll<HTMLButtonElement>(
      ".sidebar-tasks > li > button:has(.sidebar-agent-glyph)",
    ),
  ].find((each) => each.textContent?.includes("Triage overnight issues") === true);
  assert.ok(row, "the agent's row stands");
  assert.ok(row.querySelector(".sidebar-agent-glyph svg"), "it leads with its harness mark");
  assert.ok(row.querySelector(".sidebar-task-time .actor-mark"), "it ends with its starter");

  act(() => row.click());
  assert.deepEqual(openedAgents, ["a-1"]);
});

test("grouped by creator a one-off agent stands under whoever started it, and Created by filters it as a task", async () => {
  const sidebar = await mountRead(ACME, TASKS, [TRIAGE, SWEEP]);
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

test("an archived one-off agent stands nowhere in the list", async () => {
  const shelved = oneOff("a-3", "Digest of open pull requests", "acme/relay", DEAN, 45, 60);
  const sidebar = await mountRead(ACME, TASKS, [TRIAGE, shelved]);
  assert.ok(!taskRows(sidebar).some((row) => row.name === "Digest of open pull requests"));
});

test("the agent whose page stands is the row the sidebar marks", () => {
  const sidebar = mountSidebar(ACME, TASKS, [TRIAGE], "a-1");
  const marked = [...sidebar.querySelectorAll('[aria-current="page"]')].map(
    (row) => row.querySelector(".luke-list-row-title")?.firstChild?.textContent,
  );
  assert.deepEqual(marked, ["Triage overnight issues"]);
});

test("with no task but a one-off agent standing, the list holds the agent", async () => {
  const sidebar = await mountRead(ACME, [], [TRIAGE]);
  assert.deepEqual(
    taskRows(sidebar).map((row) => row.name),
    ["Triage overnight issues"],
  );
});

test("a one-off agent's row offers Copy link on a right-click, copying the agent's link under its workspace, and says Link copied", async () => {
  const sidebar = await mountRead({ ...ACME, slug: "acme" }, TASKS, [TRIAGE]);
  const row = [
    ...sidebar.querySelectorAll<HTMLButtonElement>(
      ".sidebar-tasks > li > button:has(.sidebar-agent-glyph)",
    ),
  ].find((each) => each.textContent?.includes("Triage overnight issues") === true);
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
  const row = container.querySelector<HTMLButtonElement>(
    ".sidebar-tasks > li > button:has(.sidebar-agent-glyph)",
  );
  assert.ok(row, "the agent's row stands");
  act(() => {
    row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  });
  const opened = document.querySelectorAll('[role="menuitem"]').length;

  float(SIDEBAR_OVERLAY.CLOSED);

  assert.equal(opened, 7);
  assert.equal(document.querySelectorAll('[role="menuitem"]').length, 0);
});

/** The menu a right-click on the agent's row named `title` opens, by its items' words. */
function agentMenu(sidebar: HTMLElement, title: string): string[] {
  const row = [
    ...sidebar.querySelectorAll<HTMLButtonElement>(
      ".sidebar-tasks > li > button:has(.sidebar-agent-glyph)",
    ),
  ].find((each) => each.textContent?.includes(title) === true);
  assert.ok(row, `the row of ${title} stands`);
  act(() => {
    row.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  });
  return [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].map(itemLabel);
}

test("a pinned one-off agent stands under Pinned beside the pinned tasks, newest pinned first, and not among its repository's tasks", () => {
  const pinned = { ...TRIAGE, pinnedAt: 950 };
  const sidebar = mountSidebar(ACME, TASKS, [pinned, SWEEP]);
  const section = sidebar.querySelector('nav[aria-label="Pinned"]');
  assert.deepEqual(
    [...(section?.querySelectorAll(".luke-list-row-title") ?? [])].map(
      (name) => name.firstChild?.textContent,
    ),
    ["Triage overnight issues", "Release checklist"],
  );
  assert.ok(section?.querySelector(".sidebar-agent-glyph svg"), "it wears its mark");
  assert.ok(
    !taskRows(sidebar).some((row) => row.name === "Triage overnight issues"),
    "a pinned agent is not listed again under Tasks",
  );
  assert.ok(taskRows(sidebar).some((row) => row.name === "Sweep flaky tests"));
});

test("a one-off agent's row offers Mark as unread after Copy link, Pin, Rename, Unpin once pinned, Archive, Move to section, and Permanently delete last", async () => {
  const sidebar = await mountRead({ ...ACME, slug: "acme" }, TASKS, [
    TRIAGE,
    { ...SWEEP, pinnedAt: 950 },
  ]);

  assert.deepEqual(agentMenu(sidebar, "Triage overnight issues"), [
    "Copy link",
    "Mark as unread",
    "Rename",
    "Pin",
    "Archive",
    "Move to section",
    "Permanently delete",
  ]);
  await act(async () => menuItem("Pin").click());
  // Note that Sweep stands under Pinned, in a list that reorders, whose rows offer to move.
  assert.deepEqual(agentMenu(sidebar, "Sweep flaky tests"), [
    "Move down",
    "Copy link",
    "Mark as unread",
    "Rename",
    "Unpin",
    "Archive",
    "Move to section",
    "Permanently delete",
  ]);
  await act(async () => menuItem("Unpin").click());
  assert.deepEqual(pinsAsked, ["a-1:true", "a-2:false"]);
});

/** The buttons a sidebar row named `title` draws at its end, by their names. */
function rowMarks(sidebar: HTMLElement, title: string): string[] {
  const item = [...sidebar.querySelectorAll<HTMLElement>(".sidebar-tasks > li")].find(
    (each) => each.querySelector("button")?.textContent?.includes(title) === true,
  );
  assert.ok(item, `the row of ${title} stands`);
  return [...item.querySelectorAll(".luke-list-row-actions button")].map(
    (button) => button.getAttribute("aria-label") ?? "",
  );
}

test("a one-off agent's row draws Pin and Archive at its end where a task's row draws Pin and Mark done, and its Pin pins it", async () => {
  const sidebar = await mountRead({ ...ACME, slug: "acme" }, TASKS, [TRIAGE]);
  const task = TASKS[0] ?? assert.fail("a task stands");

  assert.deepEqual(rowMarks(sidebar, task.name), ["Pin", "Mark done"]);
  assert.deepEqual(rowMarks(sidebar, "Triage overnight issues"), ["Pin", "Archive"]);
  const pin = [
    ...(sidebar.querySelectorAll<HTMLButtonElement>(
      '.luke-list-row-actions button[aria-label="Pin"]',
    ) ?? []),
  ].find((button) => button.closest("li")?.textContent?.includes("Triage overnight issues"));
  assert.ok(pin);
  await act(async () => pin.click());
  assert.deepEqual(pinsAsked, ["a-1:true"]);
});

/** A task of the workspace's standing in `status`. */
function standing(id: string, name: string, status: TaskStatus, updatedAt: number): TaskSummary {
  return { ...task(id, name, "acme/relay", DEAN, { createdAt: 1, updatedAt }), status };
}

const BY_STATUS = [
  standing("s-1", "Rate limit search", TASK_STATUS.BACKLOG, 90),
  standing("s-2", "Onboarding copy", TASK_STATUS.BACKLOG, 80),
  standing("s-3", "Fix Safari login", TASK_STATUS.IN_PROGRESS, 70),
  standing("s-4", "CSV export", TASK_STATUS.TODO, 60),
  standing("s-5", "Retry webhooks", TASK_STATUS.DONE, 50),
];

/** The quiet line under the list saying what the status filter leaves out, if it stands. */
function hiddenLine(sidebar: HTMLElement): HTMLButtonElement | null {
  return sidebar.querySelector<HTMLButtonElement>(".sidebar-hidden-statuses button");
}

test("the list holds the tasks to do and in progress, each led by its status's mark, and a quiet line says how many it leaves out and in which statuses", () => {
  const sidebar = mountSidebar(ACME, BY_STATUS);

  assert.deepEqual(
    taskRows(sidebar).map((row) => row.name),
    ["Fix Safari login", "CSV export"],
  );
  const marks = [
    ...sidebar.querySelectorAll(`${TASK_LIST} .luke-list-row-leading .luke-task-status-mark`),
  ].map((mark) => mark.getAttribute("data-status"));
  assert.deepEqual(marks, [TASK_STATUS.IN_PROGRESS, TASK_STATUS.TODO]);
  assert.equal(hiddenLine(sidebar)?.textContent, "3 more in Backlog, Done");
});

test("the hidden tasks' line opens the status filter, whose choice lists the backlog and is kept for the workspace on this Mac", () => {
  const sidebar = mountSidebar(ACME, BY_STATUS);
  const line = hiddenLine(sidebar);
  assert.ok(line, "the hidden tasks' line stands");

  act(() => line.click());
  const checked = [...document.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]')]
    .filter((item) => item.getAttribute("aria-checked") === "true")
    .map(itemLabel);
  assert.deepEqual(checked, ["Todo", "In progress"]);
  act(() => menuItem("Backlog").click());

  assert.deepEqual(
    taskRows(sidebar).map((row) => row.name),
    ["Rate limit search", "Onboarding copy", "Fix Safari login", "CSV export"],
  );
  assert.equal(hiddenLine(sidebar)?.textContent, "1 more in Done");
  unmountAll();
  assert.equal(taskRows(mountSidebar(ACME, BY_STATUS)).length, 4);
});

test("the status filter is on the Tasks head, and listing everyone's tasks again keeps the statuses chosen", async () => {
  const sidebar = await mountRead(ACME, BY_STATUS);
  const filter = sidebar.querySelector<HTMLButtonElement>('button[aria-label="Show statuses"]');
  assert.ok(filter, "the Tasks head offers the status filter");
  act(() => filter.click());
  act(() => menuItem("Done").click());
  choose(sidebar, "Created by", "Me");
  const lift = chip(sidebar)?.querySelector<HTMLButtonElement>("button");
  assert.ok(lift, "the Created by chip offers its ×");
  act(() => lift.click());

  assert.deepEqual(
    taskRows(sidebar).map((row) => row.name),
    ["Fix Safari login", "CSV export", "Retry webhooks"],
  );
});

test("a task from a service before statuses stands whatever the filter", () => {
  const sidebar = mountSidebar(ACME, [...BY_STATUS, task("t-0", "No status", null, DEAN)]);
  assert.ok(taskRows(sidebar).some((row) => row.name === "No status"));
});

/** The tasks with Charles's Fix flaky deploy assigned to Dean, and Retry webhooks to Charles. */
/** What a reader of the screen hears each row of the Tasks section say of whose face it wears, by the row's name. */
function heardFaces(sidebar: HTMLElement): [string, string | undefined][] {
  const tasks = sidebar.querySelector(TASK_LIST);
  assert.ok(tasks, "the Tasks section stands");
  return [...tasks.querySelectorAll(".sidebar-tasks > li > button")].map((row) => [
    row.querySelector(".luke-list-row-title")?.firstChild?.textContent ?? "",
    row.querySelector(".luke-list-row-title .luke-visually-hidden:last-child")?.textContent ??
      undefined,
  ]);
}

test("a row wears its assignee's face where someone else is on it, none where you are, and the unassigned mark, never its creator's, where no one is", async () => {
  const sidebar = await mountRead(ACME, ASSIGNED);
  choose(sidebar, "Group by", "None");

  assert.deepEqual(heardFaces(sidebar), [
    ["Billing empty states", "(unassigned)"],
    ["Retry webhooks", "(assigned to Charles Pan)"],
    ["Fix flaky deploy", undefined],
  ]);
});

test("Assigned to › Me lists only the tasks you are on, wearing no faces, says so in a chip and a dot, and the chip's × lists anyone's again", async () => {
  const sidebar = await mountRead(ACME, ASSIGNED);
  choose(sidebar, "Assigned to", "Me");

  assert.deepEqual(taskRows(sidebar), [
    { name: "Fix flaky deploy", repository: undefined, face: false },
  ]);
  assert.equal(chipWords(sidebar), "Assigned to me");
  const options = sidebar.querySelector('button[aria-label="View options"]');
  assert.equal(options?.getAttribute("aria-description"), "Filtered");

  const clear = chip(sidebar)?.querySelector("button");
  assert.ok(clear, "the chip offers its ×");
  act(() => clear.click());
  assert.equal(chip(sidebar), null);
  assert.equal(taskRows(sidebar).length, 3);
});

test("Assigned to a teammate, with nothing of theirs, says so, and Show all lists everyone's again", async () => {
  const sidebar = await mountRead(ACME, TASKS);
  choose(sidebar, "Assigned to", "Charles Pan");

  assert.equal(chipWords(sidebar), "Assigned to Charles Pan");
  assert.equal(taskRows(sidebar).length, 0);
  const note = [...sidebar.querySelectorAll(".luke-note-line")].find((each) =>
    each.textContent?.startsWith("No tasks match this view."),
  );
  const showAll = note?.querySelector("button");
  assert.ok(showAll, "the note offers Show all");
  act(() => showAll.click());
  assert.equal(taskRows(sidebar).length, 3);
});

test("⌘K's Show my tasks lists the tasks you are on, whoever created them, and Show everyone's tasks lets go of both filters", async () => {
  const sidebar = await mountRead(ACME, ASSIGNED);
  // Created by › Me holds none of the tasks Dean is on, which Show my tasks lists whoever created them.
  choose(sidebar, "Created by", "Me");
  act(() => runAppCommand(APP_COMMAND.SHOW_MY_TASKS));

  assert.deepEqual(
    taskRows(sidebar).map((row) => row.name),
    ["Fix flaky deploy"],
  );
  assert.equal(chipWords(sidebar), "Assigned to me");
  assert.equal(appCommandOffered(APP_COMMAND.SHOW_MY_TASKS), false);
  act(() => runAppCommand(APP_COMMAND.SHOW_EVERYONES_TASKS));
  assert.equal(taskRows(sidebar).length, 3);
  assert.equal(chip(sidebar), null);
});

test("a list that names the creator, by its filter or its groups, still wears who is on each row", async () => {
  const assignedToMaya = TASKS.map((each) =>
    each.id === "t-2" ? { ...each, assignee: { userId: "user-maya", name: "Maya Okafor" } } : each,
  );
  const sidebar = await mountRead(ACME, assignedToMaya);
  choose(sidebar, "Created by", "Charles Pan");

  assert.deepEqual(heardFaces(sidebar), [
    ["Billing empty states", "(unassigned)"],
    ["Fix flaky deploy", "(assigned to Maya Okafor)"],
  ]);

  choose(sidebar, "Created by", "Anyone");
  choose(sidebar, "Group by", "Creator");
  assert.deepEqual(heardFaces(sidebar), [
    ["Retry webhooks", "(unassigned)"],
    ["Billing empty states", "(unassigned)"],
    ["Fix flaky deploy", "(assigned to Maya Okafor)"],
  ]);
});

test("grouped by assignee, your tasks come first, then each teammate's by name, then Unassigned on the dashed mark, each row wearing no face", async () => {
  const assigned = [
    ...ASSIGNED,
    task("t-6", "Audit logs", "acme/console", CHARLES),
    {
      ...task("t-7", "Rate limits", "acme/relay", DEAN),
      assignee: { userId: "user-maya", name: "Maya Okafor" },
    },
  ];
  const sidebar = await mountRead(ACME, assigned);
  choose(sidebar, "Group by", "Assignee");

  assert.deepEqual(groupNames(sidebar), ["You", "Charles Pan", "Maya Okafor", "Unassigned"]);
  assert.deepEqual(
    taskRows(sidebar).map((row) => [row.name, row.face]),
    [
      ["Fix flaky deploy", false],
      ["Retry webhooks", false],
      ["Rate limits", false],
      ["Billing empty states", false],
      ["Audit logs", false],
    ],
  );
  const headers = sidebar.querySelectorAll(
    `${TASK_LIST} .luke-group-header-head:has(> .luke-group-header-heading button[aria-expanded])`,
  );
  assert.equal(
    headers[3]?.querySelector('.actor-mark[data-kind="unassigned"]') === null,
    false,
    "Unassigned is headed by the dashed mark",
  );
});

/** The words a card hung now names its subject by. */
function cardName(): string | undefined {
  return (
    document.querySelector(".luke-tooltip-card .luke-hover-card-name")?.textContent ?? undefined
  );
}

test("Assigned to and Created by each offer Anyone, then you as Me, then each teammate by name with their email beside it, hanging their card", async () => {
  const sidebar = await mountRead(ACME, ASSIGNED);
  const offered: (readonly (string | null)[])[][] = [];
  for (const submenu of ["Assigned to", "Created by"]) {
    const button = sidebar.querySelector<HTMLButtonElement>('button[aria-label="View options"]');
    assert.ok(button, "the Tasks head offers View options");
    act(() => button.click());
    act(() => menuItem(submenu).click());
    const menu = [...document.querySelectorAll<HTMLElement>('[role="menu"]')].at(-1);
    offered.push(
      [...(menu?.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]') ?? [])].map((item) => [
        itemLabel(item),
        item.querySelector(".luke-menu-item-detail")?.textContent ?? null,
      ]),
    );
    restOn(menuItem("Charles Pan"));
    assert.equal(cardName(), "Charles Pan", `${submenu}'s teammate hangs their card`);
    act(() => button.click());
  }

  const people = [
    ["Anyone", null],
    ["Me", null],
    ["Charles Pan", "charles@acme.dev"],
    ["Maya Okafor", "maya@acme.dev"],
  ];
  assert.deepEqual(offered, [people, people]);
});

test("Assigned to says the members could not be read, with Retry, after Anyone, and Retry reads them again and leaves the menu standing", async () => {
  let reads = 0;
  fakeActPort({
    [ACT_KIND.WORKSPACE_MEMBERS_READ]: () => {
      reads += 1;
      return reads === 1 ? Promise.reject(new Error("offline")) : Promise.resolve(MEMBERS);
    },
  });
  const sidebar = await mountRead(ACME, ASSIGNED);
  const button = sidebar.querySelector<HTMLButtonElement>('button[aria-label="View options"]');
  assert.ok(button, "the Tasks head offers View options");
  act(() => button.click());
  act(() => menuItem("Assigned to").click());
  const offered = () => {
    const menu = [...document.querySelectorAll<HTMLElement>('[role="menu"]')].at(-1);
    return [
      ...(menu?.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemcheckbox"]') ??
        []),
    ].map((item) => [
      itemLabel(item),
      item.querySelector(".luke-menu-item-detail")?.textContent ?? null,
    ]);
  };

  const failed = offered();
  await act(async () => menuItem("Members could not be read.").click());

  assert.deepEqual(failed.at(-1), ["Members could not be read.", "Retry"]);
  assert.ok(offered().some(([label]) => label === "Charles Pan"));
  assert.ok(offered().every(([label]) => label !== "Members could not be read."));
});

test("a person's group header, by assignee or by creator, hangs their card", async () => {
  const sidebar = await mountRead(ACME, ASSIGNED);
  const header = (name: string) =>
    [
      ...sidebar.querySelectorAll<HTMLButtonElement>(
        `${TASK_LIST} .luke-group-header-head button[aria-expanded]:not([aria-haspopup])`,
      ),
    ].find((button) => heardName(button) === name) ?? assert.fail(`${name} heads a group`);
  const hung: (string | undefined)[] = [];
  for (const grouping of ["Assignee", "Creator"]) {
    choose(sidebar, "Group by", grouping);
    restOn(header("Charles Pan"));
    hung.push(cardName());
  }

  assert.deepEqual(hung, ["Charles Pan", "Charles Pan"]);
});

test("an assignee's group folds, and stays folded across launches", async () => {
  const sidebar = await mountRead(ACME, ASSIGNED);
  choose(sidebar, "Group by", "Assignee");
  const fold = [
    ...sidebar.querySelectorAll<HTMLButtonElement>(
      `${TASK_LIST} .luke-group-header-head button[aria-expanded]:not([aria-haspopup])`,
    ),
  ].find((button) => heardName(button) === "Unassigned");
  assert.ok(fold, "Unassigned has a fold");
  act(() => fold.click());
  assert.deepEqual(
    taskRows(sidebar).map((row) => row.name),
    ["Fix flaky deploy", "Retry webhooks"],
  );
  unmountAll();

  const again = await mountRead(ACME, ASSIGNED);
  assert.deepEqual(
    taskRows(again).map((row) => row.name),
    ["Fix flaky deploy", "Retry webhooks"],
  );
});

test("View options offers Assignee above Creator, and Assigned to above Created by, whose chips stand in that order", async () => {
  const sidebar = await mountRead(ACME, ASSIGNED);
  const button = sidebar.querySelector<HTMLButtonElement>('button[aria-label="View options"]');
  assert.ok(button, "the Tasks head offers View options");
  act(() => button.click());
  const top = [...document.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]')].map(
    itemLabel,
  );
  assert.deepEqual(top.slice(-2), ["Assigned to", "Created by"]);
  act(() => menuItem("Group by").click());
  const groupBy = [...document.querySelectorAll('[role="menu"]')].at(-1);
  assert.deepEqual(
    [...(groupBy?.querySelectorAll('[role="menuitemcheckbox"]') ?? [])].map(
      (item) => item.textContent,
    ),
    ["Repository", "Assignee", "Creator", "None"],
  );
  unmountAll();

  const filtered = await mountRead(ACME, ASSIGNED);
  choose(filtered, "Created by", "Charles Pan");
  choose(filtered, "Assigned to", "Me");
  assert.deepEqual(
    [...filtered.querySelectorAll(".sidebar-view-chips .luke-chip-name")].map(
      (name) => name.textContent,
    ),
    ["Assigned to me", "Created by Charles Pan"],
  );
});

test("an assignee grouping kept for a workspace nobody shares now is drawn by repository", async () => {
  window.localStorage.setItem(
    "luke.sidebarTaskViews",
    JSON.stringify({ [PERSONAL.id]: { grouping: "assignee", order: "updated" } }),
  );
  const sidebar = await mountRead(PERSONAL);
  assert.deepEqual(groupNames(sidebar), ["console", "relay"]);
});
