// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { Plan } from "@sidecar/hosted/plan-wire";
import type { PlanCode } from "@sidecar/hosted/planning-view";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, test, vi } from "vitest";
import { plansControl } from "#testing/plans-control";
import { DOCUMENT_REGION, PLANS_PAGE } from "../planning/planning-model";
import { TRANSCRIPT_REGION } from "../planning/transcript-model";
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
  document: { body: "# Teammate invitations", assumptions: [] },
};

const CODE: PlanCode = {
  ref: { path: "src/invite.ts", startLine: 1, endLine: 1 },
  firstLine: 1,
  lineCount: 1,
  lines: [[{ text: "export function accept() {}" }]],
};

const roots: Root[] = [];

/** The open plan's page over the real side panel, staged where a fixture run would stage it. */
function Page({ staged }: { staged: SidePanelState | undefined }) {
  const sidePanel = useSidePanel(staged);
  return createElement(DesktopPlans, {
    plans: plansControl({
      page: PLANS_PAGE.DOCUMENT,
      activePlanId: PLAN.id,
      region: { kind: DOCUMENT_REGION.READY, plan: PLAN },
      sidePanel,
    }),
  });
}

function mountOpenPlan(options: { staged?: SidePanelState } = {}): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(Page, { staged: options.staged })));
  return container;
}

/** Renders the last mounted page again, as the first state arriving a render in renders it. */
function restage(staged: SidePanelState | undefined): void {
  const root = roots.at(-1);
  assert.ok(root, "no page to render again");
  act(() => root.render(createElement(Page, { staged })));
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

function panelShown(page: HTMLElement): boolean {
  return page.querySelector(".side-panel") !== null;
}

beforeEach(() => {
  // The whiteboard bundle already loaded, as it is once a board has been shown in this window.
  window.lukeWhiteboard = { mount: () => ({ show: () => undefined, unmount: () => undefined }) };
});

afterEach(() => {
  unmountAll();
  vi.restoreAllMocks();
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

test("the Transcript tab draws each call's turns under their speakers, left out of the screen recording", () => {
  const markup = renderToStaticMarkup(
    createElement(DesktopPlans, {
      plans: plansControl({
        page: PLANS_PAGE.DOCUMENT,
        activePlanId: PLAN.id,
        region: { kind: DOCUMENT_REGION.READY, plan: PLAN },
        sidePanel: { ...plansControl().sidePanel, open: true, tab: SIDE_PANEL_TAB.TRANSCRIPT },
        transcript: {
          region: {
            kind: TRANSCRIPT_REGION.READY,
            earlierOmitted: false,
            calls: [
              {
                key: "call-1",
                startedAt: 1_000,
                live: true,
                lines: [
                  { key: "0", speaker: "user", text: "Invites should expire." },
                  { key: "1", speaker: "assistant", text: "After how many days?" },
                ],
              },
            ],
          },
          onRetry: () => undefined,
        },
      }),
    }),
  );

  assert.match(markup, /<section class="plan-transcript ph-no-capture" aria-label="Transcript">/u);
  assert.match(
    markup,
    /data-speaker="user"><span[^>]*>You<\/span><p[^>]*>Invites should expire\.<\/p>/u,
  );
  assert.match(
    markup,
    /data-speaker="assistant"><span[^>]*>Luke<\/span><p[^>]*>After how many days\?<\/p>/u,
  );
  assert.match(markup, />Live</u);
});

test("the Transcript tab is the panel's third, beside the document", () => {
  const page = mountOpenPlan();
  press(page, '[aria-label="Show panel"]');

  act(() => tabNamed(page, "Transcript").click());
  assert.equal(tabNamed(page, "Transcript").getAttribute("aria-selected"), "true");
  assert.ok(page.querySelector('.side-panel .plan-transcript[aria-label="Transcript"]'));
  assert.ok(documentShown(page));
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

test("a fixture run known only a render in still opens the panel it stages, and keeps nothing", () => {
  const first = mountOpenPlan();
  press(first, '[aria-label="Show panel"]');
  act(() => tabNamed(first, "Code").click());
  unmountAll();

  // The run is known only once the first state arrives, a render in.
  const staged = mountOpenPlan();
  restage({ open: false, tab: SIDE_PANEL_TAB.BOARD, width: SIDE_PANEL_WIDTH.DEFAULT });
  assert.equal(panelShown(staged), false, "the developer's panel is not drawn");
  press(staged, '[aria-label="Show panel"]');
  assert.equal(tabNamed(staged, "Board").getAttribute("aria-selected"), "true");
  unmountAll();

  const after = mountOpenPlan();
  assert.equal(tabNamed(after, "Code").getAttribute("aria-selected"), "true");
});

test("storage that refuses the read opens the page as a first launch would", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new DOMException("Storage is disabled.", "SecurityError");
  });

  const page = mountOpenPlan();
  assert.ok(documentShown(page));
  assert.equal(page.querySelector(".side-panel"), null);
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
  // Holding the chord is one press, not one per repeat.
  assert.equal(isSidePanelChord(new KeyboardEvent("keydown", { ...chord, repeat: true })), false);
});
