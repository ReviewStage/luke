// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { EXAMPLES } from "./examples.js";

/**
 * busy.test.ts -- every button the catalog draws busy is busy one way. Each
 * example is drawn afresh, and each button it draws that says it is busy
 * (`aria-busy`) is named by what it is doing, refuses its press at once, shows
 * no ring until the press has been out the settle delay, and shows exactly one
 * after it: whatever its kind, a Button, an IconButton, a SplitButton's
 * main part, a FoldingButton, a ProviderButton, or a Chip. A new kind of
 * button whose busy look differs from these fails here, and one the catalog
 * never draws busy is told apart in the last test.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** An observer of what jsdom never lays out, which tells nothing. */
class StillObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): [] {
    return [];
  }
}

const roots: Root[] = [];

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", StillObserver);
  vi.stubGlobal("IntersectionObserver", StillObserver);
  // Note that a list bringing its lit row into view scrolls nothing here, and that only the settle delay's timer is held, so an example's own clocks run as they do.
  Element.prototype.scrollIntoView ??= () => undefined;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** The ring a busy button turns, which every kind draws as the one spinner. */
const RING = ".luke-spinner-ring";

/**
 * The busy buttons an example draws: what a reader is told is busy and a
 * person presses. Note that a Chip is no button kind of this shape, since it
 * is a filter that stands unavailable while its count loads, with no act to wait on.
 */
const BUSY_BUTTON = "button[aria-busy='true']:not(.luke-chip)";

/** What a button is called, by its label or its words. */
function nameOf(button: HTMLElement): string {
  return (button.getAttribute("aria-label") ?? button.textContent ?? "").trim();
}

/** The kinds of button that take `busy`, each with the shared class its own markup wears. */
const KINDS = [
  ["SplitButton", ".luke-split-button"],
  ["FoldingButton", ".luke-folding-button"],
  ["ProviderButton", ".luke-provider-button"],
  ["Button", ".luke-button"],
] as const;

/** Which kind of button `button` is, by the shared class on it or around it. */
function kindOf(button: HTMLElement): string {
  return KINDS.find(([, selector]) => button.closest(selector) !== null)?.[0] ?? "other";
}

/** The busy buttons of `example`, drawn afresh into the page. */
function drawn(Render: () => React.JSX.Element): HTMLElement[] {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(Render)));
  return [...container.querySelectorAll<HTMLElement>(BUSY_BUTTON)];
}

/** Every busy button the catalog draws, each with the example that draws it. */
function busyButtons(): ReadonlyArray<{ example: string; button: HTMLElement }> {
  return EXAMPLES.flatMap((example) =>
    drawn(example.Render).map((button) => ({ example: example.id, button })),
  );
}

/** The longest a ring may wait, in milliseconds, before the test calls it never shown. */
const RING_WAIT_LIMIT_MS = 1000;

test("every busy button is named by what it is doing, refuses its press, and shows its one ring after the same wait", () => {
  const odd: string[] = [];
  const found = busyButtons();
  const shownAt = new Map<HTMLElement, number>();
  for (const { example, button } of found) {
    const where = `${example}: ${kindOf(button)} "${nameOf(button)}"`;
    if (nameOf(button) === "") odd.push(`${where} has no name`);
    if (!button.matches(":disabled, [aria-disabled='true']")) odd.push(`${where} takes a press`);
    if (button.querySelector(RING) !== null) shownAt.set(button, 0);
  }
  // Note that the wait is read off the page a millisecond at a time rather than named here, so it is whatever the one shared delay is.
  for (let elapsed = 1; elapsed <= RING_WAIT_LIMIT_MS; elapsed += 1) {
    act(() => vi.advanceTimersByTime(1));
    for (const { button } of found) {
      if (!shownAt.has(button) && button.querySelector(RING) !== null) shownAt.set(button, elapsed);
    }
  }
  const waits = new Set(shownAt.values());
  for (const { example, button } of found) {
    const where = `${example}: ${kindOf(button)} "${nameOf(button)}"`;
    if (!shownAt.has(button)) odd.push(`${where} never shows a ring`);
    else if (button.querySelectorAll(RING).length !== 1)
      odd.push(`${where} shows more than one ring`);
  }
  assert.deepEqual(odd, [], "these busy buttons differ from the one busy shape");
  assert.equal(waits.size, 1, `the rings show after ${[...waits].join(" and ")} ms, not one wait`);
  assert.ok(!waits.has(0), "a ring shows the moment the press lands, with no wait");
  assert.ok(found.length >= 5, `only ${found.length} busy buttons were drawn`);
});

test("the catalog draws every kind of button busy", () => {
  const drawnKinds = new Set(busyButtons().map(({ button }) => kindOf(button)));
  assert.deepEqual(
    KINDS.map(([kind]) => kind).filter((kind) => !drawnKinds.has(kind)),
    [],
    "these kinds of button are never drawn busy",
  );
  assert.ok(!drawnKinds.has("other"), "a busy button of no known kind is drawn");
});
