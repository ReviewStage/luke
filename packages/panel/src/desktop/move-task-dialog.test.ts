// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CODING_AGENT_STATUS, type CodingAgentSummary } from "@luke/features/coding-agent-wire";
import type { Task } from "@luke/features/task-wire";
import { WORKSPACE_ROLE, type Workspace } from "@luke/features/workspace-wire";
import { DOCUMENT_REGION, TASKS_PAGE } from "@luke/ui/tasks-model";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { MAIN_TAB, type MainTab } from "../tasks/use-main-tabs.js";
import { SIDE_PANEL_TAB } from "../tasks/use-side-panel.js";
import { NO_LOOKS } from "../tasks/use-task-looks.js";
import type { TasksControl } from "../tasks/use-tasks-tab.js";
import { ellipsized } from "../testing/action-label.js";
import { relayout } from "../testing/resize-observer.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { codingAgentsControl, tasksControl, UNPINNED_SUMMARY } from "../testing/tasks-control.js";
import { DesktopTasks } from "./desktop-tasks.js";

/**
 * move-task-dialog.test.ts -- Move to workspace in the open task's ⋯: offered
 * to the task's owner while the account has another workspace, it lists the
 * other workspaces, disables one whose GitHub cannot reach the task's
 * repository with the reason, says who loses and gains the task, and moves
 * it, closing on a move and staying up saying so on a refusal. A task
 * stranded in a workspace that cannot reach its repository says so over
 * every tab of it, naming the workspace that can. Synthetic throughout.
 */

const DANA = "user-dana";
const SAM = "user-sam";

const STUDIO: Workspace = {
  id: "ws-studio",
  name: "Studio",
  role: WORKSPACE_ROLE.OWNER,
  github: null,
  memberCount: 3,
};
const NORTHWIND: Workspace = {
  id: "ws-northwind",
  name: "Northwind",
  role: WORKSPACE_ROLE.MEMBER,
  github: null,
  memberCount: 4,
};
const OCTO: Workspace = {
  id: "ws-octo",
  name: "Octo",
  role: WORKSPACE_ROLE.ADMIN,
  github: { login: "octo", active: true },
  memberCount: 1,
};
const ACME: Workspace = {
  id: "ws-acme",
  name: "Acme",
  role: WORKSPACE_ROLE.ADMIN,
  github: { login: "acme-corp", active: true },
  memberCount: 5,
};

const TASK: Task = {
  id: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  workspaceId: STUDIO.id,
  name: "Checkout retries",
  createdAt: 1,
  updatedAt: 2,
  repository: "acme-corp/relay",
  ownerId: DANA,
  document: { body: "# Checkout retries", assumptions: [] },
};

const AGENT: CodingAgentSummary = {
  id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
  planId: TASK.id,
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "Retry the webhook",
  createdAt: 1,
  status: CODING_AGENT_STATUS.COMPLETED,
  turnId: null,
};

/** The agent's tab in the task's column. */
const AGENT_TAB: MainTab = { agent: AGENT.id };

const roots: Root[] = [];

beforeEach(installScrollIntoView);

/** Takes down every mounted surface and the menus and dialogs they drew. */
function unmountAll(): void {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
}

afterEach(() => {
  unmountAll();
  document.head.innerHTML = "";
  vi.restoreAllMocks();
});

/** Lets a move's answer, and the redraw it causes, land. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

/** The open task's tab, read by Dana, the task as given open and listed. */
function openTab(
  task: Task,
  workspaces: readonly Workspace[],
  onMoveTask: TasksControl["onMoveTask"] = () => Promise.resolve(false),
): TasksControl {
  return tasksControl({
    page: TASKS_PAGE.DOCUMENT,
    me: DANA,
    tasks: [task],
    activeTaskId: task.id,
    region: { kind: DOCUMENT_REGION.READY, task: task },
    workspaces,
    workspace: workspaces.find((workspace) => workspace.id === task.workspaceId),
    onMoveTask,
  });
}

