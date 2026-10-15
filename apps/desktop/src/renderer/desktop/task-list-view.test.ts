// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { PlanSummary } from "@luke/features/plan-wire";
import type { Workspace, WorkspaceMember } from "@luke/features/workspace-wire";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act, type ActOutcome } from "@luke/host/acts";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { onRegistry } from "#testing/copy-feedback";
import { sidebarProps } from "#testing/desktop-sidebar";
import { plansControl } from "#testing/plans-control";
import { DesktopSidebar } from "./desktop-sidebar";

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
      act: (request: Act): Promise<ActOutcome> =>
        Promise.resolve(
          request.kind === ACT_KIND.WORKSPACE_MEMBERS_READ
            ? { status: ACT_OUTCOME_STATUS.DONE, value: MEMBERS }
            : { status: ACT_OUTCOME_STATUS.REFUSED, reason: "Not here." },
        ),
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
): PlanSummary {
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

/** The sidebar listing `plans` in `workspace`, read by Dean. */
function mountSidebar(workspace: Workspace, plans: readonly PlanSummary[] = TASKS): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const control = plansControl({ plans: [...plans], workspace, workspaces: [workspace], me: DEAN });
  act(() =>
    root.render(
      onRegistry(AtomRegistry.make(), createElement(DesktopSidebar, sidebarProps(control))),
    ),
  );
  return container;
}

/** The words each standing menu item says, its glyph left out. */
function itemLabel(item: HTMLElement): string {
  return (item.querySelector(".plan-menu-label") ?? item).textContent?.trim() ?? "";
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

/** The Tasks section's group headers, in order. */
function groupNames(sidebar: HTMLElement): string[] {
  const tasks = sidebar.querySelector('nav[aria-label="Tasks"]');
  assert.ok(tasks, "the Tasks section stands");
  return [...tasks.querySelectorAll(".sidebar-repository-name")].map(
    (name) => name.textContent ?? "",
  );
}

/** The rows of the Tasks section: each name, the repository it says, and whether it wears a face. */
function taskRows(
  sidebar: HTMLElement,
): { name: string; repository: string | undefined; face: boolean }[] {
  const tasks = sidebar.querySelector('nav[aria-label="Tasks"]');
  assert.ok(tasks, "the Tasks section stands");
  return [...tasks.querySelectorAll(".sidebar-plan")].map((row) => ({
    name: row.querySelector(".sidebar-plan-name")?.textContent ?? "",
    repository: row.querySelector(".sidebar-plan-repository")?.textContent ?? undefined,
    face: row.querySelector(".actor-mark") !== null,
  }));
}

test("a shared workspace's tasks group by repository until View options groups them by creator, yours first, each row naming its repository instead of a face", () => {
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
    { name: "Retry webhooks", repository: "relay", face: false },
    { name: "Billing empty states", repository: "console", face: false },
    { name: "Fix flaky deploy", repository: "relay", face: false },
  ]);
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
  const times = [...sidebar.querySelectorAll('nav[aria-label="Tasks"] .sidebar-plan time')];
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
    [...(pinned?.querySelectorAll(".sidebar-plan-name") ?? [])].map((name) => name.textContent),
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
  const choices = [...document.querySelectorAll('[role="menuitemcheckbox"]')].map(
    (item) => item.textContent,
  );
  assert.deepEqual(choices, ["Repository", "None"]);
});

/** The sidebar once the workspace's members have answered. */
async function mountRead(
  workspace: Workspace,
  plans?: readonly PlanSummary[],
): Promise<HTMLElement> {
  const sidebar = mountSidebar(workspace, plans);
  await act(async () => undefined);
  return sidebar;
}

/** The chip under the Tasks head, if one stands. */
function chip(sidebar: HTMLElement): HTMLElement | null {
  return sidebar.querySelector(".sidebar-view-chip");
}

/** What the chip under the Tasks head says, its face left out. */
function chipWords(sidebar: HTMLElement): string | undefined {
  return chip(sidebar)?.querySelector(".sidebar-view-chip-words")?.textContent ?? undefined;
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
  assert.equal(options?.getAttribute("data-filtered"), "true");
  const pinned = sidebar.querySelector('nav[aria-label="Pinned"]');
  assert.deepEqual(
    [...(pinned?.querySelectorAll(".sidebar-plan-name") ?? [])].map((name) => name.textContent),
    ["Onboarding rewrite", "Release checklist"],
    "the pins stand unfiltered",
  );

  const clear = chip(sidebar)?.querySelector("button");
  assert.ok(clear, "the chip offers its ×");
  act(() => clear.click());
  assert.equal(chip(sidebar), null);
  assert.equal(options?.getAttribute("data-filtered"), null);
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
