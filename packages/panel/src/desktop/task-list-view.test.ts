// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  AGENT_STATUS,
  CHECK_SUMMARY,
  PULL_REQUEST_STATE,
  type TasklessAgent,
} from "@repo/features/agent-wire";
import { TASK_STATUS, type TaskStatus, type TaskSummary } from "@repo/features/task-wire";
import type { Workspace, WorkspaceMember } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { appCommandOffered, runAppCommand } from "../app-commands.js";
import { fakeActPort, fakeAppBridge } from "../testing/app-bridge.js";
import { copyingInto, fakeAppPlatform, QUIET_PANEL } from "../testing/app-platform.js";
import { handHostReads, handMembers } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { sidebarProps } from "../testing/desktop-sidebar.js";
import { restOn } from "../testing/hint-rest.js";
import { tasksControl } from "../testing/tasks-control.js";
import { newestToastSays } from "../testing/toast.js";
import { ToastHost } from "../toast.js";
import { DesktopSidebar } from "./desktop-sidebar.js";
import { SIDEBAR_OVERLAY } from "./sidebar-collapse.js";

/**
 * task-list-view.test.ts -- the sidebar's Tasks section lists the work under
 * way, the reader's own until View options says otherwise, grouped as it
 * says, each row saying what its group does not, the pins standing apart in
 * a section of their own, and each workspace keeping its own view on this
 * Mac.
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

/** The Tasks section, called whose tasks it holds. */
const TASK_LIST = 'nav[aria-label$="tasks"]';

const roots: Root[] = [];

beforeEach(() => {
  openedAgents = [];
  tasksPageOpened = 0;
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
  fakeActPort({});
  handMembers(() => ({ rows: { members: MEMBERS } }));
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
    status: AGENT_STATUS.COMPLETED,
    turnId: null,
    startedBy: { userId: starter, name: starter === DEAN ? "Dean Stratakos" : "Charles Pan" },
    automationId: "5a0c4d2e-8f1b-4c3a-9e7d-2b6f1a8c9d04",
    automationName: "Morning Sentry triage",
    workspaceId: ACME.id,
    repository,
    activityAt,
    // Its pull request still open, the finished run holds the reader, so it stands under Tasks (`finished-runs.ts`).
    pullRequest: {
      number: 7,
      title,
      url: `https://github.com/${repository}/pull/7`,
      state: PULL_REQUEST_STATE.OPEN,
      checks: CHECK_SUMMARY.PASSING,
    },
    ...(archivedAt === undefined ? undefined : { archivedAt }),
  };
}

/** The agents' pages the sidebar opened, in order. */
let openedAgents: string[] = [];

/** What the window copied, in order. */
let copied: string[] = [];

/** Each agent's pin the sidebar asked for, in order, as `agentId:pinned`. */
let pinsAsked: string[] = [];

/** How many times the sidebar opened the Tasks page. */
let tasksPageOpened = 0;

/** Keeps Assigned to › Anyone for `workspace`, as a reader who chose it on an earlier launch has, for a test of what the list draws whoever's it is. */
function keepAnyone(workspace: Workspace = ACME): void {
  window.localStorage.setItem(
    "app.sidebarTaskViews",
    JSON.stringify({ [workspace.id]: { grouping: "repository", assignee: { kind: "anyone" } } }),
  );
}

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
    boardView: {
      open: false,
      onOpen: () => {
        tasksPageOpened += 1;
      },
      onClose: () => undefined,
    },
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
  return (item.querySelector(".ui-menu-item-label") ?? item).textContent?.trim() ?? "";
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
    ...tasks.querySelectorAll(".ui-group-header-head button[aria-expanded]:not([aria-haspopup])"),
  ].map(heardName);
}

/** The rows of the Tasks section: each name, the repository it says, and whether it wears a face. */
function taskRows(
  sidebar: HTMLElement,
): { name: string; repository: string | undefined; face: boolean }[] {
  const tasks = sidebar.querySelector(TASK_LIST);
  assert.ok(tasks, "the Tasks section stands");
  return [...tasks.querySelectorAll(".sidebar-tasks > li > button")].map((row) => ({
    name: row.querySelector(".ui-list-row-title")?.firstChild?.textContent ?? "",
    repository: row.querySelector(".sidebar-task-repository")?.textContent ?? undefined,
    face: row.querySelector(".actor-mark") !== null,
  }));
}