/** Mounts the tab's toolbar and opens its ⋯ menu. */
function openMenu(tasks: TasksControl): void {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(createElement(DesktopTasks, { summary: UNPINNED_SUMMARY, looks: NO_LOOKS, tasks })),
  );
  const more =
    container.querySelector<HTMLButtonElement>('[aria-label="Task actions"]') ??
    assert.fail("the toolbar draws the plan's ⋯");
  act(() => more.click());
}

function menuLabels(): string[] {
  return [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map(
    (item) => item.textContent ?? "",
  );
}

function dialog(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="dialog"]');
}

/** Opens Move to workspace from the menu standing. */
function chooseMove(): HTMLElement {
  const item = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
    (candidate) => candidate.textContent === "Move to workspace",
  );
  act(() => (item ?? assert.fail("the menu offers Move to workspace")).click());
  return dialog() ?? assert.fail("Move to workspace opens a dialog");
}

/** The dialog's button with these words. */
function button(within: HTMLElement, words: string): HTMLButtonElement {
  return (
    [...within.querySelectorAll<HTMLButtonElement>("button")].find(
      (candidate) => candidate.textContent === words,
    ) ?? assert.fail(`the dialog offers ${words}`)
  );
}

test("the ⋯ offers Move to workspace on the reader's own plan while the account has another workspace, and on no teammate's plan nor with one workspace", () => {
  openMenu(openTab(TASK, [STUDIO, ACME]));
  const own = menuLabels();
  unmountAll();
  openMenu(openTab({ ...TASK, ownerId: SAM }, [STUDIO, ACME]));
  const teammates = menuLabels();
  unmountAll();
  openMenu(openTab(TASK, [STUDIO]));
  const alone = menuLabels();

  assert.ok(own.includes("Move to workspace"), "the owner is offered the move");
  assert.deepEqual(ellipsized(own), [], "no item of the ⋯ ends with an ellipsis");
  assert.ok(!teammates.includes("Move to workspace"), "a teammate's plan is not theirs to move");
  assert.ok(!alone.includes("Move to workspace"), "a single workspace has nowhere to move to");
});

test("the dialog lists the other workspaces, disables one whose GitHub cannot reach the repository with why, chooses the first that can, says what the move does, and moves the plan there", async () => {
  const moves: [string, string][] = [];
  openMenu(
    openTab(TASK, [STUDIO, NORTHWIND, OCTO, ACME], (taskId, workspaceId) => {
      moves.push([taskId, workspaceId]);
      return Promise.resolve(true);
    }),
  );
  const moving = chooseMove();

  const title = document.getElementById(moving.getAttribute("aria-labelledby") ?? "");
  assert.equal(title?.textContent, "Move “Checkout retries” to another workspace");
  const rows = [...moving.querySelectorAll<HTMLButtonElement>('[role="radio"]')].map((row) => ({
    words: row.textContent,
    disabled: row.disabled,
    checked: row.getAttribute("aria-checked"),
  }));
  assert.deepEqual(rows, [
    {
      words: "NNorthwindNo GitHub connected · can’t reach acme-corp/relay",
      disabled: true,
      checked: "false",
    },
    {
      words: "OOctoocto on GitHub · can’t reach acme-corp/relay",
      disabled: true,
      checked: "false",
    },
    { words: "AAcme5 members", disabled: false, checked: "true" },
  ]);
  assert.deepEqual(
    [...moving.querySelectorAll(".move-effects li")].map((line) => line.textContent),
    [
      "Members of Studio who aren't in Acme lose access to it, its calls, and its agents.",
      "5 people in Acme can read and edit it.",
      "Its agents keep running, now in Acme.",
    ],
  );
  // The recording masks text alone, so no name may stand in an attribute.
  for (const element of [moving, ...moving.querySelectorAll("*")]) {
    for (const attribute of element.attributes) {
      assert.doesNotMatch(attribute.value, /Checkout retries|Acme|Northwind|Octo/u, attribute.name);
    }
  }

  act(() => button(moving, "Move to Acme").click());
  await settle();

  assert.deepEqual(moves, [[TASK.id, ACME.id]]);
  assert.equal(dialog(), null, "a move landed puts the dialog away");
});

