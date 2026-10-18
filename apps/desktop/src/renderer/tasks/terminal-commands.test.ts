// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CODING_AGENT_STATUS, type CodingAgentSummary } from "@luke/features/coding-agent-wire";
import type { Task, TaskSummary } from "@luke/features/task-wire";
import { shellsAsked } from "@luke/features/terminal-store";
import { SANDBOX_STATE } from "@luke/features/terminal-wire";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act, type ActOutcome } from "@luke/host/acts";
import { runAppCommand } from "@luke/panel/app-commands";
import { MAIN_TAB, type MainTab } from "@luke/panel/tasks/use-main-tabs";
import { SIDE_PANEL_TAB, type SidePanelTab } from "@luke/panel/tasks/use-side-panel";
import { NO_LOOKS } from "@luke/panel/tasks/use-task-looks";
import { fakeAppBridge } from "@luke/panel/testing/app-bridge";
import { DESKTOP_CAPABILITIES, handCapabilities } from "@luke/panel/testing/app-state";
import { onRegistry } from "@luke/panel/testing/copy-feedback";
import { installScrollIntoView } from "@luke/panel/testing/scroll-into-view";
import { HOST_CAPABILITY, type HostCapability } from "@luke/settings";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import type { StripTab } from "@luke/ui/tab-strip-model";
import { DOCUMENT_REGION, TASKS_PAGE } from "@luke/ui/tasks-model";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { codingAgentsControl, tasksControl, UNPINNED_SUMMARY } from "#testing/tasks-control";
import { DesktopTasks } from "../desktop/desktop-tasks";

/**
 * Show terminal (⌘J) and New terminal from each place a developer can be,
 * as the new-terminal rules have them: which agent's Terminal tab the side
 * panel is asked to show, whether a new shell is asked of its sandbox, and
 * the picker where the rules leave the agent to the developer. The task is
 * drawn by the real window over a staged control; main answers how each
 * sandbox stands.
 */

const TASK: Task = {
  id: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  workspaceId: "workspace-personal",
  name: "Teammate invitations",
  createdAt: 1,
  updatedAt: 2,
  repository: "acme/relay",
  document: { body: "", assumptions: [] },
};

const SUMMARY: TaskSummary = {
  id: TASK.id,
  workspaceId: TASK.workspaceId,
  name: TASK.name,
  createdAt: TASK.createdAt,
  updatedAt: TASK.updatedAt,
  repository: TASK.repository,
};

/** An agent on the task, standing where `status` says. */
function agent(
  id: string,
  title: string,
  status: CodingAgentSummary["status"],
): CodingAgentSummary {
  return {
    id,
    planId: TASK.id,
    model: "openai/gpt-5.6-sol",
    effort: "high",
    title,
    createdAt: 1,
    status,
    turnId: null,
  };
}

const WORKING = agent(
  "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
  "Invite flow",
  CODING_AGENT_STATUS.RUNNING,
);
const DONE = agent(
  "9d2b7b5f-4e3f-4e9c-9c77-7a5d8b3f4c32",
  "Expiry job",
  CODING_AGENT_STATUS.COMPLETED,
);

const roots: Root[] = [];

beforeEach(() => {
  installScrollIntoView();
  // Main answers how each agent's sandbox stands: the working agent's runs, the other's is stopped.
  fakeAppBridge({
    act: (request: Act): Promise<ActOutcome> => {
      if (request.kind !== ACT_KIND.TERMINAL_LIST) {
        return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: undefined });
      }
      const running = request.payload.agentId === WORKING.id;
      return Promise.resolve({
        status: ACT_OUTCOME_STATUS.DONE,
        value: running
          ? { sandbox: SANDBOX_STATE.RUNNING, terminals: [] }
          : { sandbox: SANDBOX_STATE.STOPPED, terminals: [] },
      });
    },
  });
  handCapabilities(DESKTOP_CAPABILITIES);
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** Lets main's answers, and the redraws they cause, land. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

