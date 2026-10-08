// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { Plan } from "@sidecar/hosted/plan-wire";
import type { PlanCode } from "@sidecar/hosted/planning-view";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, test } from "vitest";
import { plansControl } from "#testing/plans-control";
import { DOCUMENT_REGION, PLANS_PAGE } from "../planning/planning-model";
import {
  isSidePanelChord,
  SIDE_PANEL_TAB,
  SIDE_PANEL_WIDTH,
  type SidePanelState,
  useSidePanel,
} from "../planning/use-side-panel";
import { DesktopPlans } from "./desktop-plans";

const PLAN: Plan = {
  id: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  name: "Teammate invitations",
  createdAt: 1,
  updatedAt: 2,
  openedAt: 3,
  document: { body: "# Teammate invitations", assumptions: [] },
};

const CODE: PlanCode = {
  ref: { path: "src/invite.ts", startLine: 1, endLine: 1 },
  firstLine: 1,
  lineCount: 1,
  lines: [[{ text: "export function accept() {}" }]],
};

const roots: Root[] = [];

/** Mounts the open plan's page over the real side panel, staged where a fixture run would stage it. */
function mountOpenPlan(options: { staged?: SidePanelState } = {}): HTMLElement {
  function Page() {
    const sidePanel = useSidePanel(options.staged);
    return createElement(DesktopPlans, {
      plans: plansControl({
        page: PLANS_PAGE.DOCUMENT,
        activePlanId: PLAN.id,
        region: { kind: DOCUMENT_REGION.READY, plan: PLAN },
        sidePanel,
      }),
    });
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(Page)));
  return container;
}

function unmountAll(): void {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
}

function press(page: HTMLElement, selector: string): void {
  const control = page.querySelector<HTMLElement>(selector);
  assert.ok(control, `nothing to press at ${selector}`);
  act(() => control.click());
}

function tabNamed(page: HTMLElement, label: string): HTMLElement {
  const tab = [...page.querySelectorAll<HTMLElement>('[role="tab"]')].find(
    (each) => each.textContent === label,
  );
  assert.ok(tab, `no ${label} tab`);
  return tab;
}

function documentShown(page: HTMLElement): boolean {
  return page.querySelector(`.desktop-document[aria-label="${PLAN.name}"] .plan-body`) !== null;
}

beforeEach(() => {
  // The whiteboard bundle already loaded, as it is once a board has been shown in this window.
  window.lukeWhiteboard = { mount: () => ({ show: () => undefined, unmount: () => undefined }) };
});

afterEach(() => {
  unmountAll();
  window.localStorage.clear();
});

test("a first launch shows the document alone, with the panel's toggle last on the toolbar", () => {
  const page = mountOpenPlan();

  assert.ok(documentShown(page));
  assert.equal(page.querySelector(".side-panel"), null);
  const toggle = page.querySelector(".desktop-toolbar-actions")?.lastElementChild;
  assert.equal(toggle?.getAttribute("aria-label"), "Show panel");
  assert.equal(toggle?.getAttribute("aria-expanded"), "false");
});

test("the toggle opens the panel on the board and closes it, the document shown throughout", () => {
  const page = mountOpenPlan();

  press(page, '[aria-label="Show panel"]');
  assert.ok(documentShown(page));
  assert.equal(tabNamed(page, "Board").getAttribute("aria-selected"), "true");
  assert.ok(page.querySelector(".side-panel .plan-board"));

  press(page, '[aria-label="Hide panel"]');
  assert.ok(documentShown(page));
  assert.equal(page.querySelector(".side-panel"), null);
});

test("the tabs switch the panel between the board and the code, which is quiet while Luke shows none", () => {
  const page = mountOpenPlan();
  press(page, '[aria-label="Show panel"]');

  act(() => tabNamed(page, "Code").click());
  assert.equal(tabNamed(page, "Code").getAttribute("aria-selected"), "true");
  assert.equal(page.querySelector(".side-panel .plan-board"), null);
  assert.match(page.querySelector(".side-panel")?.textContent ?? "", /When Luke shows you code/u);
  assert.ok(documentShown(page));

  act(() => tabNamed(page, "Board").click());
  assert.ok(page.querySelector(".side-panel .plan-board"));
});

test("the Code tab draws the code Luke has on screen", () => {
  const markup = renderToStaticMarkup(
    createElement(DesktopPlans, {
      plans: plansControl({
        page: PLANS_PAGE.DOCUMENT,
        activePlanId: PLAN.id,
        region: { kind: DOCUMENT_REGION.READY, plan: PLAN },
        sidePanel: { ...plansControl().sidePanel, open: true, tab: SIDE_PANEL_TAB.CODE },
        code: CODE,
      }),
    }),
  );

  assert.match(markup, /<aside class="side-panel"[\s\S]*class="code-pane"[\s\S]*src\/invite\.ts/u);
});

test("the next launch opens the panel as this one left it, and a fixture run neither reads nor writes it", () => {
  const first = mountOpenPlan();
  press(first, '[aria-label="Show panel"]');
  act(() => tabNamed(first, "Code").click());
  unmountAll();

  const next = mountOpenPlan();
  assert.equal(tabNamed(next, "Code").getAttribute("aria-selected"), "true");
  unmountAll();

  const staged = mountOpenPlan({
    staged: { open: false, tab: SIDE_PANEL_TAB.BOARD, width: SIDE_PANEL_WIDTH.DEFAULT },
  });
  assert.equal(staged.querySelector(".side-panel"), null);
  press(staged, '[aria-label="Show panel"]');
  unmountAll();

  const after = mountOpenPlan();
  assert.equal(tabNamed(after, "Code").getAttribute("aria-selected"), "true");
});

test("the panel's edge widens it from the keyboard, no wider than its bound", () => {
  const page = mountOpenPlan();
  press(page, '[aria-label="Show panel"]');
  const edge = page.querySelector<HTMLElement>('[role="separator"]');
  assert.ok(edge);

  act(() => edge.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })));
  assert.equal(edge.getAttribute("aria-valuenow"), String(SIDE_PANEL_WIDTH.DEFAULT + 16));

  for (let press = 0; press < 40; press += 1) {
    act(() =>
      edge.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })),
    );
  }
  assert.equal(edge.getAttribute("aria-valuenow"), String(SIDE_PANEL_WIDTH.MAX));
});

test("the panel's chord is Option-Command-B by its key, though Option makes the character another", () => {
  const chord = { code: "KeyB", key: "∫", metaKey: true, altKey: true };

  assert.equal(isSidePanelChord(new KeyboardEvent("keydown", chord)), true);
  assert.equal(isSidePanelChord(new KeyboardEvent("keydown", { ...chord, altKey: false })), false);
  assert.equal(isSidePanelChord(new KeyboardEvent("keydown", { ...chord, shiftKey: true })), false);
});