test("a row calls the account's own first workspace personal while no one else is in it, and counts the one member of a team no one has joined yet", () => {
  const personal: Workspace = { ...STUDIO, id: "ws-personal", name: "Dana", memberCount: 1 };
  const fresh: Workspace = { ...NORTHWIND, id: "ws-fresh", name: "Platform", memberCount: 1 };
  openMenu(openTab({ ...TASK, repository: null }, [personal, STUDIO, fresh]));

  const rows = [...chooseMove().querySelectorAll('[role="radio"]')].map((row) => row.textContent);

  assert.deepEqual(rows, ["DDanaPersonal workspace", "PPlatform1 member"]);
});

test("a refused move keeps the dialog up, saying so under the list", async () => {
  openMenu(openTab({ ...TASK, repository: null }, [STUDIO, NORTHWIND]));
  const moving = chooseMove();
  assert.equal(
    moving.querySelector('[aria-checked="true"]')?.textContent?.includes("Northwind"),
    true,
    "a plan with no repository can go to a workspace with no GitHub",
  );

  act(() => button(moving, "Move to Northwind").click());
  await settle();

  assert.equal(dialog(), moving, "the dialog stays up");
  assert.equal(
    moving.querySelector('[role="alert"]')?.textContent,
    "The task could not be moved. Try again.",
  );
});

/** Mounts the open task's page, its menu left closed. */
function openTask(tasks: TasksControl): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(createElement(DesktopTasks, { summary: UNPINNED_SUMMARY, looks: NO_LOOKS, tasks })),
  );
  return container;
}

/** The task-wide banner over a stranded task, where one stands: the region its words name. */
function strandedBanner(within: HTMLElement): HTMLElement | null {
  const regions = [...within.querySelectorAll<HTMLElement>("section[aria-labelledby]")];
  return (
    regions.find((region) =>
      document
        .getElementById(region.getAttribute("aria-labelledby") ?? "")
        ?.textContent?.startsWith("This task's repository belongs to"),
    ) ?? null
  );
}

/** The words a reader hears in an element: its text but for a mark hidden from a screen reader, a workspace's tile's letter among them. */
function heard(node: Node): string {
  if (node instanceof Element && node.getAttribute("aria-hidden") === "true") return "";
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  return [...node.childNodes].map(heard).join("");
}

/** The open task's tab as `openTab` gives it, its column showing `tab` and its side panel as given. */
function onTab(
  tasks: TasksControl,
  tab: MainTab,
  sidePanel: Partial<TasksControl["sidePanel"]> = {},
): TasksControl {
  return {
    ...tasks,
    mainTabs: { ...tasks.mainTabs, tabs: [MAIN_TAB.CALL, AGENT_TAB], tab },
    sidePanel: { ...tasks.sidePanel, ...sidePanel },
    agents: codingAgentsControl({ agents: [AGENT], agentIds: [AGENT.id] }),
  };
}

/** Lays the task's Inbox tab out this wide, as the window would report it resized. */
function layOutInbox(page: HTMLElement, width: number): void {
  const inbox =
    page.querySelector<HTMLElement>("section.inbox-view") ?? assert.fail("the Inbox tab is drawn");
  vi.spyOn(inbox, "getBoundingClientRect").mockReturnValue(
    DOMRect.fromRect({ width, height: 800 }),
  );
  act(() => relayout());
}