/** The task drawn with the agents given, its column on `main` and the panel on `side`, answering what the panel was asked to show. */
async function mount(input: {
  /** The task's agents, or nothing while their read is out. */
  agents: readonly CodingAgentSummary[] | undefined;
  /** Why no agent can start now, where none can. */
  cannotStart?: string;
  main?: MainTab;
  side?: SidePanelTab;
  lastTerminal?: string;
  started?: () => void;
}) {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  const registry = AtomRegistry.make();
  const shown: StripTab[] = [];
  const base = tasksControl();
  const listed = input.agents ?? [];
  const agentTabs = listed.map((each) => ({ agent: each.id }));
  const tasks = tasksControl({
    page: TASKS_PAGE.DOCUMENT,
    tasks: [SUMMARY],
    activeTaskId: TASK.id,
    region: { kind: DOCUMENT_REGION.READY, task: TASK },
    mainTabs: {
      ...base.mainTabs,
      tabs: [MAIN_TAB.PLAN, ...agentTabs],
      tab: input.main ?? MAIN_TAB.PLAN,
      openAgents: listed.map((each) => each.id),
    },
    sidePanel: {
      ...base.sidePanel,
      open: input.side !== undefined,
      tab: input.side,
      lastTerminal: input.lastTerminal,
      onChoose: (tab) => shown.push(tab),
    },
    agents: codingAgentsControl({
      agents: input.agents === undefined ? undefined : [...input.agents],
      agentIds: input.agents?.map((each) => each.id),
      start: {
        available: input.cannotStart === undefined,
        reason: input.cannotStart,
        busy: false,
        note: undefined,
        onPress: () => input.started?.(),
      },
    }),
  });
  act(() =>
    root.render(
      onRegistry(
        registry,
        createElement(DesktopTasks, { summary: UNPINNED_SUMMARY, looks: NO_LOOKS, tasks }),
      ),
    ),
  );
  // The document arrives a few microtasks after the window first draws.
  await settle();
  return {
    /** Every tab the side panel was asked to show, in order. */
    shown,
    /** How many new shells were asked of the agent's sandbox and not yet started. */
    asked: (agentId: string) => registry.get(shellsAsked(agentId)),
    run: async (command: typeof APP_COMMAND.SHOW_TERMINAL | typeof APP_COMMAND.NEW_TERMINAL) => {
      act(() => {
        runAppCommand(command);
      });
      await settle();
    },
  };
}

/** The picker, while it stands: what its field asks, and its rows' names, details, and which is chosen. */
function picker() {
  const dialog = document.querySelector('[role="dialog"].terminal-picker');
  if (dialog === null) return undefined;
  return {
    question: dialog.querySelector("input")?.getAttribute("placeholder"),
    rows: [...dialog.querySelectorAll('[role="option"]')].map((row) => ({
      name: row.querySelector(".luke-combobox-option-label")?.textContent,
      detail: row.querySelector(".luke-combobox-option-detail")?.textContent,
      chosen: row.getAttribute("aria-selected") === "true",
    })),
    choose: async (name: string) => {
      const row = [...dialog.querySelectorAll<HTMLElement>('[role="option"]')].find(
        (each) => each.querySelector(".luke-combobox-option-label")?.textContent === name,
      );
      assert.ok(row, `a row named ${name}`);
      await act(async () => row.click());
      await settle();
    },
  };
}

test("on a plan with one agent, ⌘J shows its Terminal tab and New terminal asks its sandbox for a new shell there", async () => {
  const task = await mount({ agents: [WORKING] });
  await task.run(APP_COMMAND.SHOW_TERMINAL);
  assert.deepEqual(task.shown, [{ terminal: WORKING.id }]);
  assert.equal(task.asked(WORKING.id), 0);
  await task.run(APP_COMMAND.NEW_TERMINAL);
  assert.deepEqual(task.shown, [{ terminal: WORKING.id }, { terminal: WORKING.id }]);
  assert.equal(task.asked(WORKING.id), 1);
  assert.equal(picker(), undefined);
});

test("from an agent's own tab, both mean that agent, whatever else is on the plan", async () => {
  const task = await mount({
    agents: [WORKING, DONE],
    main: { agent: DONE.id },
    lastTerminal: WORKING.id,
  });
  await task.run(APP_COMMAND.SHOW_TERMINAL);
  await task.run(APP_COMMAND.NEW_TERMINAL);
  assert.deepEqual(task.shown, [{ terminal: DONE.id }, { terminal: DONE.id }]);
});

