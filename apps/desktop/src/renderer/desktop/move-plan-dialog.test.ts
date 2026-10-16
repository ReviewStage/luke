// @vitest-environment jsdom

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { CODING_AGENT_STATUS, type CodingAgentSummary } from "@luke/features/coding-agent-wire";
import type { Plan } from "@luke/features/plan-wire";
import { WORKSPACE_ROLE, type Workspace } from "@luke/features/workspace-wire";
import { DOCUMENT_REGION, PLANS_PAGE } from "@luke/ui/planning-model";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { ellipsized } from "#testing/action-label";
import { codingAgentsControl, plansControl, UNPINNED_SUMMARY } from "#testing/plans-control";
import { relayout } from "#testing/resize-observer";
import { installScrollIntoView } from "#testing/scroll-into-view";
import { MAIN_TAB, type MainTab } from "../planning/use-main-tabs";
import { NO_LOOKS } from "../planning/use-plan-looks";
import type { PlansControl } from "../planning/use-plans-tab";
import { SIDE_PANEL_TAB } from "../planning/use-side-panel";
import { DesktopPlans } from "./desktop-plans";

/**
 * move-plan-dialog.test.ts -- Move to workspace in the open plan's ⋯: offered
 * to the plan's owner while the account has another workspace, it lists the
 * other workspaces, disables one whose GitHub cannot reach the plan's
 * repository with the reason, says who loses and gains the plan, and moves
 * it, closing on a move and staying up saying so on a refusal. A plan
 * stranded in a workspace that cannot reach its repository says so over
 * every tab of it, naming the workspace that can. Synthetic throughout.
 */

/** The window's own stylesheet, which says how tall the dialog may stand. */
const DESKTOP_CSS = readFileSync(path.join(import.meta.dirname, "../styles/desktop.css"), "utf8");

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

const PLAN: Plan = {
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
  planId: PLAN.id,
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "Retry the webhook",
  createdAt: 1,
  status: CODING_AGENT_STATUS.COMPLETED,
  turnId: null,
};

/** The agent's tab in the plan's column. */
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

/** The open plan's tab, read by Dana, the plan as given open and listed. */
function openTab(
  plan: Plan,
  workspaces: readonly Workspace[],
  onMovePlan: PlansControl["onMovePlan"] = () => Promise.resolve(false),
): PlansControl {
  return plansControl({
    page: PLANS_PAGE.DOCUMENT,
    me: DANA,
    plans: [plan],
    activePlanId: plan.id,
    region: { kind: DOCUMENT_REGION.READY, plan },
    workspaces,
    workspace: workspaces.find((workspace) => workspace.id === plan.workspaceId),
    onMovePlan,
  });
}

/** Mounts the tab's toolbar and opens its ⋯ menu. */
function openMenu(plans: PlansControl): void {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(createElement(DesktopPlans, { summary: UNPINNED_SUMMARY, looks: NO_LOOKS, plans })),
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
  openMenu(openTab(PLAN, [STUDIO, ACME]));
  const own = menuLabels();
  unmountAll();
  openMenu(openTab({ ...PLAN, ownerId: SAM }, [STUDIO, ACME]));
  const teammates = menuLabels();
  unmountAll();
  openMenu(openTab(PLAN, [STUDIO]));
  const alone = menuLabels();

  assert.ok(own.includes("Move to workspace"), "the owner is offered the move");
  assert.deepEqual(ellipsized(own), [], "no item of the ⋯ ends with an ellipsis");
  assert.ok(!teammates.includes("Move to workspace"), "a teammate's plan is not theirs to move");
  assert.ok(!alone.includes("Move to workspace"), "a single workspace has nowhere to move to");
});

