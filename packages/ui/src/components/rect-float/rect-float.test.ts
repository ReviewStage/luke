// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";
import { MOTION_TOKEN } from "../../motion-timing.js";
import { holdExits } from "../../testing/held-exits.js";
import { POPOVER_SIDE, type PopoverSide } from "../anchored-popover/popover-place.js";
import { RectFloat } from "./rect-float.js";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const roots: Root[] = [];

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

function boxAt(left: number, top: number) {
  return { left, top, right: left + 80, bottom: top + 20 };
}

function mount(anchor: () => ReturnType<typeof boxAt>, side?: PopoverSide): HTMLElement {
  const owner = document.body.appendChild(document.createElement("div"));
  owner.getBoundingClientRect = () => new DOMRect(100, 50, 600, 700);
  const root = createRoot(owner);
  roots.push(root);
  act(() =>
    root.render(createElement(RectFloat, { open: true, anchor, side, children: "Toolbar" })),
  );
  const layer = owner.querySelector<HTMLElement>(".ui-rect-float");
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

  const turned = mount(() => boxAt(200, 20));
  assert.equal(turned.dataset.side, POPOVER_SIDE.BELOW);
});

test("a layer by a box near the window's right edge is pushed back inside it", () => {
  const layer = mount(() => boxAt(980, 300));

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
  style.textContent = ".ui-rect-float { margin-top: 6px; margin-left: 3px; }";
  try {
    const layer = mount(() => boxAt(200, 300));

    assert.equal(layer.style.left, "97px");
    assert.equal(layer.style.top, "244px");
  } finally {
    style.remove();
  }
});

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
  return { draw, layer: () => owner.querySelector<HTMLElement>(".ui-rect-float") };
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
    inert: leaving?.hasAttribute("inert"),
    words: leaving?.textContent,
    top: leaving?.style.top,
    exited: told.exited,
  };
  act(() => exits.finish());

  assert.ok(leaving, "the layer stands while it fades");
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
