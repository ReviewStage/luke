// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { EXAMPLES } from "./examples.js";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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
  Element.prototype.scrollIntoView ??= () => undefined;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const RING = ".ui-spinner-ring";

const BUSY_BUTTON = "button[aria-busy='true']:not(.ui-chip)";

function nameOf(button: HTMLElement): string {
  return (button.getAttribute("aria-label") ?? button.textContent ?? "").trim();
}

const KINDS = [
  ["SplitButton", ".ui-split-button"],
  ["FoldingButton", ".ui-folding-button"],
  ["ProviderButton", ".ui-provider-button"],
  ["Button", ".ui-button"],
] as const;

function kindOf(button: HTMLElement): string {
  return KINDS.find(([, selector]) => button.closest(selector) !== null)?.[0] ?? "other";
}

function drawn(Render: () => React.JSX.Element): HTMLElement[] {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(Render)));
  return [...container.querySelectorAll<HTMLElement>(BUSY_BUTTON)];
}

function busyButtons(): ReadonlyArray<{ example: string; button: HTMLElement }> {
  return EXAMPLES.flatMap((example) =>
    drawn(example.Render).map((button) => ({ example: example.id, button })),
  );
}

const RING_WAIT_LIMIT_MS = 1000;

const EVERY_EXAMPLE_TIMEOUT_MS = 30_000;

test(
  "every busy button is named by what it is doing, refuses its press, and shows its one ring after the same wait",
  () => {
    const odd: string[] = [];
    const found = busyButtons();
    const shownAt = new Map<HTMLElement, number>();
    for (const { example, button } of found) {
      const where = `${example}: ${kindOf(button)} "${nameOf(button)}"`;
      if (nameOf(button) === "") odd.push(`${where} has no name`);
      if (!button.matches(":disabled, [aria-disabled='true']")) odd.push(`${where} takes a press`);
      if (button.querySelector(RING) !== null) shownAt.set(button, 0);
    }
    for (let elapsed = 1; elapsed <= RING_WAIT_LIMIT_MS; elapsed += 1) {
      act(() => vi.advanceTimersByTime(1));
      for (const { button } of found) {
        if (!shownAt.has(button) && button.querySelector(RING) !== null)
          shownAt.set(button, elapsed);
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
    assert.equal(
      waits.size,
      1,
      `the rings show after ${[...waits].join(" and ")} ms, not one wait`,
    );
    assert.ok(!waits.has(0), "a ring shows the moment the press lands, with no wait");
    assert.ok(found.length >= 5, `only ${found.length} busy buttons were drawn`);
  },
  EVERY_EXAMPLE_TIMEOUT_MS,
);
