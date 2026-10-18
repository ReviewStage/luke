// @vitest-environment jsdom

import assert from "node:assert/strict";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, type ReactNode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import { onRegistry } from "../testing/copy-feedback.js";
import { relayout } from "../testing/resize-observer.js";
import { Tab, TabStrip } from "./tab-strip.js";

/**
 * tab-strip.test.ts -- however many tabs a strip holds and however it is
 * narrowed, chosen, or scrolled, it draws every tab and no list of hidden
 * ones, and settles with no loop of renders; a tab chosen past its end is
 * scrolled into its own place, the strip's scroll alone; a dragged tab lands
 * where its place in the row says; and a tab names itself in its hint. The
 * plan's column and the side panel draw this one strip, so this holds for
 * both. jsdom lays nothing out, so a test that scrolls lays the strip's boxes
 * out itself. Synthetic throughout.
 */

/** As many tabs as a long day's agents and files might open in one strip. */
const MANY = 60;

/** Each tab's width, as laid out where a test lays the strip out, in CSS pixels. */
const TAB_WIDTH = 100;

const ignore = () => undefined;

const roots: Root[] = [];

afterEach(() => {
  moves = [];
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  vi.restoreAllMocks();
});

/** Every move the strip asked for, as its place before and after. */
let moves: [number, number][] = [];

/** A strip of `count` tabs, choosing the one pressed, each but the first closing, which may be moved. */
function Strip({ count }: { count: number }): ReactNode {
  const [chosen, choose] = useState(0);
  return createElement(TabStrip, {
    label: "Tabs",
    onMove: (from: number, to: number) => moves.push([from, to]),
    children: Array.from({ length: count }, (_, at) =>
      createElement(Tab, {
        key: at,
        icon: createElement("svg"),
        label: `Tab ${at + 1}`,
        selected: at === chosen,
        onSelect: () => choose(at),
        onClose: at === 0 ? undefined : ignore,
      }),
    ),
  });
}

/** A strip of `count` tabs drawn into the document. */
async function drawn(count: number): Promise<HTMLElement> {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  await act(async () =>
    root.render(onRegistry(AtomRegistry.make(), createElement(Strip, { count }))),
  );
  return container;
}

/** The pill of the tab labelled `label`. */
function pill(container: HTMLElement, label: string): HTMLElement {
  const tab = [...container.querySelectorAll<HTMLElement>('[role="tab"]')].find(
    (each) => each.querySelector(".tab-label")?.textContent === label,
  );
  return tab?.closest<HTMLElement>(".tab") ?? assert.fail(`${label}'s tab stands`);
}

/**
 * Lays the strip out `width` pixels wide, its tabs in a row from its start,
 * each `TAB_WIDTH` wide, scrolling no further than its tabs reach, as the
 * window's would: their places within the strip and on the screen alike.
 */
function layOut(width: number, count: number): void {
  let scrolled = 0;
  vi.spyOn(HTMLElement.prototype, "offsetLeft", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    const strip = this.closest(".tab-strip");
    return strip === null ? 0 : [...strip.querySelectorAll(".tab")].indexOf(this) * TAB_WIDTH;
  });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.matches(".tab") ? TAB_WIDTH : 0;
  });
  vi.spyOn(Element.prototype, "clientWidth", "get").mockImplementation(function (this: Element) {
    return this.matches(".tab-strip") ? width : 0;
  });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    if (this.matches(".tab-strip")) return DOMRect.fromRect({ width, height: 30 });
    const strip = this.closest(".tab-strip");
    if (!this.matches(".tab") || strip === null) return DOMRect.fromRect();
    const at = [...strip.querySelectorAll(".tab")].indexOf(this);
    return DOMRect.fromRect({ x: at * TAB_WIDTH - scrolled, width: TAB_WIDTH, height: 30 });
  });
  vi.spyOn(Element.prototype, "scrollWidth", "get").mockImplementation(function (this: Element) {
    return this.matches(".tab-strip") ? count * TAB_WIDTH : 0;
  });
  vi.spyOn(Element.prototype, "scrollLeft", "get").mockImplementation(() => scrolled);
  vi.spyOn(Element.prototype, "scrollLeft", "set").mockImplementation((left: number) => {
    scrolled = Math.min(Math.max(left, 0), count * TAB_WIDTH - width);
  });
}

