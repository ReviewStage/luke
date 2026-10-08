// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { Plan } from "@sidecar/hosted/plan-wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { plansControl } from "#testing/plans-control";
import { settingsPanelProps } from "#testing/settings-panel-props";
import { useAppKeymap } from "../app-commands";
import { PANEL_TAB } from "../panel-tabs";
import { DOCUMENT_REGION, PLANS_PAGE } from "../planning/planning-model";
import { useSidePanel } from "../planning/use-side-panel";
import { DesktopShell } from "./desktop-shell";
import { useSidebarCollapse } from "./sidebar-collapse";

const PLAN: Plan = {
  id: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  name: "Teammate invitations",
  createdAt: 1,
  updatedAt: 2,
  document: { body: "# Teammate invitations", assumptions: [] },
};

/** The motion tokens as base.css leaves them, which jsdom does not load: as shipped, and under reduced motion. */
const MOTION = {
  ON: "240ms",
  REDUCED: "1ms",
} as const;

const ignore = () => undefined;

/** One animation the stand-in engine is running, and the element it runs on. */
interface Running {
  element: Element;
  animation: Animation;
  keyframes: Keyframe[];
}

/** What the stand-in engine hands back for an animation. */
interface FakeAnimation {
  onfinish: (() => void) | null;
  cancel: () => void;
  finish: () => void;
}

/** What the stand-in engine is running; jsdom has no Web Animations of its own. */
const running: Running[] = [];

/** Puts the Web Animations API in jsdom's place: each animation runs until the test finishes it. */
function installAnimations(): void {
  Element.prototype.animate = function (this: Element, keyframes: Keyframe[]) {
    const stop = () => {
      if (running.includes(entry)) running.splice(running.indexOf(entry), 1);
    };
    const fake: FakeAnimation = {
      onfinish: null,
      cancel: stop,
      finish: () => {
        stop();
        fake.onfinish?.();
      },
    };
    // SAFETY: the panes set `onfinish` and call `cancel` and nothing else of an
    // animation, which the stand-in has; a test calls `finish`.
    const entry: Running = { element: this, animation: fake as unknown as Animation, keyframes };
    running.push(entry);
    return entry.animation;
  };
  Element.prototype.getAnimations = function (this: Element) {
    return running.filter((each) => each.element === this).map((each) => each.animation);
  };
}

function finishAll(): void {
  act(() => {
    for (const each of [...running]) each.animation.finish();
  });
}

function motion(duration: string): void {
  document.documentElement.style.setProperty("--duration-pane", duration);
  document.documentElement.style.setProperty("--motion-pane", "ease-out");
}

/**
 * Lays the plan's title out where the shell would: clear of the traffic
 * lights while the sidebar is folded, past the sidebar's edge while it is
 * not. jsdom lays out nothing.
 */
function layOutTitle(): void {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    if (!this.classList.contains("desktop-toolbar-heading")) return DOMRect.fromRect();
    const folded = this.closest("[data-sidebar-collapsed='true']") !== null;
    const sidebar = Number(
      document.querySelector(".sidebar-resize")?.getAttribute("aria-valuenow"),
    );
    return DOMRect.fromRect({ x: folded ? 124 : sidebar + 32, width: 400, height: 20 });
  });
}

/** Lays the side panel out at the window's right, or part way out past it while it slides away. */
function layOutPanel(): void {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    if (!this.classList.contains("side-panel")) return DOMRect.fromRect();
    const leaving = this.hasAttribute("data-leaving");
    return DOMRect.fromRect({ x: leaving ? 1000 : 880, width: 400, height: 800 });
  });
}

/** Where the motion now playing on `element` starts it. */
function startOf(element: Element): Keyframe | undefined {
  return running.find((each) => each.element === element)?.keyframes[0];
}

