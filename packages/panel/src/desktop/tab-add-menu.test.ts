// @vitest-environment jsdom

import assert from "node:assert/strict";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import { layContainersAt } from "../testing/container-width.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { AddTabButton } from "./strip-tabs.js";

/**
 * tab-add-menu.test.ts -- the menu a strip's "+" drops lies within what is
 * seen of the window, whatever edge of a phone's row the "+" stands at, and
 * however little of the screen a keyboard leaves, so every tab it offers
 * can be read and pressed, scrolling where they are more than fit; on the desktop the side
 * panel's menu still hangs over the column beside the panel from the "+"'s
 * right edge, as it always has. jsdom lays nothing out, so each test stands
 * the "+" and the menu where a laid-out window would and reads where the
 * menu was placed from its layer's inline place. Synthetic throughout.
 */

/** The width the "+" menu asks for, the searchable menu's own. */
const MENU_WIDTH = 340;

/** The menu's height with a few rows, as a laid-out window would measure it. */
const MENU_HEIGHT = 280;

/** The least gap the menu keeps from the window's edges. */
const MARGIN = 8;

const ignore = () => undefined;

const roots: Root[] = [];

let laid: HTMLStyleElement | undefined;

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  laid?.remove();
  laid = undefined;
  document.documentElement.removeAttribute("data-luke-profile");
  Reflect.deleteProperty(window, "visualViewport");
  vi.restoreAllMocks();
});

/** A box `left` in and `top` down, `width` by `height`. */
function box(left: number, top: number, width: number, height: number): DOMRect {
  return DOMRect.fromRect({ x: left, y: top, width, height });
}

/**
 * Lays out a window `width` by `height` with the "+" at `plus` and, where
 * `panel` is given, inside a side panel at that box, as the strip draws it.
 */
function layOut(
  width: number,
  height: number,
  plus: DOMRect,
  panel: DOMRect | undefined = undefined,
): void {
  vi.spyOn(window, "innerWidth", "get").mockReturnValue(width);
  vi.spyOn(window, "innerHeight", "get").mockReturnValue(height);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    if (this.classList.contains("tab-add-anchor")) return plus;
    if (this.classList.contains("luke-anchored-popover")) {
      return box(0, 0, MENU_WIDTH, MENU_HEIGHT);
    }
    if (panel !== undefined && this.hasAttribute("data-popover-room")) return panel;
    return box(0, 0, 0, 0);
  });
}

/** A strip's "+" drawn into the document, inside a side panel where `inPanel` says, offering a few tabs. */
async function drawn(inPanel: boolean): Promise<HTMLElement> {
  const container = document.body.appendChild(document.createElement("div"));
  if (inPanel) container.setAttribute("data-popover-room", "");
  const root = createRoot(container);
  roots.push(root);
  const entries = ["Plan", "Inbox", "Board", "Code", "Comments"].map((name) => ({
    row: { id: name.toLowerCase(), label: name },
    onPick: ignore,
  }));
  await act(async () =>
    root.render(
      onRegistry(
        AtomRegistry.make(),
        createElement(AddTabButton, {
          label: "Open a tab",
          placeholder: "Search tabs",
          noMatch: "No tabs",
          entries,
          onOpen: undefined,
          asked: false,
          answers: false,
          onAnswered: ignore,
        }),
      ),
    ),
  );
  return container;
}

/** Presses the "+" and answers where its menu stands across the window, its left and right edges. */
async function opened(container: HTMLElement, plus: DOMRect): Promise<[number, number]> {
  const button =
    container.querySelector<HTMLButtonElement>('button[aria-label="Open a tab"]') ??
    assert.fail("the + stands");
  await act(async () => button.click());
  assert.ok(container.querySelector(".tab-add-menu [role='option']"), "the menu offers its tabs");
  const layer =
    container.querySelector<HTMLElement>(".luke-anchored-popover") ??
    assert.fail("the menu hangs from the +");
  const width = Number.parseFloat(layer.style.width);
  const left =
    layer.style.left === ""
      ? plus.right - Number.parseFloat(layer.style.right) - width
      : plus.left + Number.parseFloat(layer.style.left);
  return [left, left + width];
}

for (const [phone, height] of [
  [390, 844],
  [360, 740],
] as const) {
  for (const [where, plusLeft] of [
    ["at the row's right edge", phone - 12 - 44],
    ["mid-way along the row", 216],
    ["at the row's left edge", 12],
  ] as const) {
    test(`on a ${phone}px phone the "+" menu dropped from a "+" ${where} lies within the screen`, async () => {
      const plus = box(plusLeft, 60, 44, 44);
      layOut(phone, height, plus, box(0, 0, phone, height));
      const [left, right] = await opened(await drawn(true), plus);
      assert.ok(left >= MARGIN, `the menu starts at ${left}px, inside the screen`);
      assert.ok(right <= phone - MARGIN, `the menu ends at ${right}px, inside the screen`);
    });
  }
}

test('on the desktop the side panel\'s "+" menu hangs from the "+"\'s right edge over the column beside the panel, where its left edge would run past the window', async () => {
  const plus = box(1097, 8, 32, 32);
  layOut(1280, 800, plus, box(940, 0, 340, 800));
  assert.deepEqual(await opened(await drawn(true), plus), [1129 - MENU_WIDTH, 1129]);
});

/** A length with every `var()` in it read off `element`, its fallback where the property is unset. */
function resolved(element: Element, length: string): string {
  const once = length.replace(
    /var\((--[\w-]+)(?:,\s*([^)]*))?\)/g,
    (_, name: string, fallback) =>
      getComputedStyle(element).getPropertyValue(name).trim() || (fallback ?? ""),
  );
  return once === length ? once : resolved(element, once);
}

test('on a phone whose keyboard leaves the screen short of the "+" menu\'s height, the menu ends inside what is seen, its list scrolling the tabs that do not fit', async () => {
  document.documentElement.setAttribute("data-luke-profile", "web");
  laid = layContainersAt({}, { touch: true });
  const plus = box(216, 60, 44, 44);
  layOut(390, 844, plus, box(0, 0, 390, 844));
  // The keyboard leaves 300px of the 844 seen; the visual viewport says so.
  const seen = 300;
  Object.defineProperty(window, "visualViewport", {
    configurable: true,
    value: {
      offsetTop: 0,
      offsetLeft: 0,
      width: 390,
      height: seen,
      addEventListener: ignore,
      removeEventListener: ignore,
    },
  });
  const container = await drawn(true);
  await opened(container, plus);
  const layer = container.querySelector<HTMLElement>(".luke-anchored-popover") ?? assert.fail();
  const menu = container.querySelector<HTMLElement>(".tab-add-menu") ?? assert.fail();
  assert.equal(layer.dataset.side, "below", "the menu drops into the larger room, under the +");
  const tallest = Number.parseFloat(resolved(menu, getComputedStyle(menu).maxHeight));
  assert.ok(
    plus.bottom + 4 + tallest <= seen - MARGIN,
    `the menu, at most ${tallest}px tall, ends inside the ${seen}px seen`,
  );
  const list = menu.querySelector(".luke-combobox-list") ?? assert.fail("the menu lists its tabs");
  assert.equal(getComputedStyle(list).overflowY, "auto", "the tabs that do not fit scroll");
});
