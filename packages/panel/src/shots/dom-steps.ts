/**
 * dom-steps.ts -- staging steps that act on what is drawn rather than on the app's controls: press an element once it is drawn, and keep a popover open.
 *
 * Throwaway (`README.md`). A step's `ready` is read on the App's renders
 * alone, and a transcript or a lazy tab draws later than any of them, so
 * these steps poll the document themselves for a while after they run.
 */

import type { ShotStep } from "./shot-spec";

/** How long a step looks for what it presses, and how often. */
const LOOK_FOR_MS = 30_000;
const LOOK_EVERY_MS = 250;

/** Calls `act` with the first element `selector` finds, once, as soon as one is drawn. */
export function onceDrawn(selector: string, act: (element: HTMLElement) => void): void {
  const started = Date.now();
  const look = (): void => {
    const element = document.querySelector<HTMLElement>(selector);
    if (element !== null) {
      act(element);
      return;
    }
    if (Date.now() - started < LOOK_FOR_MS) window.setTimeout(look, LOOK_EVERY_MS);
  };
  look();
}

/** A step that presses `selector` once it is drawn, `delayMs` after the step runs. */
export function pressStep(key: string, selector: string, delayMs = 0): ShotStep {
  return {
    key,
    ready: () => true,
    run: () => {
      window.setTimeout(() => onceDrawn(selector, (element) => element.click()), delayMs);
    },
  };
}

/** A step that marks the document so `shots.css` can draw what otherwise shows only under the pointer. */
export function markStep(key: string, attribute: string): ShotStep {
  return {
    key,
    ready: () => true,
    run: () => {
      document.documentElement.setAttribute(attribute, "true");
    },
  };
}

/** A step that scrolls `selector` to the top of its scroller once it is drawn, `delayMs` after the step runs, and again shortly after in case the column settles to its foot. */
export function scrollStep(key: string, selector: string, delayMs = 0): ShotStep {
  const scroll = (): void => onceDrawn(selector, (element) => element.scrollIntoView({ block: "start" }));
  return {
    key,
    ready: () => true,
    run: () => {
      window.setTimeout(scroll, delayMs);
      window.setTimeout(scroll, delayMs + 1500);
    },
  };
}

/** A step that sets the scroll of the scroller `selector` finds, the one furthest right where several match, `delayMs` after the step runs. */
export function scrollToStep(key: string, selector: string, top: number, delayMs = 0): ShotStep {
  const scroll = (): void => {
    const all = [...document.querySelectorAll<HTMLElement>(selector)];
    const right = all.sort((a, b) => b.getBoundingClientRect().x - a.getBoundingClientRect().x)[0];
    if (right !== undefined) right.scrollTop = top;
  };
  return {
    key,
    ready: () => true,
    run: () => {
      window.setTimeout(scroll, delayMs);
      window.setTimeout(scroll, delayMs + 1500);
    },
  };
}
