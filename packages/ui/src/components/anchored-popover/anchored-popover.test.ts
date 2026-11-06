// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { AnchoredPopover } from "./anchored-popover.js";
import { POPOVER_ALIGN, POPOVER_SIDE } from "./popover-place.js";

const roots: Root[] = [];

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
  vi.restoreAllMocks();
});

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
  const held = container.querySelector(".ui-anchored-popover")?.textContent;
  pressOn(outside);
  const heardClosed = away.count;
  act(() => toggle.click());
  pressOn(outside);

  assert.equal(heardOpen, 1, "an open popover hears a press away");
  assert.equal(held, "Held", "the layer keeps what it holds");
  assert.equal(heardClosed, 1, "a closed popover hears none");
  assert.equal(away.count, 2, "opened again it hears one");
});

test("a popover hung inside a card that scrolls turns below where the card leaves it no room above, though the window would", () => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    if (this.dataset.box === "card") return new DOMRect(0, 300, 400, 400);
    if (this.dataset.box === "anchor") return new DOMRect(100, 320, 100, 20);
    return new DOMRect(100, 0, 340, 120);
  });
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.dataset.box === "card" ? 400 : 0;
  });
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.dataset.box === "card" ? 400 : 0;
  });
  vi.spyOn(HTMLElement.prototype, "offsetParent", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.parentElement;
  });
  const sheet = document.head.appendChild(document.createElement("style"));
  sheet.textContent = ".ui-anchored-popover { position: absolute; }";
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(
        "div",
        { "data-box": "card", style: { overflowX: "hidden", overflowY: "auto" } },
        createElement(
          "span",
          { "data-box": "anchor", style: { position: "relative" } },
          createElement(AnchoredPopover, {
            open: true,
            align: POPOVER_ALIGN.START,
            children: createElement("p", null, "Rows"),
          }),
        ),
      ),
    ),
  );

  const layer = container.querySelector<HTMLElement>(".ui-anchored-popover");
  const laid = layer === null ? undefined : getComputedStyle(layer).position;
  sheet.remove();
  assert.equal(laid, "absolute", "the layer is laid as the app lays it");
  assert.equal(layer?.dataset.side, POPOVER_SIDE.BELOW);
});
