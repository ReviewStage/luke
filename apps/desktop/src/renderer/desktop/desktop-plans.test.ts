// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { Plan } from "@sidecar/hosted/plan-wire";
import type { PlanCode } from "@sidecar/hosted/planning-view";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, test, vi } from "vitest";
import { APP_COMMAND, type AppCommand } from "#shared/shortcuts";
import { plansControl } from "#testing/plans-control";
import { useAppKeymap, useMenuCommands } from "../app-commands";
import { COPY_SHOWN, DOCUMENT_REGION, PLANS_PAGE } from "../planning/planning-model";
import { TRANSCRIPT_REGION } from "../planning/transcript-model";
import type { PlansControl } from "../planning/use-plans-tab";
import {
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
  repository: null,
  document: { body: "# Teammate invitations", assumptions: [] },
};

const CODE: PlanCode = {
  ref: { path: "src/invite.ts", startLine: 1, endLine: 1 },
  repository: "acme/relay",
  firstLine: 1,
  lineCount: 1,
  lines: [[{ text: "export function accept() {}" }]],
};

const roots: Root[] = [];

/** How the page draws the panel. */
const PANEL = {
  HIDDEN: "hidden",
  BESIDE: "beside the document",
  FULL_SCREEN: "full screen",
} as const;

type PanelDrawn = (typeof PANEL)[keyof typeof PANEL];

/** What the toolbar's Copy was asked to do, across the presses and the chord. */
let copies = 0;

/** The open plan's page over the real side panel, staged where a fixture run would stage it, with the window's keymap. */
function Page({ staged }: { staged: SidePanelState | undefined }) {
  const sidePanel = useSidePanel(staged);
  useAppKeymap(true);
  useMenuCommands(true);
  return createElement(DesktopPlans, {
    plans: plansControl({
      page: PLANS_PAGE.DOCUMENT,
      activePlanId: PLAN.id,
      region: { kind: DOCUMENT_REGION.READY, plan: PLAN },
      sidePanel,
      copy: {
        shown: COPY_SHOWN.IDLE,
        onPress: () => {
          copies += 1;
        },
      },
    }),
  });
}

/** A key pressed anywhere in the window, answering whether the window claimed it. */
function keydown(init: KeyboardEventInit): boolean {
  const event = new KeyboardEvent("keydown", { cancelable: true, bubbles: true, ...init });
  act(() => {
    window.dispatchEvent(event);
  });
  return event.defaultPrevented;
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

/** The pointer arriving on a control, answering the pill it raised, if any. */
function hover(control: HTMLElement): string | undefined {
  act(() => {
    control.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });
  return document.body.querySelector('[role="tooltip"]')?.textContent ?? undefined;
}

function documentShown(page: HTMLElement): boolean {
  const body = page.querySelector(`.desktop-document[aria-label="${PLAN.name}"] .plan-body`);
  return body !== null && body.closest("[hidden]") === null;
}

function resizeEdge(page: HTMLElement): HTMLElement {
  const edge = page.querySelector<HTMLElement>('[role="separator"]');
  assert.ok(edge, "no resize edge");
  return edge;
}

function panelDrawn(page: HTMLElement): PanelDrawn {
  const panel = page.querySelector(".side-panel");
  if (panel === null) return PANEL.HIDDEN;
  return panel.getAttribute("data-full-screen") === "true" ? PANEL.FULL_SCREEN : PANEL.BESIDE;
}

/**
 * Drags the edge from `from` through each of `through`, releasing at the
 * last, reading how the panel is drawn at each stop. Once a snap has taken
 * the edge away, the pointer is over the page, as it would be in the window.
 */
function dragEdge(page: HTMLElement, from: number, through: number[]): PanelDrawn[] {
  const edge = resizeEdge(page);
  const pointer = (type: string, clientX: number) =>
    act(() => {
      const target = edge.isConnected ? edge : page;
      target.dispatchEvent(new PointerEvent(type, { clientX, pointerId: 1, bubbles: true }));
    });
  pointer("pointerdown", from);
  const drawn = through.map((x) => {
    pointer("pointermove", x);
    return panelDrawn(page);
  });
  pointer("pointerup", through.at(-1) ?? from);
  return drawn;
}

/** Lays the plan's area out this wide, the document beside the panel included; jsdom lays out nothing. */
function narrowPlanArea(width: number): void {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    return DOMRect.fromRect({ width: this.classList.contains("desktop-plan") ? width : 0 });
  });
}

