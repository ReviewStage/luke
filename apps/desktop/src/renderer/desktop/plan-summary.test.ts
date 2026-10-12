// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CODING_AGENT_STATUS, type CodingAgentSummary } from "@sidecar/hosted/coding-agent-wire";
import type { Plan } from "@sidecar/hosted/plan-wire";
import {
  PLAN_WORK_PART,
  PLAN_WORK_STATE,
  PLAN_WORK_TOOL,
  type PlanCode,
} from "@sidecar/hosted/planning-view";
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import { codingAgentsControl, plansControl } from "#testing/plans-control";
import { relayout } from "#testing/resize-observer";
import { DOCUMENT_REGION, PLANS_PAGE } from "../planning/planning-model";
import { useMainTabs } from "../planning/use-main-tabs";
import { NO_LOOKS } from "../planning/use-plan-looks";
import type { PlansControl } from "../planning/use-plans-tab";
import { type PlanHolds, SIDE_PANEL_TAB, useSidePanel } from "../planning/use-side-panel";
import { workerCallIds } from "../planning/work-model";
import { DesktopPlans } from "./desktop-plans";
import { useSummaryPin } from "./plan-summary";
import { SidePanelToggle } from "./side-panel";

const PLAN: Plan = {
  id: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  name: "Teammate invitations",
  createdAt: 1,
  updatedAt: 2,
  repository: null,
  document: { body: "# Teammate invitations", assumptions: [] },
};

const AGENT: CodingAgentSummary = {
  id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
  planId: PLAN.id,
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: "Sign-out button in account menu",
  createdAt: 3,
  status: CODING_AGENT_STATUS.RUNNING,
  turnId: "9d2b7b5a-4e3f-4e9c-9c77-7a5d8b3f4c32",
};

const CODE: PlanCode = {
  ref: { path: "src/invite.ts", startLine: 1, endLine: 1 },
  repository: "acme/relay",
  firstLine: 1,
  lineCount: 1,
  lines: [[{ text: "export function accept() {}" }]],
};

const JOB = "Count the routes.";

/** Luke's planning model at work on the plan: one worker, still running. */
const WORK: PlansControl["work"] = {
  callLive: true,
  earlier: undefined,
  onLoadEarlier: () => Promise.resolve(),
  turns: [
    {
      turnId: "turn-1",
      startedAt: 1_000,
      state: PLAN_WORK_STATE.RUNNING,
      earlierOmitted: false,
      parts: [
        {
          type: PLAN_WORK_PART.TOOL,
          id: "call-worker",
          tool: PLAN_WORK_TOOL.WORKER,
          name: "worker",
          state: PLAN_WORK_STATE.RUNNING,
          subject: JOB,
          input: "{}",
          session: { earlierOmitted: false, parts: [] },
        },
      ],
    },
  ],
};

/** The plan has drawn on its board and been talked through, and nothing else. */
const HOLDS: PlanHolds = {
  [SIDE_PANEL_TAB.BOARD]: true,
  [SIDE_PANEL_TAB.CODE]: false,
  [SIDE_PANEL_TAB.TRANSCRIPT]: true,
  [SIDE_PANEL_TAB.WORK]: false,
};

const roots: Root[] = [];

/**
 * The open plan's page over the real tabs, side panel, and summary pin, with
 * the panel's toggle the window stands beside the page (desktop-shell.tsx),
 * the plan holding an agent, a worker, a file shown, and the board and
 * transcript used.
 */
function Page({ archived }: { archived: boolean }) {
  const plan = archived ? { ...PLAN, archivedAt: 4 } : PLAN;
  const agents = codingAgentsControl({
    agents: [AGENT],
    agentIds: [AGENT.id],
    ...(archived ? { onUnarchive: () => undefined } : undefined),
  });
  const mainTabs = useMainTabs(false, plan.id, agents.agentIds, undefined);
  const sidePanel = useSidePanel(
    undefined,
    { id: plan.id, holds: HOLDS },
    mainTabs.openAgents,
    workerCallIds(WORK.turns),
    [CODE.ref.path],
  );
  const summary = useSummaryPin(false);
  return createElement(
    Fragment,
    null,
    createElement(DesktopPlans, {
      looks: NO_LOOKS,
      summary,
      plans: plansControl({
        page: PLANS_PAGE.DOCUMENT,
        activePlanId: plan.id,
        region: { kind: DOCUMENT_REGION.READY, plan },
        mainTabs,
        sidePanel,
        agents,
        work: WORK,
        shownCode: [{ callId: "show-1", turnId: "turn-1", shownAt: 1, code: CODE }],
      }),
    }),
    createElement(SidePanelToggle, { panel: sidePanel, disabled: false }),
  );
}

