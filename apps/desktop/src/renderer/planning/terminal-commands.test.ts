// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CODING_AGENT_STATUS, type CodingAgentSummary } from "@luke/features/coding-agent-wire";
import type { Plan, PlanSummary } from "@luke/features/plan-wire";
import { SANDBOX_STATE } from "@luke/features/terminal-wire";
import { ACT_KIND, ACT_OUTCOME_STATUS, type Act, type ActOutcome } from "@luke/host/acts";
import type { StripTab } from "@luke/ui/tab-strip-model";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { APP_COMMAND } from "#shared/shortcuts";
import { onRegistry } from "#testing/copy-feedback";
import { codingAgentsControl, plansControl, UNPINNED_SUMMARY } from "#testing/plans-control";
import { installScrollIntoView } from "#testing/scroll-into-view";
import { runAppCommand } from "../app-commands";
import { DesktopPlans } from "../desktop/desktop-plans";
import { DOCUMENT_REGION, PLANS_PAGE } from "./planning-model";
import { shellsAsked } from "./terminal-store";
import { MAIN_TAB, type MainTab } from "./use-main-tabs";
import { NO_LOOKS } from "./use-plan-looks";
import { SIDE_PANEL_TAB, type SidePanelTab } from "./use-side-panel";

/**
 * Show terminal (⌘J) and New terminal from each place a developer can be,
 * as the new-terminal rules have them: which agent's Terminal tab the side
 * panel is asked to show, whether a new shell is asked of its sandbox, and
 * the picker where the rules leave the agent to the developer. The plan is
 * drawn by the real window over a staged control; main answers how each
 * sandbox stands.
 */

const PLAN: Plan = {
  id: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  workspaceId: "workspace-personal",
  name: "Teammate invitations",
  createdAt: 1,
  updatedAt: 2,
  repository: "acme/relay",
  document: { body: "", assumptions: [] },
};

const SUMMARY: PlanSummary = {
  id: PLAN.id,
  workspaceId: PLAN.workspaceId,
  name: PLAN.name,
  createdAt: PLAN.createdAt,
  updatedAt: PLAN.updatedAt,
  repository: PLAN.repository,
};

/** An agent on the plan, standing where `status` says. */
function agent(
  id: string,
  title: string,
  status: CodingAgentSummary["status"],
): CodingAgentSummary {
  return {
    id,
    planId: PLAN.id,
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
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: {
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
      onMenuCommand: () => () => undefined,
    },
  });
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

/** The plan drawn with the agents given, its column on `main` and the panel on `side`, answering what the panel was asked to show. */
function mount(input: {
  /** The plan's agents, or nothing while their read is out. */
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
  const base = plansControl();
  const listed = input.agents ?? [];
  const agentTabs = listed.map((each) => ({ agent: each.id }));
  const plans = plansControl({
    page: PLANS_PAGE.DOCUMENT,
    plans: [SUMMARY],
    activePlanId: PLAN.id,
    region: { kind: DOCUMENT_REGION.READY, plan: PLAN },
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
        createElement(DesktopPlans, { summary: UNPINNED_SUMMARY, looks: NO_LOOKS, plans }),
      ),
    ),
  );
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
      name: row.querySelector(".command-palette-name")?.textContent,
      detail: row.querySelector(".command-palette-detail")?.textContent,
      chosen: row.getAttribute("aria-selected") === "true",
    })),
    choose: async (name: string) => {
      const row = [...dialog.querySelectorAll<HTMLElement>('[role="option"]')].find(
        (each) => each.querySelector(".command-palette-name")?.textContent === name,
      );
      assert.ok(row, `a row named ${name}`);
      await act(async () => row.click());
      await settle();
    },
  };
}

test("on a plan with one agent, ⌘J shows its Terminal tab and New terminal asks its sandbox for a new shell there", async () => {
  const plan = mount({ agents: [WORKING] });
  await plan.run(APP_COMMAND.SHOW_TERMINAL);
  assert.deepEqual(plan.shown, [{ terminal: WORKING.id }]);
  assert.equal(plan.asked(WORKING.id), 0);
  await plan.run(APP_COMMAND.NEW_TERMINAL);
  assert.deepEqual(plan.shown, [{ terminal: WORKING.id }, { terminal: WORKING.id }]);
  assert.equal(plan.asked(WORKING.id), 1);
  assert.equal(picker(), undefined);
});

test("from an agent's own tab, both mean that agent, whatever else is on the plan", async () => {
  const plan = mount({
    agents: [WORKING, DONE],
    main: { agent: DONE.id },
    lastTerminal: WORKING.id,
  });
  await plan.run(APP_COMMAND.SHOW_TERMINAL);
  await plan.run(APP_COMMAND.NEW_TERMINAL);
  assert.deepEqual(plan.shown, [{ terminal: DONE.id }, { terminal: DONE.id }]);
});

