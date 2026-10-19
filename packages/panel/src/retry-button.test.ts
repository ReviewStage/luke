// @vitest-environment jsdom

import assert from "node:assert/strict";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import { RetryButton } from "./retry-button.js";
import { onRegistry } from "./testing/copy-feedback.js";

/**
 * retry-button.test.ts -- a failure's Retry is named by its words and
 * retries on a press; where a bar short of room folds its words away, the
 * glyph left still names them in the window's pill, and with its words
 * drawn it raises no pill repeating them.
 */

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * Lays the bar out as folded or not: jsdom lays nothing out, so the fold a
 * container query would set is what the computed style answers, and the
 * observer reports the box at once, as a first layout would.
 */
function layOut(folded: boolean): void {
  vi.stubGlobal(
    "ResizeObserver",
    class implements ResizeObserver {
      constructor(private readonly heard: ResizeObserverCallback) {}
      observe(): void {
        this.heard([], this);
      }
      unobserve(): void {}
      disconnect(): void {}
    },
  );
  const computed = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
    const style = computed(element);
    const read = style.getPropertyValue.bind(style);
    style.getPropertyValue = (name) =>
      name === "--luke-fold" ? (folded ? "folded" : "") : read(name);
    return style;
  });
}

/** Draws the agents' Retry, counting its presses, and points at it. */
function hover() {
  let presses = 0;
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(RetryButton, {
          label: "Retry agents",
          onRetry: () => {
            presses += 1;
          },
        }),
      ),
    ),
  );
  const button = container.querySelector("button") ?? assert.fail("no button");
  act(() => {
    button.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });
  return { button, presses: () => presses };
}

const pill = () => document.querySelector('[role="tooltip"]')?.textContent ?? null;

test("folded to its glyph, Retry is still named by its words, says them in the pill, and retries on a press", () => {
  layOut(true);
  const { button, presses } = hover();
  const hinted = pill();

  act(() => button.click());

  assert.equal(button.textContent, "Retry agents");
  assert.equal(hinted, "Retry agents");
  assert.equal(presses(), 1);
});

test("with its words drawn, Retry raises no pill repeating them", () => {
  layOut(false);
  const { button } = hover();

  assert.equal(button.textContent, "Retry agents");
  assert.equal(pill(), null);
});