/** `ASSIGNED`, and one more task Dean made that no one is on yet. */
const MINE_UNASSIGNED = [
  ...ASSIGNED,
  task("t-5", "Audit logs", "acme/console", DEAN, { createdAt: 40, updatedAt: 300 }),
];

/** The words a card hung now names its subject by. */
function cardName(): string | undefined {
  return document.querySelector(".ui-tooltip-card .ui-hover-card-name")?.textContent ?? undefined;
}

/** The words of each item of the menu standing last, its glyph left out. */
function lastMenuItems(): string[] {
  const menu = [...document.querySelectorAll<HTMLElement>('[role="menu"]')].at(-1);
  return [
    ...(menu?.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemcheckbox"]') ?? []),
  ].map(itemLabel);
}

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

/** What the Tasks head says, which the list is called by too. */
function headWords(sidebar: HTMLElement): string | undefined {
  const list = sidebar.querySelector(TASK_LIST);
  const said = list?.querySelector(".ui-group-header-lead")?.textContent ?? undefined;
  assert.equal(
    list?.getAttribute("aria-label") ?? undefined,
    said,
    "the list is called as its head says",
  );
  return said;
}

test("a shared workspace opens on your own tasks, those you are on and those no one is on that you made, by repository, newest updated first, with no dot", async () => {
  const sidebar = await mountRead(ACME, MINE_UNASSIGNED);

  assert.deepEqual(groupNames(sidebar), ["relay", "console"]);
  assert.deepEqual(taskRows(sidebar), [
    { name: "Fix flaky deploy", repository: undefined, face: false },
    { name: "Audit logs", repository: undefined, face: true },
  ]);
  const options = sidebar.querySelector('button[aria-label="View options"]');
  assert.equal(options?.getAttribute("aria-description"), null);
});

test("View options offers Group by, Repository or None, and Assigned to: Me, Anyone, then each teammate by name with their email beside it, hanging their card", async () => {
  const sidebar = await mountRead(ACME, ASSIGNED);
  const button = sidebar.querySelector<HTMLButtonElement>('button[aria-label="View options"]');
  assert.ok(button, "the Tasks head offers View options");
  act(() => button.click());
  assert.deepEqual(lastMenuItems(), ["Group by", "Assigned to"]);
  act(() => menuItem("Group by").click());
  assert.deepEqual(lastMenuItems(), ["Repository", "None"]);
  act(() => menuItem("Assigned to").click());
  const menu = [...document.querySelectorAll<HTMLElement>('[role="menu"]')].at(-1);
  assert.deepEqual(
    [...(menu?.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]') ?? [])].map((item) => [
      itemLabel(item),
      item.querySelector(".ui-menu-item-detail")?.textContent ?? null,
      item.getAttribute("aria-checked"),
    ]),
    [
      ["Me", null, "true"],
      ["Anyone", null, "false"],
      ["Charles Pan", "charles@acme.dev", "false"],
      ["Maya Okafor", "maya@acme.dev", "false"],
    ],
  );
  restOn(menuItem("Charles Pan"));
  assert.equal(cardName(), "Charles Pan");
});

test("the Tasks head says My tasks, then Everyone's tasks once Assigned to › Anyone lists everyone's, kept across launches, with a dot and no chip", async () => {
  const mine = await mountRead(ACME, ASSIGNED);
  assert.equal(headWords(mine), "My tasks");
  choose(mine, "Assigned to", "Anyone");
  unmountAll();

  const sidebar = await mountRead(ACME, ASSIGNED);
  assert.equal(taskRows(sidebar).length, 3);
  assert.equal(headWords(sidebar), "Everyone's tasks");
  assert.equal(sidebar.querySelector('button[aria-label="Show my tasks"]'), null, "no chip");
  const options = sidebar.querySelector('button[aria-label="View options"]');
  assert.equal(options?.getAttribute("aria-description"), "Filtered");
});

test("grouped by none, the tasks run in one list, each row naming its repository and wearing who is on it", () => {
  keepAnyone();
  const sidebar = mountSidebar(ACME, ASSIGNED);
  choose(sidebar, "Group by", "None");
  assert.deepEqual(groupNames(sidebar), []);
  assert.deepEqual(taskRows(sidebar), [
    { name: "Billing empty states", repository: "console", face: true },
    { name: "Retry webhooks", repository: "relay", face: true },
    { name: "Fix flaky deploy", repository: "relay", face: false },
  ]);
});