test("with several agents, ⌘J shows the terminal used last, and New terminal asks with that one chosen and said", async () => {
  const plan = mount({ agents: [WORKING, DONE], lastTerminal: DONE.id });
  await plan.run(APP_COMMAND.SHOW_TERMINAL);
  assert.deepEqual(plan.shown, [{ terminal: DONE.id }]);
  await plan.run(APP_COMMAND.NEW_TERMINAL);
  const asked = picker();
  assert.equal(asked?.question, "New terminal in which agent’s sandbox?");
  assert.deepEqual(asked?.rows, [
    { name: "Invite flow", detail: "Working · sandbox running", chosen: false },
    { name: "Expiry job", detail: "Idle · sandbox stopped · last used", chosen: true },
  ]);
  await asked?.choose("Invite flow");
  assert.deepEqual(plan.shown.at(-1), { terminal: WORKING.id });
  assert.equal(plan.asked(WORKING.id), 1);
  assert.equal(picker(), undefined);
});

test("with several agents and no terminal used yet, ⌘J asks, and the agent picked has its terminal shown, no shell added", async () => {
  const plan = mount({ agents: [WORKING, DONE] });
  await plan.run(APP_COMMAND.SHOW_TERMINAL);
  assert.deepEqual(plan.shown, []);
  await picker()?.choose("Expiry job");
  assert.deepEqual(plan.shown, [{ terminal: DONE.id }]);
  assert.equal(plan.asked(DONE.id), 0);
});

test("with no agent on the plan, the picker offers to start one", async () => {
  let started = 0;
  const plan = mount({ agents: [], started: () => (started += 1) });
  await plan.run(APP_COMMAND.NEW_TERMINAL);
  assert.deepEqual(picker()?.rows, [
    { name: "Start a coding agent", detail: undefined, chosen: true },
  ]);
  await picker()?.choose("Start a coding agent");
  assert.equal(started, 1);
  assert.deepEqual(plan.shown, []);
});

test("the panel's + lists each agent's terminal under Terminal, says how it stands, and a pick adds a shell to that agent's sandbox", async () => {
  const plan = mount({
    agents: [WORKING, DONE],
    side: SIDE_PANEL_TAB.BOARD,
    lastTerminal: DONE.id,
  });
  const add = document.querySelector<HTMLButtonElement>(".side-panel-tabs button.tab-add");
  assert.ok(add, "the panel's +");
  await act(async () => add.click());
  await settle();
  const rows = [...document.querySelectorAll<HTMLElement>('.tab-add-menu [role="option"]')].filter(
    (row) => row.closest('[role="group"]')?.textContent?.startsWith("Terminal") === true,
  );
  assert.deepEqual(
    rows.map((row) => [
      row.querySelector(".plan-compose-menu-name")?.textContent,
      row.querySelector(".menu-item-hint") !== null,
    ]),
    [
      ["Invite flow", false],
      ["Expiry job", true],
    ],
  );
  await act(async () => rows[0]?.click());
  assert.deepEqual(plan.shown.at(-1), { terminal: WORKING.id });
  assert.equal(plan.asked(WORKING.id), 1);
});

test("an agent's Terminal chip always opens that agent's own terminal, adding no shell", async () => {
  const plan = mount({
    agents: [WORKING, DONE],
    main: { agent: WORKING.id },
    lastTerminal: DONE.id,
  });
  const chip = document.querySelector<HTMLButtonElement>('button[aria-label="Show terminal"]');
  assert.ok(chip, "the agent's tab wears a Terminal chip");
  await act(async () => chip.click());
  assert.deepEqual(plan.shown, [{ terminal: WORKING.id }]);
  assert.equal(plan.asked(WORKING.id), 0);
});

test("where no agent can start, the picker says why beside the offer and starts nothing", async () => {
  let started = 0;
  const plan = mount({
    agents: [],
    cannotStart: "Choose a repository first",
    started: () => (started += 1),
  });
  await plan.run(APP_COMMAND.NEW_TERMINAL);
  assert.deepEqual(picker()?.rows, [
    { name: "Start a coding agent", detail: "Choose a repository first", chosen: false },
  ]);
  await picker()?.choose("Start a coding agent");
  assert.equal(started, 0);
});

test("while the plan's agents are still being read, the picker says so and offers to start none", async () => {
  const plan = mount({ agents: undefined });
  await plan.run(APP_COMMAND.NEW_TERMINAL);
  assert.deepEqual(picker()?.rows, []);
  assert.equal(
    document.querySelector(".terminal-picker .command-palette-empty")?.textContent,
    "Reading the plan’s agents…",
  );
  assert.deepEqual(plan.shown, []);
});