test("with several agents, ⌘J shows the terminal used last, and New terminal asks with that one chosen and said", async () => {
  const task = await mount({ agents: [WORKING, DONE], lastTerminal: DONE.id });
  await task.run(APP_COMMAND.SHOW_TERMINAL);
  assert.deepEqual(task.shown, [{ terminal: DONE.id }]);
  await task.run(APP_COMMAND.NEW_TERMINAL);
  const asked = picker();
  assert.equal(asked?.question, "New terminal in which agent’s sandbox?");
  assert.deepEqual(asked?.rows, [
    { name: "Invite flow", detail: "Working · sandbox running", chosen: false },
    { name: "Expiry job", detail: "Idle · sandbox stopped · last used", chosen: true },
  ]);
  await asked?.choose("Invite flow");
  assert.deepEqual(task.shown.at(-1), { terminal: WORKING.id });
  assert.equal(task.asked(WORKING.id), 1);
  assert.equal(picker(), undefined);
});

test("with several agents and no terminal used yet, ⌘J asks, and the agent picked has its terminal shown, no shell added", async () => {
  const task = await mount({ agents: [WORKING, DONE] });
  await task.run(APP_COMMAND.SHOW_TERMINAL);
  assert.deepEqual(task.shown, []);
  await picker()?.choose("Expiry job");
  assert.deepEqual(task.shown, [{ terminal: DONE.id }]);
  assert.equal(task.asked(DONE.id), 0);
});

test("with no agent on the plan, the picker offers to start one", async () => {
  let started = 0;
  const task = await mount({ agents: [], started: () => (started += 1) });
  await task.run(APP_COMMAND.NEW_TERMINAL);
  assert.deepEqual(picker()?.rows, [
    { name: "Start a coding agent", detail: undefined, chosen: true },
  ]);
  await picker()?.choose("Start a coding agent");
  assert.equal(started, 1);
  assert.deepEqual(task.shown, []);
});

test("the panel's + lists each agent's terminal under Terminal, says how it stands, and a pick adds a shell to that agent's sandbox", async () => {
  const task = await mount({
    agents: [WORKING, DONE],
    side: SIDE_PANEL_TAB.BOARD,
    lastTerminal: DONE.id,
  });
  const add = document.querySelector<HTMLButtonElement>(
    '.side-panel-tabs button[aria-label="Open a tab"]',
  );
  assert.ok(add, "the panel's +");
  await act(async () => add.click());
  await settle();
  const rows = [...document.querySelectorAll<HTMLElement>('.tab-add-menu [role="option"]')].filter(
    (row) => row.closest('[role="group"]')?.textContent?.startsWith("Terminal") === true,
  );
  assert.deepEqual(
    rows.map((row) => [
      row.querySelector(".luke-combobox-option-label")?.textContent,
      row.querySelector(".luke-combobox-option-hint") !== null,
    ]),
    [
      ["Invite flow", false],
      ["Expiry job", true],
    ],
  );
  await act(async () => rows[0]?.click());
  assert.deepEqual(task.shown.at(-1), { terminal: WORKING.id });
  assert.equal(task.asked(WORKING.id), 1);
});

/** The open menu's item named `label`: whether it shows a shortcut and what, and a press of it, the menu closing behind. */
function menuItem(label: string) {
  const menu = document.querySelector<HTMLElement>('[role="menu"]:not([data-leaving])');
  assert.ok(menu, "a menu stands open");
  const item = [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
    (each) => each.querySelector(".luke-menu-item-label")?.textContent === label,
  );
  assert.ok(item, `the menu offers ${label}`);
  return {
    hint: item.querySelector(".luke-menu-item-hint")?.textContent,
    press: async () => {
      await act(async () => item.click());
      await settle();
    },
  };
}

/** Opens the right-click menu of the task's column's tab named `name`. */
function rightClickTab(name: string): void {
  const tab = [
    ...document.querySelectorAll<HTMLElement>('.desktop-task-main .desktop-toolbar [role="tab"]'),
  ].find((each) => each.textContent?.includes(name) === true);
  assert.ok(tab, `the column has a tab named ${name}`);
  act(() => {
    tab.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 20 }),
    );
  });
}

