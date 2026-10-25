// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";
import { MOTION_TOKEN } from "../../motion-timing.js";
import { holdExits } from "../../testing/held-exits.js";
import {
  POPOVER_SIDE,
  POPOVER_WIDTH,
  type PopoverSide,
  type PopoverWidth,
} from "../anchored-popover/popover-place.js";
import { RectFloat } from "./rect-float.js";

/**
 * rect-float.test.ts -- the layer that stands by a box in the window: laid
 * in its owner's box at the box's leading edge, on the side asked unless
 * only the other has room, and moved again as a scroll moves the box; and
 * closed through `open`, fading where it stood before it goes. jsdom
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
  document.body.style.removeProperty(MOTION_TOKEN.DURATION_FAST);
  Reflect.deleteProperty(Element.prototype, "getAnimations");
});

/** A box 80 wide and 20 tall, its top-left `left` in and `top` down the window. */
function boxAt(left: number, top: number) {
  return { left, top, right: left + 80, bottom: top + 20 };
}

/** A layer by the box `anchor` answers, laid in an owner's box 100 in and 50 down the window. */
function mount(
  anchor: () => ReturnType<typeof boxAt>,
  side?: PopoverSide,
  width?: PopoverWidth,
): HTMLElement {
  const owner = document.body.appendChild(document.createElement("div"));
  owner.getBoundingClientRect = () => new DOMRect(100, 50, 600, 700);
  const root = createRoot(owner);
  roots.push(root);
  act(() =>
    root.render(createElement(RectFloat, { open: true, anchor, side, width, children: "Toolbar" })),
  );
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

test("a layer asked for a width stands at that width's token, and none asked is as wide as what it holds", () => {
  const narrow = mount(() => boxAt(200, 300), undefined, POPOVER_WIDTH.NARROW);
  const wide = mount(() => boxAt(200, 300), undefined, POPOVER_WIDTH.WIDE);
  const held = mount(() => boxAt(200, 300));

  assert.equal(narrow.style.width, "var(--luke-popover-width-narrow)");
  assert.equal(wide.style.width, "var(--luke-popover-width-wide)");
  assert.equal(held.style.width, "");
});

/** What a closing layer's owner draws: the layer while `shown` answers what it holds, and nothing in it once that is let go. */
function closing(told: { exited: number }) {
  const owner = document.body.appendChild(document.createElement("div"));
  owner.getBoundingClientRect = () => new DOMRect(100, 50, 600, 700);
  const root = createRoot(owner);
  roots.push(root);
  const draw = (shown: string | undefined) =>
    act(() =>
      root.render(
        createElement(RectFloat, {
          open: shown !== undefined,
          anchor: () => boxAt(200, 300),
          onExited: () => {
            told.exited += 1;
          },
          children: shown,
        }),
      ),
    );
  return { draw, layer: () => owner.querySelector<HTMLElement>(".luke-rect-float") };
}

test("a layer closed through open stays where it stood, inert and leaving, drawing what it last held, until its fade has run, and then goes and tells its owner", () => {
  const exits = holdExits();
  const told = { exited: 0 };
  const { draw, layer } = closing(told);
  draw("Rows");
  const opened = layer()?.style.top;
  draw(undefined);
  const leaving = layer();
  const fading = {
    marked: leaving?.dataset.leaving,
    inert: leaving?.hasAttribute("inert"),
    words: leaving?.textContent,
    top: leaving?.style.top,
    exited: told.exited,
  };
  act(() => exits.finish());

  assert.ok(leaving, "the layer stands while it fades");
  assert.equal(fading.marked, "true", "the layer is marked leaving, which its stylesheet fades");
  assert.equal(fading.inert, true, "the layer takes nothing while it fades");
  assert.equal(fading.words, "Rows", "the layer draws what it held as it closed");
  assert.equal(fading.top, opened, "the layer fades where it stood");
  assert.equal(fading.exited, 0, "a fading layer has not gone");
  assert.equal(layer(), null, "the layer goes once its fade has run");
  assert.equal(told.exited, 1, "its owner hears it gone");
});

test("a layer opened again while it fades stands, and draws what it holds now", () => {
  holdExits();
  const { draw, layer } = closing({ exited: 0 });
  draw("Rows");
  draw(undefined);
  draw("Other rows");

  assert.equal(layer()?.hasAttribute("inert"), false);
  assert.equal(layer()?.dataset.leaving, undefined);
  assert.equal(layer()?.textContent, "Other rows");
});

test("a layer closed while motion is held goes at once", () => {
  document.body.style.setProperty(MOTION_TOKEN.DURATION_FAST, "0s");
  holdExits();
  const told = { exited: 0 };
  const { draw, layer } = closing(told);
  draw("Rows");
  draw(undefined);

  assert.equal(layer(), null);
  assert.equal(told.exited, 1);
});

test("a fading layer hears no press away", () => {
  holdExits();
  const pressed = { away: 0 };
  const owner = document.body.appendChild(document.createElement("div"));
  const root = createRoot(owner);
  roots.push(root);
  const draw = (open: boolean) =>
    act(() =>
      root.render(
        createElement(RectFloat, {
          open,
          anchor: () => boxAt(200, 300),
          onPressAway: () => {
            pressed.away += 1;
          },
          children: "Rows",
        }),
      ),
    );
  draw(true);
  document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  draw(false);
  document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));

  assert.equal(pressed.away, 1, "the press while it stood is heard, the one while it fades is not");
});