function pointer(page: HTMLElement, type: string, pointerId: number, clientX: number): void {
  const edge = resizeEdge(page);
  act(() => {
    edge.dispatchEvent(new PointerEvent(type, { clientX, pointerId, bubbles: true }));
  });
}

function key(target: HTMLElement, name: string): void {
  act(() => target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true })));
}

function panelShown(page: HTMLElement): boolean {
  return page.querySelector(".side-panel") !== null;
}

/** The menu bar's one listener, as the bridge hands it to the window. */
let menuListener: ((command: AppCommand) => void) | undefined;

beforeEach(() => {
  Object.defineProperty(window, "sidecar", {
    configurable: true,
    value: {
      onMenuCommand: (listener: (command: AppCommand) => void) => {
        menuListener = listener;
        return () => {
          menuListener = undefined;
        };
      },
    },
  });
  // The whiteboard bundle already loaded, as it is once a board has been shown in this window.
  window.lukeWhiteboard = {
    mount: () => ({ show: () => undefined, scene: () => undefined, unmount: () => undefined }),
    render: () => Promise.resolve(undefined),
  };
  // jsdom captures no pointer; the drag's own events are dispatched at the edge.
  HTMLElement.prototype.setPointerCapture = () => undefined;
});

afterEach(() => {
  unmountAll();
  Reflect.deleteProperty(HTMLElement.prototype, "setPointerCapture");
  copies = 0;
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

test("the panel's tabs hang no pill, their words being enough, while Copy plan's chord still copies from the ⋯ menu's toolbar", () => {
  const page = mountOpenPlan();
  press(page, '[aria-label="Show panel"]');

  assert.equal(hover(tabNamed(page, "Code")), undefined);
  assert.equal(tabNamed(page, "Code").getAttribute("aria-keyshortcuts"), "Meta+Alt+2");

  // Copy plan stands in the ⋯ menu now, so the toolbar draws no button for
  // it; its chord is still the toolbar's, and Start stands where Copy was.
  const copy = [...page.querySelectorAll<HTMLElement>("button")].find(
    (each) => each.textContent === "Copy plan",
  );
  assert.equal(copy, undefined, "the toolbar draws no Copy plan of its own");
  assert.ok(page.querySelector('.desktop-toolbar [aria-label="Start a coding agent"]'));
  const before = copies;
  assert.equal(keydown({ key: "c", code: "KeyC", metaKey: true, shiftKey: true }), true);
  assert.equal(copies, before + 1);
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

  assert.match(
    markup,
    /<aside class="side-panel"[\s\S]*class="code-pane ph-no-capture"[\s\S]*src\/invite\.ts/u,
  );
});

test("a tab with something new on it carries a dot, and the tab shown carries none", () => {
  const page = document.createElement("div");
  page.innerHTML = renderToStaticMarkup(
    createElement(DesktopPlans, {
      plans: plansControl({
        page: PLANS_PAGE.DOCUMENT,
        activePlanId: PLAN.id,
        region: { kind: DOCUMENT_REGION.READY, plan: PLAN },
        sidePanel: { ...plansControl().sidePanel, open: true, tab: SIDE_PANEL_TAB.TRANSCRIPT },
        unreadTabs: [SIDE_PANEL_TAB.BOARD],
      }),
    }),
  );

  assert.ok(tabNamed(page, "Board").querySelector(".tab-note"));
  assert.equal(tabNamed(page, "Code").querySelector(".tab-note"), null);
  assert.equal(tabNamed(page, "Transcript").querySelector(".tab-note"), null);
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
                messages: [
                  {
                    id: "0",
                    role: "user",
                    parts: [{ type: "text", text: "Invites should expire." }],
                  },
                  {
                    id: "1",
                    role: "assistant",
                    parts: [{ type: "text", text: "After how many days?" }],
                  },
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
  assert.match(markup, /data-speaker="user">You<\/span>.*?<p[^>]*>Invites should expire\.<\/p>/su);
  assert.match(
    markup,
    /data-speaker="assistant">Luke<\/span>.*?<p[^>]*>After how many days\?<\/p>/su,
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

test("the open panel holds its own toggle, beside its full-screen button, and none of the plan's actions", () => {
  const page = mountOpenPlan();
  press(page, '[aria-label="Show panel"]');

  const actions = page.querySelector(".side-panel-bar-actions");
  assert.deepEqual(
    [...(actions?.children ?? [])].map((each) => each.getAttribute("aria-label")),
    ["Expand panel", "Hide panel"],
  );
  assert.equal(page.querySelector('.desktop-toolbar [aria-label="Hide panel"]'), null);
  assert.ok(page.querySelector('.desktop-toolbar [aria-label="Plan actions"]'));
  assert.match(page.querySelector(".desktop-toolbar")?.textContent ?? "", /Start/u);

  for (const fullScreen of [false, true]) {
    if (fullScreen) press(page, '[aria-label="Expand panel"]');
    const panel = page.querySelector(".side-panel");
    assert.doesNotMatch(panel?.textContent ?? "", /Copy plan/u);
    assert.equal(panel?.querySelector('[aria-label="Plan actions"]'), null);
  }
});

test("the full-screen button grows the panel over the document, and back to the width it had", () => {
  const page = mountOpenPlan();
  press(page, '[aria-label="Show panel"]');
  key(resizeEdge(page), "ArrowLeft");

  press(page, '[aria-label="Expand panel"]');
  assert.equal(documentShown(page), false);
  assert.equal(page.querySelector('[role="separator"]'), null, "full screen has no edge");
  assert.ok(page.querySelector('.side-panel [aria-label="Exit full screen"]'));

  press(page, '[aria-label="Exit full screen"]');
  assert.ok(documentShown(page));
  assert.equal(
    resizeEdge(page).getAttribute("aria-valuenow"),
    String(SIDE_PANEL_WIDTH.DEFAULT + 16),
  );
});

test("hiding a full-screen panel and showing it again shows it beside the document", () => {
  const page = mountOpenPlan();
  press(page, '[aria-label="Show panel"]');
  press(page, '[aria-label="Expand panel"]');

  press(page, '[aria-label="Hide panel"]');
  assert.ok(documentShown(page));
  press(page, '[aria-label="Show panel"]');
  assert.ok(documentShown(page));
  assert.ok(page.querySelector('.side-panel [aria-label="Expand panel"]'));
});

test("a drag between the bounds sets the width, and one past a bound holds there", () => {
  const page = mountOpenPlan();
  press(page, '[aria-label="Show panel"]');

  // The panel is on the right, so the pointer moving left widens it.
  assert.deepEqual(dragEdge(page, 1000, [900]), [PANEL.BESIDE]);
  assert.equal(resizeEdge(page).getAttribute("aria-valuenow"), "500");

  assert.deepEqual(dragEdge(page, 1000, [740]), [PANEL.BESIDE]);
  assert.equal(resizeEdge(page).getAttribute("aria-valuenow"), String(SIDE_PANEL_WIDTH.MAX));
});

test("a drag far past the least width closes the panel as it crosses, the release leaves it closed, and it opens again at the width it had", () => {
  const page = mountOpenPlan();
  press(page, '[aria-label="Show panel"]');

  // 400 wide at 1000: 1150 asks for 250, held at the bound; 1250 asks for 150.
  assert.deepEqual(dragEdge(page, 1000, [1150, 1250]), [PANEL.BESIDE, PANEL.HIDDEN]);
  assert.equal(panelShown(page), false);
  assert.ok(documentShown(page));

  press(page, '[aria-label="Show panel"]');
  assert.equal(resizeEdge(page).getAttribute("aria-valuenow"), String(SIDE_PANEL_WIDTH.DEFAULT));
});

test("a drag far past the greatest width fills the window as it crosses, and leaving full screen gives back the width it had", () => {
  const page = mountOpenPlan();
  press(page, '[aria-label="Show panel"]');

  // 400 wide at 1000: 650 asks for 750, held at the bound; 550 asks for 850.
  assert.deepEqual(dragEdge(page, 1000, [650, 550]), [PANEL.BESIDE, PANEL.FULL_SCREEN]);
  assert.equal(documentShown(page), false);
  assert.equal(page.querySelector(".side-panel")?.getAttribute("data-full-screen"), "true");

  press(page, '[aria-label="Exit full screen"]');
  assert.ok(documentShown(page));
  assert.equal(resizeEdge(page).getAttribute("aria-valuenow"), String(SIDE_PANEL_WIDTH.DEFAULT));
});

test("a drag that comes back opens the panel again as it crosses, and resizes it from there", () => {
  const page = mountOpenPlan();
  press(page, '[aria-label="Show panel"]');

  assert.deepEqual(dragEdge(page, 1000, [1250, 1050]), [PANEL.HIDDEN, PANEL.BESIDE]);
  assert.ok(panelShown(page));
  assert.equal(resizeEdge(page).getAttribute("aria-valuenow"), "350");
});

test("a drag that comes back from full screen brings the panel back beside the document as it crosses", () => {
  const page = mountOpenPlan();
  press(page, '[aria-label="Show panel"]');

  // 400 wide at 1000: 550 asks for 850, past the greatest width by more than
  // the overshoot; 700 asks for 700, back inside it.
  assert.deepEqual(dragEdge(page, 1000, [550, 700]), [PANEL.FULL_SCREEN, PANEL.BESIDE]);
  assert.ok(documentShown(page));
  assert.equal(resizeEdge(page).getAttribute("aria-valuenow"), "700");
});

test("a pointer resting on a snap's threshold does not flicker the panel", () => {
  const page = mountOpenPlan();
  press(page, '[aria-label="Show panel"]');

  // Full screen is past asking for 800, and lets go only once the pointer is
  // back by more than a tremor: 610 asks for 790, 630 for 770.
  assert.deepEqual(dragEdge(page, 1000, [550, 590, 610, 630]), [
    PANEL.FULL_SCREEN,
    PANEL.FULL_SCREEN,
    PANEL.FULL_SCREEN,
    PANEL.BESIDE,
  ]);
  // Back at 400, shut is past asking for 200, and lets go past 224.
  key(resizeEdge(page), "Enter");
  assert.deepEqual(dragEdge(page, 1000, [1210, 1190, 1180, 1170]), [
    PANEL.HIDDEN,
    PANEL.HIDDEN,
    PANEL.HIDDEN,
    PANEL.BESIDE,
  ]);
});

test("in a window too narrow for the panel's greatest width, the drag goes full screen past the document's room", () => {
  narrowPlanArea(900);
  const page = mountOpenPlan();
  press(page, '[aria-label="Show panel"]');

  // The document keeps 360 of the 900, so the panel is held at 540 and snaps past 620.
  assert.deepEqual(dragEdge(page, 1000, [800, 770]), [PANEL.BESIDE, PANEL.FULL_SCREEN]);
  assert.equal(documentShown(page), false);
});

test("a snap in a window that holds the panel narrower keeps the width the developer chose", () => {
  const page = mountOpenPlan();
  press(page, '[aria-label="Show panel"]');
  key(resizeEdge(page), "End");
  narrowPlanArea(900);

  // Drawn at 540 of its 720: 900 asks for 640, past the room by more than the overshoot.
  assert.deepEqual(dragEdge(page, 1000, [900]), [PANEL.FULL_SCREEN]);
  press(page, '[aria-label="Exit full screen"]');
  assert.equal(resizeEdge(page).getAttribute("aria-valuenow"), String(SIDE_PANEL_WIDTH.MAX));
});

test("in a window that holds the panel narrower, the keys move the panel it draws", () => {
  narrowPlanArea(900);
  const page = mountOpenPlan();
  press(page, '[aria-label="Show panel"]');
  const edge = resizeEdge(page);

  key(edge, "End");
  assert.equal(edge.getAttribute("aria-valuenow"), "540");
  key(edge, "ArrowLeft");
  assert.equal(edge.getAttribute("aria-valuenow"), "540");
  key(edge, "ArrowRight");
  assert.equal(edge.getAttribute("aria-valuenow"), "524");
});

test("a second pointer on the edge does not take over the drag under way", () => {
  const page = mountOpenPlan();
  press(page, '[aria-label="Show panel"]');

  pointer(page, "pointerdown", 1, 1000);
  pointer(page, "pointerdown", 2, 500);
  pointer(page, "pointermove", 2, 400);
  assert.equal(resizeEdge(page).getAttribute("aria-valuenow"), String(SIDE_PANEL_WIDTH.DEFAULT));
  pointer(page, "pointerup", 2, 400);

  pointer(page, "pointermove", 1, 900);
  pointer(page, "pointerup", 1, 900);
  assert.equal(resizeEdge(page).getAttribute("aria-valuenow"), "500");
});

test("double-clicking the panel's edge gives it back its default width", () => {
  const page = mountOpenPlan();
  press(page, '[aria-label="Show panel"]');
  dragEdge(page, 1000, [800]);
  assert.equal(resizeEdge(page).getAttribute("aria-valuenow"), "600");

  act(() => resizeEdge(page).dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
  assert.equal(resizeEdge(page).getAttribute("aria-valuenow"), String(SIDE_PANEL_WIDTH.DEFAULT));
});

test("Home and End take the edge to its bounds and Enter back to the default", () => {
  const page = mountOpenPlan();
  press(page, '[aria-label="Show panel"]');
  const edge = resizeEdge(page);

  key(edge, "Home");
  assert.equal(edge.getAttribute("aria-valuenow"), String(SIDE_PANEL_WIDTH.MIN));
  key(edge, "ArrowRight");
  assert.equal(edge.getAttribute("aria-valuenow"), String(SIDE_PANEL_WIDTH.MIN));
  key(edge, "End");
  assert.equal(edge.getAttribute("aria-valuenow"), String(SIDE_PANEL_WIDTH.MAX));
  key(edge, "Enter");
  assert.equal(edge.getAttribute("aria-valuenow"), String(SIDE_PANEL_WIDTH.DEFAULT));
});

test("Option-Command-B shows and hides the panel by its key, though Option makes the character another", () => {
  const page = mountOpenPlan();
  const chord = { code: "KeyB", key: "∫", metaKey: true, altKey: true };

  assert.equal(keydown(chord), true);
  assert.ok(panelShown(page));
  // Holding the chord is one press, not one per repeat.
  assert.equal(keydown({ ...chord, repeat: true }), true);
  assert.ok(panelShown(page));
  assert.equal(keydown({ ...chord, shiftKey: true }), false);
  assert.ok(panelShown(page));

  assert.equal(keydown(chord), true);
  assert.equal(panelShown(page), false);
});

test("Option-Command-1, 2, and 3 open the panel on its tabs in their order", () => {
  const page = mountOpenPlan();

  keydown({ code: "Digit2", key: "™", metaKey: true, altKey: true });
  assert.equal(tabNamed(page, "Code").getAttribute("aria-selected"), "true");
  keydown({ code: "Digit3", key: "£", metaKey: true, altKey: true });
  assert.equal(tabNamed(page, "Transcript").getAttribute("aria-selected"), "true");
  keydown({ code: "Digit1", key: "¡", metaKey: true, altKey: true });
  assert.equal(tabNamed(page, "Board").getAttribute("aria-selected"), "true");
});

test("Shift-Command-C copies the open plan as its toolbar button does", () => {
  mountOpenPlan();

  assert.equal(keydown({ code: "KeyC", key: "c", metaKey: true, shiftKey: true }), true);
  assert.equal(copies, 1);
  // Command-C alone is the system's own Copy.
  assert.equal(keydown({ code: "KeyC", key: "c", metaKey: true }), false);
  assert.equal(copies, 1);
});

test("with no plan open the plan's chords are left to the rest of the window", () => {
  function Home() {
    useAppKeymap(true);
    return createElement(DesktopPlans, { plans: plansControl({ page: PLANS_PAGE.NEW }) });
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(Home)));

  assert.equal(keydown({ code: "KeyB", key: "∫", metaKey: true, altKey: true }), false);
  assert.equal(keydown({ code: "KeyC", key: "c", metaKey: true, shiftKey: true }), false);
});

test("with no plan open the work column is the new-plan page, with nothing to go back to", () => {
  const markup = renderToStaticMarkup(
    createElement(DesktopPlans, { plans: plansControl({ page: PLANS_PAGE.NEW }) }),
  );

  assert.match(markup, /<h1 [^>]*>What are we planning\?<\/h1>/u);
  assert.match(markup, /aria-label="Plan name"/u);
  assert.doesNotMatch(markup, /desktop-toolbar|Back|Cancel/u);
});

test("Shift-Command-Return fills the window with the open panel and brings it back, and the keymap leaves Escape to the window", () => {
  const page = mountOpenPlan();
  const chord = { key: "Enter", code: "Enter", metaKey: true, shiftKey: true };
  assert.equal(keydown(chord), false, "no panel to fill the window with yet");

  press(page, '[aria-label="Show panel"]');
  assert.equal(keydown(chord), true);
  assert.equal(documentShown(page), false);
  // Escape steps back one layer at a time in the window's own handler, which
  // this page does not stand; the keymap claims none of it.
  assert.equal(keydown({ key: "Escape", code: "Escape" }), false);
  assert.equal(documentShown(page), false);

  assert.equal(keydown(chord), true);
  assert.ok(documentShown(page));
});

test("the menu bar's Exit Full Screen steps out of full screen, and does nothing beside the document", () => {
  const page = mountOpenPlan();
  press(page, '[aria-label="Show panel"]');
  assert.ok(menuListener, "the window listens to the menu bar");

  act(() => menuListener?.(APP_COMMAND.EXIT_FULL_SCREEN));
  assert.ok(documentShown(page));
  assert.ok(panelShown(page));

  press(page, '[aria-label="Expand panel"]');
  act(() => menuListener?.(APP_COMMAND.EXIT_FULL_SCREEN));
  assert.ok(documentShown(page));
  assert.ok(page.querySelector('.side-panel [aria-label="Expand panel"]'));
});

/**
 * The page over a region that moves as the host's does: opening a plan from
 * the list draws it reading first and ready once the read lands, and
 * opening another draws the first plan's page reading again.
 */
function Opening({ region }: { region: PlansControl["region"] }) {
  const sidePanel = useSidePanel(undefined);
  return createElement(DesktopPlans, {
    plans: plansControl({
      page: PLANS_PAGE.DOCUMENT,
      activePlanId: PLAN.id,
      region,
      sidePanel,
    }),
  });
}

test("a plan opened from the list, read after the page first drew it reading, draws its document on the repository chip", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  // The host publishes the plan reading before its read lands, and ready after.
  act(() => root.render(createElement(Opening, { region: { kind: DOCUMENT_REGION.READING } })));
  assert.match(container.textContent ?? "", /Reading the plan…/u);

  act(() =>
    root.render(createElement(Opening, { region: { kind: DOCUMENT_REGION.READY, plan: PLAN } })),
  );
  assert.ok(documentShown(container));
  assert.equal(
    container.querySelector(".repository-chip .plan-compose-chip-name")?.textContent,
    "Choose repository",
  );

  // Another plan opening draws the page reading again, with nothing of the first left on it.
  act(() => root.render(createElement(Opening, { region: { kind: DOCUMENT_REGION.READING } })));
  assert.equal(documentShown(container), false);
  assert.match(container.textContent ?? "", /Reading the plan…/u);
});