test("a strip of many tabs, narrowed, chosen along, and scrolled, draws every tab and no list of hidden ones, and settles with no loop of renders", async () => {
  const failures = vi.spyOn(console, "error");
  layOut(250, MANY);
  const container = await drawn(MANY);
  const strip = container.querySelector<HTMLElement>(".tab-strip") ?? assert.fail("it stands");
  for (const label of ["Tab 2", "Tab 30", "Tab 60", "Tab 1"]) {
    act(() => relayout());
    act(() => pill(container, label).querySelector<HTMLElement>('[role="tab"]')?.click());
    act(() => strip.dispatchEvent(new Event("scroll")));
  }
  const loops = failures.mock.calls.filter((call) => /Maximum update depth/u.test(String(call[0])));
  assert.deepEqual(loops, []);
  assert.equal(container.querySelectorAll('[role="tab"]').length, MANY);
  assert.equal(container.querySelectorAll('.tab[data-hidden="true"]').length, 0);
  assert.equal(container.querySelector('button[aria-label$="more tabs"]'), null);
});

test("a tab chosen past the strip's end is scrolled into its own place, and one before its start likewise", async () => {
  layOut(250, 8);
  const container = await drawn(8);
  const strip = container.querySelector<HTMLElement>(".tab-strip") ?? assert.fail("it stands");
  act(() => pill(container, "Tab 6").querySelector<HTMLElement>('[role="tab"]')?.click());
  assert.equal(strip.scrollLeft, 6 * TAB_WIDTH - 250);
  act(() => pill(container, "Tab 2").querySelector<HTMLElement>('[role="tab"]')?.click());
  assert.equal(strip.scrollLeft, TAB_WIDTH);
});

test("the chosen tab, pinned at the strip's start after a scroll, dragged along lands where its own place in the row says", async () => {
  layOut(250, 6);
  const container = await drawn(6);
  const strip = container.querySelector<HTMLElement>(".tab-strip") ?? assert.fail("it stands");
  act(() => {
    strip.scrollLeft = 150;
  });
  // Pinned at the strip's start, the chosen tab is drawn there, not at its own place in the row.
  const chosen = pill(container, "Tab 1");
  vi.spyOn(chosen, "getBoundingClientRect").mockReturnValue(
    DOMRect.fromRect({ x: 0, width: TAB_WIDTH, height: 30 }),
  );
  // jsdom captures no pointer; the drag asks the strip to, as the window's would.
  Object.assign(strip, {
    setPointerCapture: () => undefined,
    releasePointerCapture: () => undefined,
  });
  const grip = chosen.querySelector<HTMLElement>('[role="tab"]') ?? assert.fail("it is a tab");
  const at = (type: string, x: number) =>
    new PointerEvent(type, { bubbles: true, button: 0, clientX: x, pointerId: 1 });
  act(() => {
    grip.dispatchEvent(at("pointerdown", 10));
    window.dispatchEvent(at("pointermove", 120));
    window.dispatchEvent(at("pointermove", 230));
    window.dispatchEvent(at("pointerup", 230));
  });
  assert.deepEqual(moves, [[0, 2]]);
});

test("a tab other than the chosen one names itself in its hint, though its label may stand as its glyph alone", async () => {
  const container = await drawn(3);
  act(() => {
    pill(container, "Tab 2")
      .querySelector('[role="tab"]')
      ?.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
  });
  assert.equal(document.querySelector('[role="tooltip"]')?.textContent, "Tab 2");
});
