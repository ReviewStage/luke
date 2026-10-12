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
/** The code Luke showed on the plan: one file, unless a test shows more. */
const SHOWN: PlansControl["shownCode"] = [
  { callId: "show-1", turnId: "turn-1", shownAt: 1, code: CODE },
];

function Page({
  archived,
  shownCode,
}: {
  archived: boolean;
  shownCode: PlansControl["shownCode"];
}) {
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
    (shownCode ?? []).map((showing) => showing.code.ref.path),
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
        shownCode,
      }),
    }),
    createElement(SidePanelToggle, { panel: sidePanel, disabled: false }),
  );
}

function mount(archived = false, shownCode = SHOWN): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(Page, { archived, shownCode })));
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

/** Lays the plan's column out this wide, the summary beside the document included and the side panel not; jsdom lays out nothing. */
function layOutColumn(width: number): void {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    return DOMRect.fromRect({ width: this.classList.contains("desktop-plan-main") ? width : 0 });
  });
  act(() => relayout());
}

function press(page: HTMLElement, selector: string): HTMLElement {
  const control = page.querySelector<HTMLElement>(selector);
  assert.ok(control, `nothing to press at ${selector}`);
  act(() => control.click());
  return control;
}

/** The summary beside the column, which every plan's page draws. */
function summaryOf(page: HTMLElement): HTMLElement {
  const summary = page.querySelector<HTMLElement>('aside[aria-label="Summary"]');
  assert.ok(summary, "the summary is drawn beside the column");
  return summary;
}

/** How the summary stands: pinned as a column, or collapsed to its rail. */
function modeOf(page: HTMLElement): string | null {
  return summaryOf(page).getAttribute("data-mode");
}

/** The summary's card, if it hangs. */
function card(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>('[role="dialog"][aria-label="Summary"]');
}

/** Each heading of the summary at `root` and the rows under it, by label. */
function listed(root: HTMLElement): [string, string[]][] {
  return [...root.querySelectorAll<HTMLElement>("ul[aria-label]")].map((rows) => [
    rows.getAttribute("aria-label") ?? "",
    [...rows.querySelectorAll<HTMLElement>("li button")].map(rowLabel),
  ]);
}

/** What a row is named by: its label's own words, without the folder a file's adds, or a rail row's hidden name. */
function rowLabel(row: HTMLElement): string {
  const label =
    row.querySelector(".plan-summary-label")?.firstChild ?? row.querySelector(".visually-hidden");
  return label?.textContent ?? "";
}

function rowNamed(root: HTMLElement, label: string): HTMLElement {
  const row = [...root.querySelectorAll<HTMLElement>("li button")].find(
    (each) => rowLabel(each) === label,
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

/** Whether the toolbar's button is drawn on: pressed while the summary is pinned, expanded while its card hangs. */
function buttonOn(page: HTMLElement): boolean {
  const button = summaryButton(page);
  return (
    button.getAttribute("aria-pressed") === "true" ||
    button.getAttribute("aria-expanded") === "true"
  );
}

function pressEscape(): KeyboardEvent {
  const escapeKey = new KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    window.dispatchEvent(escapeKey);
  });
  return escapeKey;
}