test("the pins stand in a section of their own above Tasks, whatever the view lists", () => {
  const pinnedTheirs = task("t-6", "Onboarding rewrite", "acme/console", CHARLES, undefined, 950);
  const sidebar = mountSidebar(ACME, [...TASKS, pinnedTheirs]);
  const pinned = sidebar.querySelector('nav[aria-label="Pinned"]');
  assert.deepEqual(
    [...(pinned?.querySelectorAll(".ui-list-row-title") ?? [])].map(
      (name) => name.firstChild?.textContent,
    ),
    ["Onboarding rewrite", "Release checklist"],
  );
  assert.ok(
    !taskRows(sidebar).some((row) => row.name === "Release checklist"),
    "a pinned task is not listed again under Tasks",
  );
});

test("each workspace keeps its own view on this Mac across launches", () => {
  choose(mountSidebar(ACME), "Group by", "None");
  unmountAll();

  assert.deepEqual(groupNames(mountSidebar(ACME)), []);
  unmountAll();
  const other = { ...ACME, id: "workspace-other", name: "Other" };
  const elsewhere = TASKS.map((each) => ({ ...each, workspaceId: other.id }));
  assert.deepEqual(groupNames(mountSidebar(other, elsewhere)), ["relay"]);
});

test("a workspace nobody shares lists every task and offers Group by alone", () => {
  const sidebar = mountSidebar(PERSONAL);
  assert.equal(taskRows(sidebar).length, 3);
  assert.equal(headWords(sidebar), "My tasks");
  const button = sidebar.querySelector<HTMLButtonElement>('button[aria-label="View options"]');
  assert.ok(button, "the Tasks head offers View options");
  assert.equal(button.getAttribute("aria-description"), null);
  act(() => button.click());
  assert.deepEqual(lastMenuItems(), ["Group by"]);
});

test("a list of your own that holds nothing says so, and Show all lists everyone's", async () => {
  const theirs = TASKS.filter((each) => each.createdBy?.userId === CHARLES);
  const sidebar = await mountRead(ACME, theirs);
  assert.equal(taskRows(sidebar).length, 0);
  const note = [...sidebar.querySelectorAll(".ui-note-line")].find((each) =>
    each.textContent?.startsWith("No tasks match this view."),
  );
  const showAll = note?.querySelector("button");
  assert.ok(showAll, "the note offers Show all");
  act(() => showAll.click());
  assert.equal(taskRows(sidebar).length, 2);
  assert.equal(headWords(sidebar), "Everyone's tasks");
});

test("with every task pinned, a filter still says it leaves nothing under Tasks, with Show all", async () => {
  const pinnedAll = TASKS.map((each, at) => ({ ...each, pinnedAt: 900 + at }));
  const sidebar = await mountRead(ACME, pinnedAll);
  choose(sidebar, "Assigned to", "Charles Pan");
  const notes = [...sidebar.querySelectorAll(".ui-note-line")].map((note) => note.textContent);
  assert.ok(
    notes.some((note) => note?.startsWith("No tasks match this view.")),
    "the empty filter says so",
  );
});

test("a workspace whose list names no member count still filters by person once its members are read", async () => {
  const { memberCount: _, ...uncounted } = ACME;
  const sidebar = await mountRead(uncounted);
  assert.deepEqual(
    taskRows(sidebar).map((row) => row.name),
    ["Retry webhooks"],
  );
  choose(sidebar, "Assigned to", "Anyone");
  assert.equal(taskRows(sidebar).length, 3);
});

test("in one run, a task with no repository says so on its row", async () => {
  const notes = task("t-6", "Hiring loop notes", null, DEAN, { createdAt: 1, updatedAt: 700 });
  const sidebar = await mountRead(ACME, [...TASKS, notes]);
  choose(sidebar, "Group by", "None");
  assert.deepEqual(taskRows(sidebar)[0], {
    name: "Hiring loop notes",
    repository: "No repository",
    face: true,
  });
});

test("an empty workspace says only that it holds no tasks", async () => {
  const sidebar = await mountRead(ACME, []);
  // Note that the pinned section's own "Drag tasks here to pin them" is a line of the sidebar too.
  const notes = [...sidebar.querySelectorAll(".ui-note-line")]
    .map((note) => note.textContent)
    .filter((note) => !note?.startsWith("Drag tasks here"));
  assert.deepEqual(notes, ["No tasks yet."]);
});

