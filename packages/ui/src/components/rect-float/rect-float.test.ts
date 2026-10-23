// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";
import { POPOVER_SIDE, type PopoverSide } from "../anchored-popover/popover-place.js";
import { RectFloat } from "./rect-float.js";

/**
 * rect-float.test.ts -- the layer that stands by a box in the window: laid
 * in its owner's box at the box's leading edge, on the side asked unless
 * only the other has room, and moved again as a scroll moves the box. jsdom
 * lays nothing out, so the owner's box, the layer's size, and the window
 * are given: a 1024 by 768 window, the owner's box 100 in and 50 down, and
 * a 120 by 30 layer.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const roots: Root[] = [];

/** A resize observer that hears no resize, which jsdom lays out none of. */
class QuietResizeObserver {
  observe(): void {}
  disconnect(): void {}
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", QuietResizeObserver);
  vi.spyOn(window, "innerWidth", "get").mockReturnValue(1024);
  vi.spyOn(window, "innerHeight", "get").mockReturnValue(768);
  // Note that jsdom has no layout, so the box a layer is laid in is its parent, as a positioned owner's box is.
  vi.spyOn(HTMLElement.prototype, "offsetParent", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.parentElement;
  });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(120);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(30);
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

/** A box 80 wide and 20 tall, its top-left `left` in and `top` down the window. */
function boxAt(left: number, top: number) {
  return { left, top, right: left + 80, bottom: top + 20 };
}

/** A layer by the box `anchor` answers, laid in an owner's box 100 in and 50 down the window. */
function mount(anchor: () => ReturnType<typeof boxAt>, side?: PopoverSide): HTMLElement {
  const owner = document.body.appendChild(document.createElement("div"));
  owner.getBoundingClientRect = () => new DOMRect(100, 50, 600, 700);
  const root = createRoot(owner);
  roots.push(root);
  act(() => root.render(createElement(RectFloat, { anchor, side, children: "Toolbar" })));
  const layer = owner.querySelector<HTMLElement>(".luke-rect-float");
  assert.ok(layer, "the layer is drawn");
  return layer;
}

test("a layer stands over the box from its leading edge, in its owner's box's coordinates", () => {
  const layer = mount(() => boxAt(200, 300));

  assert.equal(layer.dataset.side, POPOVER_SIDE.ABOVE);
  assert.equal(layer.style.left, "100px", "200 in the window is 100 into the owner's box");
  assert.equal(
    layer.style.top,
    "250px",
    "its foot on the box's top, which the stylesheet lifts by its height",
  );
});

test("a layer asked to stand under the box does so, and one over it turns under where the window's top leaves it no room", () => {
  const under = mount(() => boxAt(200, 300), POPOVER_SIDE.BELOW);
  assert.equal(under.dataset.side, POPOVER_SIDE.BELOW);
  assert.equal(under.style.top, "270px", "its top on the box's foot");

  // 20 - 4 - 8 = 8 above is no room for 30, and the room below is.
  const turned = mount(() => boxAt(200, 20));
  assert.equal(turned.dataset.side, POPOVER_SIDE.BELOW);
});

test("a layer by a box near the window's right edge is pushed back inside it", () => {
  const layer = mount(() => boxAt(980, 300));

  // 1024 - 8 - 120 = 896 in the window is 796 into the owner's box.
  assert.equal(layer.style.left, "796px");
});

test("a scroll that moves the box moves the layer with it", () => {
  let box = boxAt(200, 300);
  const layer = mount(() => box);

  box = boxAt(200, 200);
  act(() => {
    document.dispatchEvent(new Event("scroll"));
  });

  assert.equal(layer.style.top, "150px");
});

test("a margin its owner's rule gives the layer, as one spacing a box's children does, moves it nowhere", () => {
  const style = document.head.appendChild(document.createElement("style"));
  style.textContent = ".luke-rect-float { margin-top: 6px; margin-left: 3px; }";
  try {
    const layer = mount(() => boxAt(200, 300));

    assert.equal(layer.style.left, "97px");
    assert.equal(layer.style.top, "244px");
  } finally {
    style.remove();
  }
});
