// @vitest-environment jsdom
import { ANIMATION_ROSTER, formatCycleSeconds } from "@luke/ui/admin-animations";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AnimationsScreen } from "../src/admin/screens/animations";

/**
 * admin-animations.test.ts -- the animations page names every motion the
 * face artwork defines under its own heading with its cycle, previews each
 * from the committed artwork, and holds the previews still while the system
 * asks for less motion, following the setting as it changes; a re-render of
 * the page, the session resolving, neither replaces a preview nor sets a held
 * one moving again. The browser's SMIL clock and the system's motion setting
 * are the boundary, so both are fakes here.
 */

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

/** The system's reduced-motion setting, which the test flips as a reader would. */
interface MotionSetting {
  set: (reduced: boolean) => void;
}

/** Which SVG elements the fake SMIL clock holds paused; jsdom has no clock of its own. */
let paused: WeakSet<SVGSVGElement>;

let root: Root | undefined;

beforeEach(() => {
  paused = new WeakSet();
  Object.assign(SVGSVGElement.prototype, {
    pauseAnimations(this: SVGSVGElement) {
      paused.add(this);
    },
    unpauseAnimations(this: SVGSVGElement) {
      paused.delete(this);
    },
    animationsPaused(this: SVGSVGElement) {
      return paused.has(this);
    },
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

/** A `matchMedia` answering the reduced-motion query from `reduced`, and the handle that flips it. */
function stubMotionSetting(reduced: boolean): MotionSetting {
  const listeners = new Set<() => void>();
  const query = {
    matches: reduced,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  };
  vi.stubGlobal("matchMedia", () => query);
  return {
    set: (next) => {
      query.matches = next;
      act(() => {
        for (const listener of listeners) listener();
      });
    },
  };
}

function render(): void {
  act(() => {
    root?.render(createElement(AnimationsScreen));
  });
}

function open(): HTMLElement {
  const page = document.createElement("div");
  document.body.replaceChildren(page);
  root = createRoot(page);
  render();
  return page;
}

function previews(page: HTMLElement): SVGSVGElement[] {
  return Array.from(page.querySelectorAll("svg"));
}

test("names every motion under its own heading with its cycle", () => {
  stubMotionSetting(false);
  const page = open();

  const cards = Array.from(page.querySelectorAll("h3"), (heading) => heading.textContent);
  expect(cards).toEqual(ANIMATION_ROSTER.map((entry) => entry.motion));
  for (const entry of ANIMATION_ROSTER) {
    expect(page.textContent).toContain(`${formatCycleSeconds(entry.cycleMs)} cycle`);
  }
  expect(page.querySelector("h1")?.textContent).toBe("Animations");
});

test("previews each motion from the committed artwork, light and dark", () => {
  stubMotionSetting(false);
  const page = open();

  expect(page.textContent).not.toContain("No committed asset");
  expect(previews(page).length).toBeGreaterThanOrEqual(ANIMATION_ROSTER.length * 2);
});

test("holds the previews still while the system asks for less motion", () => {
  const setting = stubMotionSetting(true);
  const page = open();
  expect(previews(page).every((svg) => svg.animationsPaused())).toBe(true);

  setting.set(false);
  expect(previews(page).some((svg) => svg.animationsPaused())).toBe(false);

  setting.set(true);
  expect(previews(page).every((svg) => svg.animationsPaused())).toBe(true);
});

test("a re-render neither replaces a preview nor sets a held one moving", () => {
  stubMotionSetting(true);
  const page = open();
  const before = previews(page);

  render();

  const after = previews(page);
  expect(after).toHaveLength(before.length);
  expect(after.every((svg, index) => svg === before[index])).toBe(true);
  expect(after.every((svg) => svg.animationsPaused())).toBe(true);
});