test("an agent's tab offers Open terminal on its right-click and its bar's ⋯, which opens that agent's own terminal, adding no shell, and its composer wears no Terminal chip", async () => {
  const task = await mount({
    agents: [WORKING, DONE],
    main: { agent: WORKING.id },
    lastTerminal: DONE.id,
  });
  assert.ok(document.querySelector(".agent-composer"), "the agent's composer is drawn");
  assert.equal(
    document.querySelector('.agent-composer button[aria-label="Show terminal"]'),
    null,
    "the composer wears no Terminal chip",
  );
  // The chosen tab's ⋯ in the column's bar says ⌘J, which opens the same terminal from here.
  const more = document.querySelector<HTMLButtonElement>(
    ".desktop-task-main .desktop-toolbar .toolbar-tab-actions button",
  );
  assert.ok(more, "the bar shows the agent's tab's ⋯");
  act(() => more.click());
  const fromMore = menuItem("Open terminal");
  assert.equal(fromMore.hint, "⌘J");
  await fromMore.press();
  assert.deepEqual(task.shown, [{ terminal: WORKING.id }]);
  // The chosen tab's right-click says ⌘J too.
  rightClickTab("Invite flow");
  const fromChosen = menuItem("Open terminal");
  assert.equal(fromChosen.hint, "⌘J");
  await fromChosen.press();
  assert.deepEqual(task.shown.at(-1), { terminal: WORKING.id });
  // Another agent's tab opens its own terminal, which ⌘J would not from here, so it says no shortcut.
  rightClickTab("Expiry job");
  const fromOther = menuItem("Open terminal");
  assert.equal(fromOther.hint, undefined);
  await fromOther.press();
  assert.deepEqual(task.shown.at(-1), { terminal: DONE.id });
  assert.equal(task.asked(WORKING.id), 0);
  assert.equal(task.asked(DONE.id), 0);
});

/** The labels of the menu standing open. */
function menuLabels(): string[] {
  const menu = document.querySelector<HTMLElement>('[role="menu"]:not([data-leaving])');
  assert.ok(menu, "a menu stands open");
  return [...menu.querySelectorAll(".luke-menu-item-label")].map((each) => each.textContent ?? "");
}

/** The task drawn as `mount` draws it, on a platform offering `capabilities`. */
async function mountOn(
  capabilities: readonly HostCapability[],
  input: Parameters<typeof mount>[0],
): ReturnType<typeof mount> {
  handCapabilities(capabilities);
  return mount(input);
}

test("on a platform that runs no terminals, neither ⌘J nor New terminal stands, the panel's + offers no Terminal, and an agent's tab offers neither Open terminal nor Run", async () => {
  const offered = (each: HostCapability) =>
    each !== HOST_CAPABILITY.TERMINALS && each !== HOST_CAPABILITY.MAC_TERMINAL;
  await mountOn(DESKTOP_CAPABILITIES, {
    agents: [WORKING],
    main: { agent: WORKING.id },
  });
  rightClickTab("Invite flow");
  const onDesktop = menuLabels();
  act(() => roots.pop()?.unmount());

  await mountOn(DESKTOP_CAPABILITIES.filter(offered), {
    agents: [WORKING],
    main: { agent: WORKING.id },
    side: SIDE_PANEL_TAB.BOARD,
  });
  rightClickTab("Invite flow");
  const without = menuLabels();
  assert.equal(runAppCommand(APP_COMMAND.SHOW_TERMINAL), false);
  assert.equal(runAppCommand(APP_COMMAND.NEW_TERMINAL), false);
  const add = document.querySelector<HTMLButtonElement>(
    '.side-panel-tabs button[aria-label="Open a tab"]',
  );
  assert.ok(add, "the panel's +");
  await act(async () => add.click());
  await settle();
  const groups = [...document.querySelectorAll('.tab-add-menu [role="group"]')].map(
    (group) => group.textContent ?? "",
  );

  assert.ok(
    onDesktop.includes("Open terminal") && onDesktop.includes("Run"),
    "the desktop offers both",
  );
  assert.equal(without.includes("Open terminal"), false);
  assert.equal(without.includes("Run"), false);
  assert.equal(
    groups.some((group) => group.startsWith("Terminal")),
    false,
  );
});

test("where no agent can start, the picker says why beside the offer and starts nothing", async () => {
  let started = 0;
  const task = await mount({
    agents: [],
    cannotStart: "Choose a repository first",
    started: () => (started += 1),
  });
  await task.run(APP_COMMAND.NEW_TERMINAL);
  assert.deepEqual(picker()?.rows, [
    { name: "Start a coding agent", detail: "Choose a repository first", chosen: false },
  ]);
  await picker()?.choose("Start a coding agent");
  assert.equal(started, 0);
});

test("while the plan's agents are still being read, the picker says so and offers to start none", async () => {
  const task = await mount({ agents: undefined });
  await task.run(APP_COMMAND.NEW_TERMINAL);
  assert.deepEqual(picker()?.rows, []);
  assert.equal(
    document.querySelector(".terminal-picker .command-palette-empty")?.textContent,
    "Reading the task’s agents…",
  );
  assert.deepEqual(task.shown, []);
});
