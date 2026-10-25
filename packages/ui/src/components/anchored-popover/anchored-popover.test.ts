// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { AnchoredPopover } from "./anchored-popover.js";
import { POPOVER_ALIGN } from "./popover-place.js";

/**
 * anchored-popover.test.ts -- a popover its owner closes through `open`
 * keeps its layer, so what it holds can fade out in place, and hears no
 * press away until it opens again.
 */

const roots: Root[] = [];

/** jsdom has no ResizeObserver; the layer's measures are not what these tests read. */
class StandInResizeObserver {
  observe(): void {}
  disconnect(): void {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", StandInResizeObserver);
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

/** A button whose popover opens and closes through `open`, counting the presses away it hears. */
function Owner({ away }: { away: { count: number } }): React.JSX.Element {
  const [open, setOpen] = useState(true);
  return createElement(
    "div",
    null,
    createElement("button", { type: "button", onClick: () => setOpen((was) => !was) }, "Toggle"),
    createElement(AnchoredPopover, {
      open,
      align: POPOVER_ALIGN.START,
      onPressAway: () => {
        away.count += 1;
      },
      children: createElement("p", null, "Held"),
    }),
  );
}

/** A press going down on `target`. */
function pressOn(target: Element): void {
  act(() => {
    target.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
  });
}

test("a popover closed through open keeps what it holds in its layer and hears no press away until it opens again", () => {
  const away = { count: 0 };
  const container = document.body.appendChild(document.createElement("div"));
  const outside = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(Owner, { away })));
  const toggle = container.querySelector("button") ?? assert.fail("no toggle");

  pressOn(outside);
  const heardOpen = away.count;
  act(() => toggle.click());
  const held = container.querySelector(".luke-anchored-popover")?.textContent;
  pressOn(outside);
  const heardClosed = away.count;
  act(() => toggle.click());
  pressOn(outside);

  assert.equal(heardOpen, 1, "an open popover hears a press away");
  assert.equal(held, "Held", "the layer keeps what it holds");
  assert.equal(heardClosed, 1, "a closed popover hears none");
  assert.equal(away.count, 2, "opened again it hears one");
});