function mount(archived = false): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(Page, { archived })));
  return container;
}

/** Closes the window, as a quit does, so the next mount is a fresh launch. */
function quit(): void {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
}

afterEach(() => {
  quit();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

/** Lays the plan's area out this wide, the summary and the panel beside the document included; jsdom lays out nothing. */
function layOutPlanArea(width: number): void {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    return DOMRect.fromRect({ width: this.classList.contains("desktop-plan") ? width : 0 });
  });
  act(() => relayout());
}

function press(page: HTMLElement, selector: string): HTMLElement {
  const control = page.querySelector<HTMLElement>(selector);
  assert.ok(control, `nothing to press at ${selector}`);
  act(() => control.click());
  return control;
}

/** The summary standing pinned beside the column, if it does. */
function pinned(page: HTMLElement): HTMLElement | null {
  return page.querySelector<HTMLElement>('aside[aria-label="Summary"]');
}

/** The summary's card, if it hangs. */
function card(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>('[role="dialog"][aria-label="Summary"]');
}

/** Each heading of the summary at `root` and the rows under it, by label. */
function listed(root: HTMLElement): [string, string[]][] {
  return [...root.querySelectorAll<HTMLElement>("ul[aria-label]")].map((rows) => [
    rows.getAttribute("aria-label") ?? "",
    [...rows.querySelectorAll("li")].map((row) => row.textContent ?? ""),
  ]);
}

function rowNamed(root: HTMLElement, label: string): HTMLElement {
  const row = [...root.querySelectorAll<HTMLElement>("li button")].find(
    (each) => each.textContent === label,
  );
  assert.ok(row, `no ${label} row`);
  return row;
}

/** The pointer arriving on a control, answering the pill it raised, if any. */
function hover(control: HTMLElement): string | undefined {
  act(() => {
    control.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });
  return document.body.querySelector('[role="tooltip"]')?.textContent ?? undefined;
}

function summaryButton(page: HTMLElement): HTMLElement {
  const button = page.querySelector<HTMLElement>(".desktop-toolbar [data-summary-opener]");
  assert.ok(button, "the toolbar draws the summary's button");
  return button;
}

test("the pinned summary lists what the two pickers open, under their headings, the panel's kinds only where the plan used them", () => {
  const page = mount();
  const summary = pinned(page);
  assert.ok(summary, "the summary stands pinned beside the column");
  assert.equal(summary.getAttribute("data-mode"), "column");

  assert.deepEqual(listed(summary), [
    ["Panels", ["Board", "Transcript"]],
    ["Coding agents", [AGENT.title]],
    ["Subagents", [JOB]],
    ["Files", ["invite.ts"]],
  ]);
  // An agent and a worker wear where they stand, as their tabs do.
  for (const label of [AGENT.title ?? "", JOB]) {
    const glyph: Element | null = rowNamed(summary, label).querySelector('[role="img"]');
    assert.equal(glyph?.getAttribute("aria-label"), "Working");
  }
});

test("a panel's row opens the panel on its tab, which takes the pinned summary away", () => {
  const page = mount();
  const summary = pinned(page);
  assert.ok(summary);

  act(() => rowNamed(summary, "Transcript").click());

  assert.equal(
    page.querySelector('.side-panel [role="tab"][aria-selected="true"]')?.textContent,
    "Transcript",
  );
  assert.equal(pinned(page), null);
});

test("an agent's row chooses its tab in the column, and a file's opens the file in the panel", () => {
  const page = mount();
  const summary = pinned(page);
  assert.ok(summary);

  act(() => rowNamed(summary, AGENT.title ?? "").click());
  assert.ok(page.querySelector(`.desktop-agent[aria-label="${AGENT.title}"]`));
  assert.equal(page.querySelector(".side-panel"), null);

  act(() => rowNamed(summary, "invite.ts").click());
  assert.equal(
    page.querySelector('.side-panel [role="tab"][aria-selected="true"]')?.textContent,
    "invite.ts",
  );
});