/** The window as `App` stands it, with a plan open. */
function Window(): React.JSX.Element {
  const sidebar = useSidebarCollapse(false);
  const sidePanel = useSidePanel(undefined);
  useAppKeymap(true);
  return createElement(DesktopShell, {
    gates: { accountRequired: false, onBeginSignIn: ignore, signInFace: { play: 0 } },
    identity: {
      speakers: { listening: false, lukeSpeaking: false },
      voiceActive: { developer: false, luke: false },
      fixtureSpeaking: false,
      voiceOpening: false,
    },
    tab: PANEL_TAB.PLANS,
    onTabChange: ignore,
    plans: plansControl({
      page: PLANS_PAGE.DOCUMENT,
      activePlanId: PLAN.id,
      region: { kind: DOCUMENT_REGION.READY, plan: PLAN },
      sidePanel,
    }),
    sidebar,
    settings: settingsPanelProps(),
    onSettingsSearchEngaged: ignore,
  });
}

let root: Root | undefined;

function show(): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() => root?.render(createElement(Window)));
  return container;
}

function find(page: HTMLElement, selector: string): HTMLElement {
  const found = page.querySelector<HTMLElement>(selector);
  assert.ok(found, `nothing at ${selector}`);
  return found;
}

function press(page: HTMLElement, selector: string): void {
  const control = find(page, selector);
  act(() => control.click());
}

function animating(element: Element): boolean {
  return element.getAnimations().length > 0;
}

function panel(page: HTMLElement): HTMLElement | null {
  return page.querySelector<HTMLElement>(".side-panel");
}

function documentShown(page: HTMLElement): boolean {
  return find(page, ".desktop-plan-main").hidden === false;
}

/** A pointer event at `x` on `target`, or on the page once a snap has taken the edge away. */
function pointer(page: HTMLElement, target: HTMLElement, type: string, x: number): void {
  act(() => {
    const at = target.isConnected ? target : page;
    at.dispatchEvent(new PointerEvent(type, { clientX: x, pointerId: 1, bubbles: true }));
  });
}

/** A key press at the window, answering whether a shortcut claimed it. */
function keydown(init: KeyboardEventInit): boolean {
  const event = new KeyboardEvent("keydown", { ...init, bubbles: true, cancelable: true });
  act(() => {
    window.dispatchEvent(event);
  });
  return event.defaultPrevented;
}

beforeEach(() => {
  installAnimations();
  // jsdom captures no pointer; the drag's own events are dispatched at the edge.
  HTMLElement.prototype.setPointerCapture = () => undefined;
  // Luke's face asks whether motion is reduced, which jsdom has no answer to.
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({ matches: false, addEventListener: ignore, removeEventListener: ignore }),
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  running.splice(0);
  vi.restoreAllMocks();
  Reflect.deleteProperty(Element.prototype, "animate");
  Reflect.deleteProperty(Element.prototype, "getAnimations");
  Reflect.deleteProperty(HTMLElement.prototype, "setPointerCapture");
  document.documentElement.removeAttribute("style");
  document.body.innerHTML = "";
  window.localStorage.clear();
});

test("the panel slides in, and hidden it stays drawn, out of reach, beside a document given its room, until it has slid out", () => {
  motion(MOTION.ON);
  const page = show();

  press(page, '[aria-label="Show panel"]');
  assert.ok(animating(find(page, ".side-panel")), "it slides in");
  finishAll();

  press(page, '[aria-label="Hide panel"]');
  const leaving = find(page, ".side-panel");
  assert.ok(animating(leaving), "it slides out");
  assert.ok(leaving.hasAttribute("inert"), "it takes no presses on its way out");
  assert.ok(page.querySelector('[aria-label="Show panel"]'), "the toolbar has its toggle back");
  finishAll();
  assert.equal(panel(page), null);
});

test("a panel on its way out offers none of the panel's shortcuts", () => {
  motion(MOTION.ON);
  const page = show();
  press(page, '[aria-label="Show panel"]');
  press(page, '[aria-label="Expand panel"]');
  finishAll();

  press(page, '[aria-label="Hide panel"]');
  const fullScreen = { key: "Enter", code: "Enter", metaKey: true, shiftKey: true };
  assert.equal(keydown(fullScreen), false, "the leaving panel does not take the chord");
  finishAll();
  press(page, '[aria-label="Show panel"]');
  assert.equal(find(page, ".side-panel").dataset.fullScreen, "false");
});