test("⌘K offers each view choice only while it would change the list, and running one changes it as the menu would", async () => {
  const sidebar = await mountRead(ACME);
  assert.equal(appCommandOffered(APP_COMMAND.GROUP_TASKS_BY_REPOSITORY), false);
  assert.equal(appCommandOffered(APP_COMMAND.SHOW_MY_TASKS), false);

  act(() => {
    runAppCommand(APP_COMMAND.LIST_TASKS_UNGROUPED);
  });
  assert.deepEqual(groupNames(sidebar), []);
  assert.equal(appCommandOffered(APP_COMMAND.LIST_TASKS_UNGROUPED), false);
  assert.equal(appCommandOffered(APP_COMMAND.GROUP_TASKS_BY_REPOSITORY), true);

  act(() => {
    runAppCommand(APP_COMMAND.SHOW_EVERYONES_TASKS);
  });
  assert.equal(headWords(sidebar), "Everyone's tasks");
  assert.equal(appCommandOffered(APP_COMMAND.SHOW_EVERYONES_TASKS), false);
  act(() => {
    runAppCommand(APP_COMMAND.SHOW_MY_TASKS);
  });
  assert.equal(headWords(sidebar), "My tasks");
});

test("a workspace nobody shares offers ⌘K no filtering by person", async () => {
  await mountRead(PERSONAL);
  assert.equal(appCommandOffered(APP_COMMAND.SHOW_MY_TASKS), false);
  assert.equal(appCommandOffered(APP_COMMAND.SHOW_EVERYONES_TASKS), false);
  assert.equal(appCommandOffered(APP_COMMAND.LIST_TASKS_UNGROUPED), true);
});

const TRIAGE = oneOff("a-1", "Triage overnight issues", "acme/relay", DEAN, 550);
const SWEEP = oneOff("a-2", "Sweep flaky tests", "acme/console", CHARLES, 100);