test("the pinned summary lists what the two pickers open, under their headings, the panel's kinds only where the plan used them", () => {
  const page = mount();
  const summary = summaryOf(page);
  assert.equal(modeOf(page), "column");

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

test("a panel's row opens the panel on its tab, and a column with room still holds the summary pinned beside it", () => {
  const page = mount();
  layOutColumn(1040);

  act(() => rowNamed(summaryOf(page), "Transcript").click());

  assert.equal(
    page.querySelector('.side-panel [role="tab"][aria-selected="true"]')?.textContent,
    "Transcript",
  );
  assert.equal(modeOf(page), "column");
  assert.equal(summaryButton(page).getAttribute("aria-pressed"), "true");
  assert.equal(hover(summaryButton(page)), "Toggle pinned summary");
});

test("an agent's row chooses its tab in the column, and a file's opens the file in the panel", () => {
  const page = mount();

  act(() => rowNamed(summaryOf(page), AGENT.title ?? "").click());
  assert.ok(page.querySelector(`.desktop-agent[aria-label="${AGENT.title}"]`));
  assert.equal(page.querySelector(".side-panel") === null, true);

  act(() => rowNamed(summaryOf(page), "invite.ts").click());
  assert.equal(
    page.querySelector('.side-panel [role="tab"][aria-selected="true"]')?.textContent,
    "invite.ts",
  );
});

test("an archived plan's summary still opens what it lists", () => {
  const page = mount(true);

  act(() => rowNamed(summaryOf(page), "Board").click());

  assert.equal(
    page.querySelector('.side-panel [role="tab"][aria-selected="true"]')?.textContent,
    "Board",
  );
});

test("a column too narrow to keep the document at its measure beside the summary folds it to a rail of the panel's kinds alone", () => {
  const page = mount();

  layOutColumn(1039);
  const rail = summaryOf(page);
  assert.equal(modeOf(page), "rail");
  assert.deepEqual(listed(rail), [["Panels", ["Board", "Transcript"]]]);
  assert.equal(rail.querySelector(".plan-summary-heading"), null, "a rail says no headings");
  assert.equal(hover(rowNamed(rail, "Board")), "Board");

  layOutColumn(1040);
  assert.equal(modeOf(page), "column");
});

test("an open panel that leaves the column too narrow folds the summary to its rail, and the button hangs the card", () => {
  const page = mount();
  press(page, '[aria-label="Show panel"]');
  layOutColumn(800);
  assert.equal(modeOf(page), "rail");
  assert.equal(hover(summaryButton(page)), "Toggle summary");
  assert.equal(summaryButton(page).getAttribute("aria-pressed"), null);
  assert.equal(buttonOn(page), false);

  act(() => summaryButton(page).click());

  const hung = card();
  assert.ok(hung, "the card hangs");
  assert.equal(buttonOn(page), true);
  assert.deepEqual(listed(hung)[0], ["Panels", ["Board", "Transcript"]]);
  assert.equal(modeOf(page), "rail", "the rail stays under the card");
});

test("the button is drawn on exactly while the summary is expanded, pinned or hung as its card", () => {
  const page = mount();
  assert.equal(buttonOn(page), true);

  act(() => summaryButton(page).click());
  assert.equal(modeOf(page), "rail");
  assert.equal(buttonOn(page), false);

  act(() => summaryButton(page).click());
  assert.equal(modeOf(page), "column");
  assert.equal(buttonOn(page), true);

  layOutColumn(900);
  assert.equal(buttonOn(page), false);
  act(() => summaryButton(page).click());
  assert.equal(buttonOn(page), true);
  act(() => summaryButton(page).click());
  assert.equal(card() === null, true);
  assert.equal(buttonOn(page), false);
});

test("no press hides the summary: the button and the rail's chevron only ever expand or collapse it", () => {
  const page = mount();
  const modes: (string | null)[] = [];
  for (const width of [1200, 900]) {
    layOutColumn(width);
    for (let turn = 0; turn < 3; turn += 1) {
      act(() => summaryButton(page).click());
      modes.push(modeOf(page));
      const chevron = page.querySelector<HTMLElement>('[aria-label="Expand summary"]');
      if (chevron !== null) act(() => chevron.click());
      modes.push(modeOf(page));
    }
  }
  assert.ok(modes.every((mode) => mode === "column" || mode === "rail"));
});

test("where the column has room, the rail's chevron pins the summary again", () => {
  const page = mount();
  act(() => summaryButton(page).click());
  assert.equal(modeOf(page), "rail");

  press(page, '[aria-label="Expand summary"]');

  assert.equal(modeOf(page), "column");
  assert.equal(card() === null, true);
});

test("the rail's chevron hangs the whole summary as a card, which Escape takes down and hands focus back", () => {
  const page = mount();
  layOutColumn(900);

  const chevron = press(page, '[aria-label="Expand summary"]');
  const hung = card();
  assert.ok(hung, "the card hangs");
  assert.equal(chevron.getAttribute("aria-expanded"), "true");
  assert.deepEqual(listed(hung)[0], ["Panels", ["Board", "Transcript"]]);
  assert.ok(document.activeElement === rowNamed(hung, "Board"), "its first row takes the focus");

  const escapeKey = pressEscape();
  assert.equal(card(), null);
  assert.equal(escapeKey.defaultPrevented, true, "the window does not step back a layer too");
  assert.ok(document.activeElement === chevron, "the chevron takes the focus back");
});

test("the card's own chevron collapses it back to the rail", () => {
  const page = mount();
  layOutColumn(900);
  const chevron = press(page, '[aria-label="Expand summary"]');
  const hung = card();
  assert.ok(hung);

  const collapse = hung.querySelector<HTMLElement>('[aria-label="Collapse summary"]');
  assert.ok(collapse, "the card draws its chevron");
  assert.equal(hover(collapse), "Collapse summary");
  act(() => collapse.click());

  assert.equal(card(), null);
  assert.equal(modeOf(page), "rail");
  assert.equal(chevron.getAttribute("aria-expanded"), "false");
  assert.ok(document.activeElement === chevron, "the rail's chevron takes the focus");
});

test("a press in the column takes the card down and still lands where it was pressed", () => {
  const page = mount();
  layOutColumn(900);
  act(() => summaryButton(page).click());
  assert.ok(card(), "the card hangs");

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
  layOutColumn(900);
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

test("a column grown wide enough to pin the summary takes its card down", () => {
  const page = mount();
  layOutColumn(900);
  act(() => summaryButton(page).click());
  assert.ok(card());

  layOutColumn(1200);

  assert.equal(card(), null);
  assert.equal(modeOf(page), "column");
  assert.equal(summaryButton(page).getAttribute("aria-pressed"), "true");
});

test("a column grown wide while the summary is collapsed keeps its card, and the button takes the card down first", () => {
  const page = mount();
  act(() => summaryButton(page).click());
  layOutColumn(900);
  act(() => summaryButton(page).click());
  assert.ok(card());

  layOutColumn(1200);

  assert.ok(card(), "the card still hangs over the rail");
  assert.equal(modeOf(page), "rail");
  assert.equal(buttonOn(page), true);
  act(() => summaryButton(page).click());
  assert.equal(card(), null);
  assert.equal(modeOf(page), "rail");
});

test("a panel filled over the column takes the card down, leaving it no Escape to take from the panel", () => {
  const page = mount();
  press(page, '[aria-label="Show panel"]');
  layOutColumn(800);
  act(() => summaryButton(page).click());
  assert.ok(card());

  // A press from the keys, which no pointerdown outside the card announces.
  press(page, '[aria-label="Expand panel"]');

  assert.equal(card(), null);
});

test("a panel filled over the column hides the summary with it, and leaving full screen uncovers it as the column's width has it now", () => {
  const page = mount();
  press(page, '[aria-label="Show panel"]');
  layOutColumn(800);
  assert.equal(modeOf(page), "rail");

  press(page, '[aria-label="Expand panel"]');
  const column = page.querySelector<HTMLElement>(".desktop-plan-main");
  assert.equal(column?.hidden, true, "the column, its toolbar and summary with it, is hidden");
  assert.ok(column?.contains(summaryButton(page)), "no summary button stands over the panel");
  // The window widened while the panel covers the column, which keeps its
  // layout beneath the panel and so is still measured.
  layOutColumn(1200);

  press(page, '[aria-label="Exit full screen"]');

  assert.equal(column?.hidden, false);
  assert.equal(modeOf(page), "column");
  assert.equal(card(), null);
});

test("Escape on the card is the card's alone: the window under it hears nothing of it", () => {
  const page = mount();
  layOutColumn(900);
  act(() => summaryButton(page).click());
  const heard = vi.fn();
  window.addEventListener("keydown", heard);

  pressEscape();
  window.removeEventListener("keydown", heard);

  assert.equal(card(), null);
  assert.equal(heard.mock.calls.length, 0);
});

test("collapsing the summary is kept, and the next launch opens on its rail until it is pinned again", () => {
  const page = mount();
  act(() => summaryButton(page).click());
  assert.equal(modeOf(page), "rail");

  quit();
  const relaunched = mount();
  assert.equal(modeOf(relaunched), "rail");
  assert.equal(summaryButton(relaunched).getAttribute("aria-pressed"), "false");

  act(() => summaryButton(relaunched).click());
  assert.equal(modeOf(relaunched), "column");
});

test("the pinned summary's own chevron collapses it to its rail, kept as the button's press is", () => {
  const page = mount();
  const collapse = summaryOf(page).querySelector<HTMLElement>('[aria-label="Collapse summary"]');
  assert.ok(collapse, "the pinned summary draws its chevron");
  assert.equal(hover(collapse), "Collapse summary");

  act(() => collapse.click());

  assert.equal(modeOf(page), "rail");
  assert.equal(summaryButton(page).getAttribute("aria-pressed"), "false");
  quit();
  assert.equal(modeOf(mount()), "rail");
});

test("the keys reach the pinned summary's chevron, and keep the focus on its spot as it collapses and pins again", () => {
  const page = mount();
  const chevron = summaryOf(page).querySelector<HTMLElement>('[aria-label="Collapse summary"]');
  assert.ok(chevron, "the pinned summary draws its chevron");
  act(() => chevron.focus());
  assert.ok(document.activeElement === chevron, "the chevron takes the focus");

  act(() => chevron.click());
  assert.equal(modeOf(page), "rail");
  assert.ok(document.activeElement === chevron, "the rail's chevron keeps the focus");
  assert.equal(chevron.getAttribute("aria-label"), "Expand summary");

  act(() => chevron.click());
  assert.equal(modeOf(page), "column");
  assert.ok(document.activeElement === chevron, "the pinned chevron keeps the focus");
});

test("a summary unpinned when unpinning hid it opens collapsed to its rail, not hidden", () => {
  window.localStorage.setItem("luke.summary-pinned", "false");

  const page = mount();

  assert.equal(modeOf(page), "rail");
});

test("two files of one name are told apart by their folders, as their picker rows are", () => {
  const roles = (path: string, at: number) => ({
    callId: `show-${at}`,
    turnId: "turn-1",
    shownAt: at,
    code: { ...CODE, ref: { path, startLine: 1, endLine: 1 } },
  });
  const page = mount(false, [roles("apps/web/roles.ts", 1), roles("apps/desktop/roles.ts", 2)]);

  const files = [...summaryOf(page).querySelectorAll('ul[aria-label="Files"] li')].map(
    (row) => row.querySelector(".plan-summary-detail")?.textContent,
  );
  assert.deepEqual(files, ["apps/web", "apps/desktop"]);
});