test("hiding a full-screen panel gives the document its whole room at once, while the panel slides out over it", () => {
  motion(MOTION.ON);
  const page = show();
  press(page, '[aria-label="Show panel"]');
  press(page, '[aria-label="Expand panel"]');
  finishAll();

  press(page, '[aria-label="Hide panel"]');
  assert.ok(animating(find(page, ".side-panel[data-leaving]")));
  assert.ok(page.querySelector(".side-panel-room") === null, "the document has its room back");
  assert.ok(documentShown(page));
});

test("a panel shown again part way through its exit comes back from where it had reached", () => {
  motion(MOTION.ON);
  layOutPanel();
  const page = show();
  press(page, '[aria-label="Show panel"]');
  finishAll();

  press(page, '[aria-label="Hide panel"]');
  press(page, '[aria-label="Show panel"]');
  const panel = find(page, ".side-panel");
  assert.equal(panel.hasAttribute("data-leaving"), false);
  assert.deepEqual(startOf(panel), { transform: "translateX(120px)" });
});

test("leaving full screen keeps the panel over the document until it has gone back, the document shown beneath it", () => {
  motion(MOTION.ON);
  const page = show();
  press(page, '[aria-label="Show panel"]');
  press(page, '[aria-label="Expand panel"]');
  finishAll();
  assert.equal(documentShown(page), false);

  press(page, '[aria-label="Exit full screen"]');
  assert.equal(find(page, ".side-panel").dataset.fullScreen, "true");
  assert.ok(animating(find(page, ".side-panel")));
  assert.ok(documentShown(page));
  finishAll();
  assert.equal(find(page, ".side-panel").dataset.fullScreen, "false");
});

test("under reduced motion the panel comes and goes at once, and nothing plays", () => {
  motion(MOTION.REDUCED);
  const page = show();

  press(page, '[aria-label="Show panel"]');
  assert.equal(animating(find(page, ".side-panel")), false);
  press(page, '[aria-label="Hide panel"]');
  assert.equal(panel(page), null);
  assert.equal(running.length, 0);
});

test("a drag between the panel's bounds plays nothing, and one past the least width plays the panel out", () => {
  motion(MOTION.ON);
  const page = show();
  press(page, '[aria-label="Show panel"]');
  finishAll();
  const edge = find(page, ".side-panel-resize");

  pointer(page, edge, "pointerdown", 1000);
  pointer(page, edge, "pointermove", 900);
  pointer(page, edge, "pointermove", 950);
  assert.equal(edge.getAttribute("aria-valuenow"), "450");
  assert.equal(running.length, 0);

  pointer(page, edge, "pointermove", 1250);
  assert.ok(animating(find(page, ".side-panel[data-leaving]")));
  pointer(page, edge, "pointerup", 1250);
  finishAll();
  assert.equal(panel(page), null);
});

test("folding the sidebar glides the plan's title, while dragging the sidebar's edge moves it with nothing easing behind", () => {
  motion(MOTION.ON);
  layOutTitle();
  const page = show();
  const title = find(page, ".desktop-toolbar-heading");
  const edge = find(page, ".sidebar-resize");

  pointer(page, edge, "pointerdown", 264);
  pointer(page, edge, "pointermove", 300);
  pointer(page, edge, "pointermove", 340);
  pointer(page, edge, "pointerup", 340);
  assert.equal(title.getBoundingClientRect().x, 372);
  assert.equal(animating(title), false);

  press(page, '[aria-label="Hide sidebar"]');
  assert.ok(animating(title));
});

test("under reduced motion folding the sidebar moves the plan's title at once", () => {
  motion(MOTION.REDUCED);
  layOutTitle();
  const page = show();

  press(page, '[aria-label="Hide sidebar"]');
  assert.equal(animating(find(page, ".desktop-toolbar-heading")), false);
});