test("a one-off agent stands among its repository's tasks by its last activity, led by its harness mark and ending with its automation's clock, and a press opens its page", () => {
  keepAnyone();
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

test("your own list holds the one-off agents you started, and not a teammate's", async () => {
  const sidebar = await mountRead(ACME, TASKS, [TRIAGE, SWEEP]);
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

test("an automation's run that finished and holds nothing of the reader's stands nowhere, and a list of only such runs holds no tasks", async () => {
  const { pullRequest: _, ...finished } = oneOff("a-4", "Nightly digest", "acme/relay", DEAN, 45);
  const among = await mountRead(ACME, TASKS, [TRIAGE, finished]);
  assert.ok(!taskRows(among).some((row) => row.name === "Nightly digest"));
  assert.ok(taskRows(among).some((row) => row.name === "Triage overnight issues"));

  const alone = await mountRead(ACME, [], [finished]);
  assert.deepEqual(taskRows(alone), []);
  assert.match(alone.textContent ?? "", /No tasks yet\./u);
});

test("the agent whose page stands is the row the sidebar marks", () => {
  const sidebar = mountSidebar(ACME, TASKS, [TRIAGE], "a-1");
  const marked = [...sidebar.querySelectorAll('[aria-current="page"]')].map(
    (row) => row.querySelector(".ui-list-row-title")?.firstChild?.textContent,
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

  assert.deepEqual(copied, ["https://vespin.dev/acme/agent/a-1"]);
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
  keepAnyone();
  const sidebar = mountSidebar(ACME, TASKS, [pinned, SWEEP]);
  const section = sidebar.querySelector('nav[aria-label="Pinned"]');
  assert.deepEqual(
    [...(section?.querySelectorAll(".ui-list-row-title") ?? [])].map(
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

test("a one-off agent's row offers the agent's one menu: Copy link, Rename and Mark as unread, Pin, or Unpin once pinned, and Move to section, Archive, and Permanently delete last", async () => {
  const sidebar = await mountRead({ ...ACME, slug: "acme" }, TASKS, [
    TRIAGE,
    { ...SWEEP, pinnedAt: 950 },
  ]);

  assert.deepEqual(agentMenu(sidebar, "Triage overnight issues"), [
    "Copy link",
    "Rename",
    "Mark as unread",
    "Pin",
    "Move to section",
    "Archive",
    "Permanently delete",
  ]);
  await act(async () => menuItem("Pin").click());
  // Note that Sweep stands under Pinned, in a list that reorders, whose rows offer to move.
  assert.deepEqual(agentMenu(sidebar, "Sweep flaky tests"), [
    "Move down",
    "Copy link",
    "Rename",
    "Mark as unread",
    "Unpin",
    "Move to section",
    "Archive",
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
  return [...item.querySelectorAll(".ui-list-row-actions button")].map(
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
      '.ui-list-row-actions button[aria-label="Pin"]',
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

/** The quiet line under the list saying what it leaves out, if it stands. */
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
    ...sidebar.querySelectorAll(`${TASK_LIST} .ui-list-row-leading .ui-task-status-mark`),
  ].map((mark) => mark.getAttribute("data-status"));
  assert.deepEqual(marks, [TASK_STATUS.IN_PROGRESS, TASK_STATUS.TODO]);
  assert.equal(hiddenLine(sidebar)?.textContent, "3 more in Backlog, Done");
});

test("the hidden tasks' line opens the Tasks page", () => {
  const line = hiddenLine(mountSidebar(ACME, BY_STATUS));
  assert.ok(line, "the hidden tasks' line stands");
  act(() => line.click());
  assert.equal(tasksPageOpened, 1);
});

test("a task from a service before statuses stands among them", () => {
  const sidebar = mountSidebar(ACME, [...BY_STATUS, task("t-0", "No status", null, DEAN)]);
  assert.ok(taskRows(sidebar).some((row) => row.name === "No status"));
});

/** What a reader of the screen hears each row of the Tasks section say of whose face it wears, by the row's name. */
function heardFaces(sidebar: HTMLElement): [string, string | undefined][] {
  const tasks = sidebar.querySelector(TASK_LIST);
  assert.ok(tasks, "the Tasks section stands");
  return [...tasks.querySelectorAll(".sidebar-tasks > li > button")].map((row) => [
    row.querySelector(".ui-list-row-title")?.firstChild?.textContent ?? "",
    row.querySelector(".ui-list-row-title .ui-visually-hidden:last-child")?.textContent ??
      undefined,
  ]);
}

test("a row wears its assignee's face where someone else is on it, none where you are, and the unassigned mark, never its creator's, where no one is", async () => {
  keepAnyone();
  const sidebar = await mountRead(ACME, ASSIGNED);
  choose(sidebar, "Group by", "None");

  assert.deepEqual(heardFaces(sidebar), [
    ["Billing empty states", "(unassigned)"],
    ["Retry webhooks", "(assigned to Charles Pan)"],
    ["Fix flaky deploy", undefined],
  ]);
});

test("Assigned to a teammate, with nothing of theirs, says so, and Show all lists everyone's again", async () => {
  const sidebar = await mountRead(ACME, TASKS);
  choose(sidebar, "Assigned to", "Charles Pan");

  assert.equal(headWords(sidebar), "Charles Pan's tasks");
  assert.equal(taskRows(sidebar).length, 0);
  const note = [...sidebar.querySelectorAll(".ui-note-line")].find((each) =>
    each.textContent?.startsWith("No tasks match this view."),
  );
  const showAll = note?.querySelector("button");
  assert.ok(showAll, "the note offers Show all");
  act(() => showAll.click());
  assert.equal(taskRows(sidebar).length, 3);
  assert.equal(headWords(sidebar), "Everyone's tasks");
});

test("Assigned to says the members could not be read, with Retry, after Me and Anyone, and Retry reads them again and leaves the menu standing", async () => {
  const reads = handHostReads({ members: { [ACME.id]: { failed: true } } });
  fakeActPort({
    [ACT_KIND.WORKSPACE_MEMBERS_RETRY]: ({ workspaceId }) => {
      reads.deliverMembers({ [workspaceId]: { rows: { members: MEMBERS } } });
      return Promise.resolve();
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
      item.querySelector(".ui-menu-item-detail")?.textContent ?? null,
    ]);
  };

  const failed = offered();
  await act(async () => menuItem("Members could not be read.").click());

  assert.deepEqual(failed.at(-1), ["Members could not be read.", "Retry"]);
  assert.ok(offered().some(([label]) => label === "Charles Pan"));
  assert.ok(offered().every(([label]) => label !== "Members could not be read."));
});