test("the dialog lists the other workspaces, disables one whose GitHub cannot reach the repository with why, chooses the first that can, says what the move does, and moves the plan there", async () => {
  const moves: [string, string][] = [];
  openMenu(
    openTab(PLAN, [STUDIO, NORTHWIND, OCTO, ACME], (planId, workspaceId) => {
      moves.push([planId, workspaceId]);
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

  assert.deepEqual(moves, [[PLAN.id, ACME.id]]);
  assert.equal(dialog(), null, "a move landed puts the dialog away");
});

test("a row calls the account's own first workspace personal while no one else is in it, and counts the one member of a team no one has joined yet", () => {
  const personal: Workspace = { ...STUDIO, id: "ws-personal", name: "Dana", memberCount: 1 };
  const fresh: Workspace = { ...NORTHWIND, id: "ws-fresh", name: "Platform", memberCount: 1 };
  openMenu(openTab({ ...PLAN, repository: null }, [personal, STUDIO, fresh]));

  const rows = [...chooseMove().querySelectorAll('[role="radio"] .workspace-ref-line')].map(
    (line) => line.textContent,
  );

  assert.deepEqual(rows, ["Personal workspace", "1 member"]);
});

test("a refused move keeps the dialog up, saying so under the list", async () => {
  openMenu(openTab({ ...PLAN, repository: null }, [STUDIO, NORTHWIND]));
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

test("the dialog is never taller than the window: its workspaces scroll inside the card, and its title and answers stand outside them", () => {
  document.head.appendChild(document.createElement("style")).textContent = DESKTOP_CSS;
  openMenu(openTab(PLAN, [STUDIO, NORTHWIND, OCTO, ACME]));
  const moving = chooseMove();

  const list = moving.querySelector<HTMLElement>('[role="radiogroup"]') ?? assert.fail("the rows");
  const answers = button(moving, "Cancel").parentElement ?? assert.fail("the answers");
  assert.match(getComputedStyle(moving).maxHeight, /100vh/u, "the card is capped at the window");
  assert.deepEqual(
    [getComputedStyle(list).overflowY, getComputedStyle(list).minHeight],
    ["auto", "0px"],
    "the rows give way and scroll",
  );
  assert.ok(!list.contains(answers) && !list.contains(moving.querySelector("h2")));
});

/** Mounts the open plan's page, its menu left closed. */
function openPlan(plans: PlansControl): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(createElement(DesktopPlans, { summary: UNPINNED_SUMMARY, looks: NO_LOOKS, plans })),
  );
  return container;
}

/** The plan-wide banner over a stranded plan, where one stands. */
function strandedBanner(within: HTMLElement): HTMLElement | null {
  return within.querySelector<HTMLElement>(".plan-banner");
}

/** The words a reader hears in an element: its text but for a mark hidden from a screen reader, a workspace's tile's letter among them. */
function heard(node: Node): string {
  if (node instanceof Element && node.getAttribute("aria-hidden") === "true") return "";
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  return [...node.childNodes].map(heard).join("");
}

/** The open plan's tab as `openTab` gives it, its column showing `tab` and its side panel as given. */
function onTab(
  plans: PlansControl,
  tab: MainTab,
  sidePanel: Partial<PlansControl["sidePanel"]> = {},
): PlansControl {
  return {
    ...plans,
    mainTabs: { ...plans.mainTabs, tabs: [MAIN_TAB.PLAN, MAIN_TAB.INBOX, AGENT_TAB], tab },
    sidePanel: { ...plans.sidePanel, ...sidePanel },
    agents: codingAgentsControl({ agents: [AGENT], agentIds: [AGENT.id] }),
  };
}

/** Lays the plan's Inbox tab out this wide, as the window would report it resized. */
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
  const page = openPlan(
    openTab(PLAN, [STUDIO, NORTHWIND, ACME], (planId, workspaceId) => {
      moves.push([planId, workspaceId]);
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

  assert.deepEqual(moves, [[PLAN.id, ACME.id]]);
});

test("a stranded plan's banner stands over every tab of the plan: its Inbox too narrow for its list and item side by side, an agent's, beside the side panel, and over the side panel filling the window", () => {
  const plans = openTab(PLAN, [STUDIO, ACME]);
  const inbox = openPlan(onTab(plans, MAIN_TAB.INBOX));
  layOutInbox(inbox, 700);
  const agent = openPlan(onTab(plans, AGENT_TAB, { open: true, tab: SIDE_PANEL_TAB.CALL }));
  const full = openPlan(
    onTab(plans, MAIN_TAB.PLAN, { open: true, fullScreen: true, tab: SIDE_PANEL_TAB.CALL }),
  );

  assert.equal(inbox.querySelector(".inbox-view")?.getAttribute("data-columns"), "list");
  assert.deepEqual(
    [inbox, agent, full].map((page) => {
      const banner = strandedBanner(page);
      return [
        banner === null ? undefined : heard(banner),
        banner?.closest(".desktop-plan-main, .side-panel")?.className,
      ];
    }),
    [
      ["This task's repository belongs to AcmeMove to Acme", "desktop-plan-main"],
      ["This task's repository belongs to AcmeMove to Acme", "desktop-plan-main"],
      ["This task's repository belongs to AcmeMove to Acme", "side-panel"],
    ],
  );
});

test("no banner stands over any tab of a plan its own workspace reaches, one no other workspace's active GitHub reaches, one with no repository, or a teammate's", () => {
  const suspended = { ...ACME, github: { login: "acme-corp", active: false } };
  const cases: [Plan, readonly Workspace[]][] = [
    [{ ...PLAN, workspaceId: ACME.id }, [STUDIO, ACME]],
    [PLAN, [STUDIO, NORTHWIND, OCTO]],
    [PLAN, [STUDIO, suspended]],
    [{ ...PLAN, repository: null }, [STUDIO, ACME]],
    [{ ...PLAN, ownerId: SAM }, [STUDIO, ACME]],
  ];
  const banners = cases.flatMap(([plan, workspaces]) =>
    [MAIN_TAB.PLAN, MAIN_TAB.INBOX, AGENT_TAB].map((tab) => {
      const page = openPlan(onTab(openTab(plan, workspaces), tab));
      const found = strandedBanner(page) !== null;
      unmountAll();
      return found;
    }),
  );

  assert.deepEqual(
    banners,
    Array.from({ length: cases.length * 3 }, () => false),
  );
});