test("an archived plan's summary still opens what it lists", () => {
  const page = mount(true);
  const summary = pinned(page);
  assert.ok(summary);

  act(() => rowNamed(summary, "Board").click());

  assert.equal(
    page.querySelector('.side-panel [role="tab"][aria-selected="true"]')?.textContent,
    "Board",
  );
});

test("a plan's area too narrow to keep the document at its measure beside the summary folds it to a rail of glyphs", () => {
  const page = mount();

  layOutPlanArea(1039);
  const rail = pinned(page);
  assert.equal(rail?.getAttribute("data-mode"), "rail");
  assert.equal(rail?.querySelector(".plan-summary-heading"), null, "a rail says no headings");
  assert.equal(hover(rowNamed(page, "Board")), "Board");

  layOutPlanArea(1040);
  assert.equal(pinned(page)?.getAttribute("data-mode"), "column");
});

test("the rail's chevron hangs the whole summary as a card, which Escape takes down and hands focus back", () => {
  const page = mount();
  layOutPlanArea(900);

  const chevron = press(page, '[aria-label="Expand summary"]');
  const hung = card();
  assert.ok(hung, "the card hangs");
  assert.equal(chevron.getAttribute("aria-expanded"), "true");
  assert.deepEqual(listed(hung)[0], ["Panels", ["Board", "Transcript"]]);
  assert.ok(document.activeElement === rowNamed(hung, "Board"), "its first row takes the focus");

  const escapeKey = new KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    window.dispatchEvent(escapeKey);
  });
  assert.equal(card(), null);
  assert.equal(escapeKey.defaultPrevented, true, "the window does not step back a layer too");
  assert.ok(document.activeElement === chevron, "the chevron takes the focus back");
});

test("with the panel open the button hangs the summary as a card, which a press in the column takes down", () => {
  const page = mount();
  press(page, '[aria-label="Show panel"]');
  assert.equal(pinned(page), null);
  const button = summaryButton(page);
  assert.equal(button.getAttribute("aria-expanded"), "false");

  act(() => button.click());
  assert.ok(card(), "the card hangs");
  assert.equal(button.getAttribute("aria-expanded"), "true");

  const body = page.querySelector(".desktop-document .plan-body");
  assert.ok(body);
  const down = new PointerEvent("pointerdown", { bubbles: true, cancelable: true });
  act(() => {
    body.dispatchEvent(down);
  });
  assert.equal(card(), null);
  assert.equal(down.defaultPrevented, false, "the press still lands where it was pressed");
});

test("choosing a row of the card takes it down and opens the row", () => {
  const page = mount();
  press(page, '[aria-label="Show panel"]');
  act(() => summaryButton(page).click());
  const hung = card();
  assert.ok(hung);

  act(() => rowNamed(hung, "Transcript").click());

  assert.equal(card(), null);
  assert.equal(
    page.querySelector('.side-panel [role="tab"][aria-selected="true"]')?.textContent,
    "Transcript",
  );
});

test("the button's hint says what a press does: the pin while the panel is shut, the card while it is open", () => {
  const page = mount();
  assert.equal(hover(summaryButton(page)), "Toggle pinned summary");
  assert.equal(summaryButton(page).getAttribute("aria-pressed"), "true");

  press(page, '[aria-label="Show panel"]');

  assert.equal(hover(summaryButton(page)), "Toggle summary");
  assert.equal(summaryButton(page).getAttribute("aria-pressed"), null);
});

test("unpinning takes the summary away and the next launch keeps it away until it is pinned again", () => {
  const page = mount();
  act(() => summaryButton(page).click());
  assert.equal(pinned(page), null);
  assert.equal(summaryButton(page).getAttribute("aria-pressed"), "false");

  quit();
  const relaunched = mount();
  assert.equal(pinned(relaunched), null);

  act(() => summaryButton(relaunched).click());
  assert.ok(pinned(relaunched));
});
