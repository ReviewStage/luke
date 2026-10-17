// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, cloneElement, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { PlusIcon } from "../../face/glyphs.js";
import { FoldingButton, type FoldingButtonHint } from "./folding-button.js";

/**
 * folding-button.test.ts -- a folding button with its words drawn is named
 * by them, takes its press, and raises nothing in its hint; busy, it is
 * named by what it is doing and refuses its press; what its hint hands it
 * lands on the button a reader focuses. Its words folded and
 * raised in the pill are the automation editor's toolbar test, through the
 * desktop's own hint.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

/** jsdom's stand-in observer: jsdom lays nothing out, so nothing ever reports a resize. */
class SilentResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

/** A stand-in hint, saying what the button hands it beside the button. */
const Hint: FoldingButtonHint = ({ label, children }) =>
  createElement("span", null, children, createElement("output", null, label ?? "none"));

let root: Root | undefined;
let presses = 0;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("ResizeObserver", SilentResizeObserver);
  presses = 0;
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

/** A stand-in for an app's pill: it names a chord and hears focus arrive, through what it hands the control it wraps. */
const ChordHint: FoldingButtonHint = ({ children }) =>
  cloneElement(children, {
    "aria-keyshortcuts": "Meta+[",
    onFocus: () => {
      document.body.dataset.hinted = "true";
    },
  });

/** Draws a Run now button, busy where asked, and answers it. */
function draw(busy?: string, hint: FoldingButtonHint = Hint): HTMLButtonElement {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() =>
    root?.render(
      createElement(FoldingButton, {
        label: "Run now",
        icon: createElement(PlusIcon),
        busy,
        onClick: () => {
          presses += 1;
        },
        hint,
      }),
    ),
  );
  return container.querySelector("button") ?? assert.fail("no button");
}

test("with its words drawn, it is named by them, takes its press, and raises nothing in its hint", () => {
  const button = draw();
  act(() => button.click());
  assert.deepEqual(
    {
      name: button.getAttribute("aria-label") ?? button.textContent,
      presses,
      hint: document.querySelector("output")?.textContent,
    },
    { name: "Run now", presses: 1, hint: "none" },
  );
});

test("busy, it is named by what it is doing and refuses its press", () => {
  const button = draw("Running");
  act(() => button.click());
  assert.deepEqual(
    { name: button.getAttribute("aria-label"), busy: button.getAttribute("aria-busy"), presses },
    { name: "Running", busy: "true", presses: 0 },
  );
});

test("what its hint hands it lands on the button, so the focused button names the chord and shows the hint", () => {
  const button = draw(undefined, ChordHint);
  act(() => button.focus());
  assert.deepEqual(
    {
      chord: document.activeElement?.getAttribute("aria-keyshortcuts"),
      focused: document.activeElement === button,
      hinted: document.body.dataset.hinted,
    },
    { chord: "Meta+[", focused: true, hinted: "true" },
  );
});