test("a plan whose repository its workspace cannot reach and another of the account's can names that workspace by its tile and name, and its press moves it there through the move's dialog", async () => {
  const moves: [string, string][] = [];
  const page = openTask(
    openTab(TASK, [STUDIO, NORTHWIND, ACME], (taskId, workspaceId) => {
      moves.push([taskId, workspaceId]);
      return Promise.resolve(true);
    }),
  );
  const banner = strandedBanner(page) ?? assert.fail("the stranded plan says so");
  const words = document.getElementById(banner.getAttribute("aria-labelledby") ?? "");
  assert.equal(words === null ? undefined : heard(words), "This task's repository belongs to Acme");
  assert.equal(banner.querySelector(".workspace-ref .workspace-tile")?.textContent, "A");
  for (const element of [banner, ...banner.querySelectorAll("*")]) {
    for (const attribute of element.attributes) {
      assert.doesNotMatch(attribute.value, /Acme|Studio|acme-corp/u, attribute.name);
    }
  }

  act(() => button(banner, "Move to Acme").click());
  const moving = dialog() ?? assert.fail("the press opens Move to workspace");
  assert.equal(
    moving.querySelector('[aria-checked="true"]')?.textContent?.includes("Acme"),
    true,
    "the dialog opens on the workspace that reaches the repository",
  );
  act(() => button(moving, "Move to Acme").click());
  await settle();

  assert.deepEqual(moves, [[TASK.id, ACME.id]]);
});

test("a stranded plan's banner stands over every tab of the plan: its Call beside its Inbox too narrow for its list and item side by side, an agent's beside the plan, and over the side panel filling the window", () => {
  const tasks = openTab(TASK, [STUDIO, ACME]);
  const inboxShown = {
    open: true,
    tabs: [SIDE_PANEL_TAB.PLAN, SIDE_PANEL_TAB.INBOX],
    strip: [SIDE_PANEL_TAB.PLAN, SIDE_PANEL_TAB.INBOX],
    tab: SIDE_PANEL_TAB.INBOX,
  };
  const inbox = openTask(onTab(tasks, MAIN_TAB.CALL, inboxShown));
  layOutInbox(inbox, 700);
  const agent = openTask(onTab(tasks, AGENT_TAB, { open: true, tab: SIDE_PANEL_TAB.PLAN }));
  const full = openTask(
    onTab(tasks, MAIN_TAB.CALL, { open: true, fullScreen: true, tab: SIDE_PANEL_TAB.PLAN }),
  );

  assert.equal(inbox.querySelector(".inbox-view")?.getAttribute("data-columns"), "list");
  assert.deepEqual(
    [inbox, agent, full].map((page) => {
      const banner = strandedBanner(page);
      return [
        banner === null ? undefined : heard(banner),
        banner?.closest(".desktop-task-main, .side-panel")?.className,
      ];
    }),
    [
      ["This task's repository belongs to AcmeMove to Acme", "desktop-task-main"],
      ["This task's repository belongs to AcmeMove to Acme", "desktop-task-main"],
      ["This task's repository belongs to AcmeMove to Acme", "side-panel"],
    ],
  );
});

test("no banner stands over any tab of a plan its own workspace reaches, one no other workspace's active GitHub reaches, one with no repository, or a teammate's", () => {
  const suspended = { ...ACME, github: { login: "acme-corp", active: false } };
  const cases: [Task, readonly Workspace[]][] = [
    [{ ...TASK, workspaceId: ACME.id }, [STUDIO, ACME]],
    [TASK, [STUDIO, NORTHWIND, OCTO]],
    [TASK, [STUDIO, suspended]],
    [{ ...TASK, repository: null }, [STUDIO, ACME]],
    [{ ...TASK, ownerId: SAM }, [STUDIO, ACME]],
  ];
  const banners = cases.flatMap(([task, workspaces]) =>
    [MAIN_TAB.CALL, AGENT_TAB].map((tab) => {
      const page = openTask(onTab(openTab(task, workspaces), tab));
      const found = strandedBanner(page) !== null;
      unmountAll();
      return found;
    }),
  );

  assert.deepEqual(
    banners,
    Array.from({ length: cases.length * 2 }, () => false),
  );
});
