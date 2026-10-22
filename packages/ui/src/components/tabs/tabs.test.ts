// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, type ReactNode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { Tab, TabCard, Tabs, type TabsControls } from "./tabs.js";

/**
 * tabs.test.ts -- however many tabs a strip holds and however it is
 * narrowed, chosen, or scrolled, it draws every tab and settles with no loop
 * of renders; a tab chosen past its end, or the one it opens on, is scrolled
 * into its own place, the strip's scroll alone; a dragged tab lands where
 * its place in the row says; the arrow keys, Home, and End move the focus
 * along, Delete closes the focused tab and hands focus to the one in its
 * place, and an owner's step moves the focused tab and says so; a preview
 * tab is kept by a double-click; and a switcher's card is picked on the
 * press or on the click, as asked. jsdom lays nothing out, so a test that
 * scrolls lays the strip's boxes out itself. Synthetic throughout.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** As many tabs as a long day's agents and files might open in one strip. */
const MANY = 60;

/** Each tab's width, as laid out where a test lays the strip out, in CSS pixels. */
const TAB_WIDTH = 100;

const ignore = () => undefined;

const roots: Root[] = [];

/** Every observer's callback, so a test can report the layout changed. */
let observers: (() => void)[] = [];

/** Every move the strip asked for, as its place before and after. */
let moves: [number, number][] = [];

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class implements ResizeObserver {
      constructor(private readonly heard: ResizeObserverCallback) {
        observers.push(() => this.heard([], this));
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
});

afterEach(() => {
  moves = [];
  observers = [];
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** A strip of `count` tabs, opened on the one `opensOn` names, choosing the one pressed, each but the first closing, which may be moved. */
function Strip({
  count,
  opensOn = 0,
  controls,
}: {
  count: number;
  opensOn?: number;
  controls?: { current: TabsControls | null };
}): ReactNode {
  const [chosen, choose] = useState(opensOn);
  const [shown, setShown] = useState(() => Array.from({ length: count }, (_, at) => at));
  return createElement(Tabs, {
    label: "Tabs",
    controls,
    onMove: (from: number, to: number) => moves.push([from, to]),
    children: shown.map((at) =>
      createElement(Tab, {
        key: at,
        icon: createElement("svg"),
        label: `Tab ${at + 1}`,
        selected: at === chosen,
        onSelect: () => choose(at),
        onClose:
          at === 0
            ? undefined
            : () => {
                setShown((was) => was.filter((each) => each !== at));
                choose(0);
              },
      }),
    ),
  });
}

/** `element` drawn into the document. */
async function render(element: ReactNode): Promise<HTMLElement> {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  await act(async () => root.render(element));
  return container;
}

/** The pill of the tab labelled `label`. */
function pill(container: HTMLElement, label: string): HTMLElement {
  const tab = [...container.querySelectorAll<HTMLElement>('[role="tab"]')].find(
    (each) => each.querySelector(".luke-tab-label")?.textContent === label,
  );
  return tab?.closest<HTMLElement>(".luke-tab") ?? assert.fail(`${label}'s tab stands`);
}

/** The tab labelled `label` itself, the press inside its pill. */
function tabOf(container: HTMLElement, label: string): HTMLElement {
  return pill(container, label).querySelector<HTMLElement>('[role="tab"]') ?? assert.fail("a tab");
}

/** The strip drawn in `container`. */
function stripOf(container: HTMLElement): HTMLElement {
  return container.querySelector<HTMLElement>(".luke-tabs") ?? assert.fail("it stands");
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
    const strip = this.closest(".luke-tabs");
    return strip === null ? 0 : [...strip.querySelectorAll(".luke-tab")].indexOf(this) * TAB_WIDTH;
  });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.matches(".luke-tab") ? TAB_WIDTH : 0;
  });
  vi.spyOn(Element.prototype, "clientWidth", "get").mockImplementation(function (this: Element) {
    return this.matches(".luke-tabs") ? width : 0;
  });
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    if (this.matches(".luke-tabs")) return DOMRect.fromRect({ width, height: 30 });
    const strip = this.closest(".luke-tabs");
    if (!this.matches(".luke-tab") || strip === null) return DOMRect.fromRect();
    const at = [...strip.querySelectorAll(".luke-tab")].indexOf(this);
    return DOMRect.fromRect({ x: at * TAB_WIDTH - scrolled, width: TAB_WIDTH, height: 30 });
  });
  vi.spyOn(Element.prototype, "scrollWidth", "get").mockImplementation(function (this: Element) {
    return this.matches(".luke-tabs") ? count * TAB_WIDTH : 0;
  });
  vi.spyOn(Element.prototype, "scrollLeft", "get").mockImplementation(() => scrolled);
  vi.spyOn(Element.prototype, "scrollLeft", "set").mockImplementation((left: number) => {
    scrolled = Math.min(Math.max(left, 0), count * TAB_WIDTH - width);
  });
}

/** A key pressed on `target`, as the keyboard would. */
function press(target: HTMLElement, key: string, init: KeyboardEventInit = {}): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init }));
  });
}

test("a strip of many tabs, narrowed, chosen along, and scrolled, draws every tab and settles with no loop of renders", async () => {
  const failures = vi.spyOn(console, "error");
  layOut(250, MANY);
  const container = await render(createElement(Strip, { count: MANY }));
  for (const label of ["Tab 2", "Tab 30", "Tab 60", "Tab 1"]) {
    act(() => {
      for (const heard of observers) heard();
    });
    act(() => tabOf(container, label).click());
    act(() => stripOf(container).dispatchEvent(new Event("scroll")));
  }
  const loops = failures.mock.calls.filter((call) => /Maximum update depth/u.test(String(call[0])));
  assert.deepEqual(loops, []);
  assert.equal(container.querySelectorAll('[role="tab"]').length, MANY);
  assert.equal(stripOf(container).style.getPropertyValue("--luke-tab-count"), String(MANY));
});

test("a tab chosen past the strip's end is scrolled into its own place, and one before its start likewise", async () => {
  layOut(250, 8);
  const container = await render(createElement(Strip, { count: 8 }));
  act(() => tabOf(container, "Tab 6").click());
  assert.equal(stripOf(container).scrollLeft, 6 * TAB_WIDTH - 250);
  act(() => tabOf(container, "Tab 2").click());
  assert.equal(stripOf(container).scrollLeft, TAB_WIDTH);
});

test("a strip a phone's width opened on a tab past its end draws already scrolled to that tab", async () => {
  layOut(330, 8);
  const container = await render(createElement(Strip, { count: 8, opensOn: 6 }));
  assert.equal(stripOf(container).scrollLeft, 7 * TAB_WIDTH - 330);
});

test("the chosen tab, pinned at the strip's start after a scroll, dragged along lands where its own place in the row says", async () => {
  layOut(250, 6);
  const container = await render(createElement(Strip, { count: 6 }));
  const strip = stripOf(container);
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
  const grip = tabOf(container, "Tab 1");
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

test("the arrow keys, Home, and End move the focus along the strip, wrapping at its ends, and a key held with a modifier moves none", async () => {
  const container = await render(createElement(Strip, { count: 4 }));
  const focused = () => document.activeElement?.querySelector(".luke-tab-label")?.textContent;
  act(() => tabOf(container, "Tab 1").focus());
  press(tabOf(container, "Tab 1"), "ArrowLeft");
  assert.equal(focused(), "Tab 4");
  press(tabOf(container, "Tab 4"), "ArrowRight");
  assert.equal(focused(), "Tab 1");
  press(tabOf(container, "Tab 1"), "End");
  assert.equal(focused(), "Tab 4");
  press(tabOf(container, "Tab 4"), "Home");
  assert.equal(focused(), "Tab 1");
  press(tabOf(container, "Tab 1"), "ArrowRight", { shiftKey: true, metaKey: true });
  assert.equal(focused(), "Tab 1");
  // Only the chosen tab is the strip's one stop for Tab.
  const stops = [...container.querySelectorAll<HTMLElement>('[role="tab"]')].map(
    (tab) => tab.tabIndex,
  );
  assert.deepEqual(stops, [0, -1, -1, -1]);
});

test("Delete closes the focused tab and hands focus to the tab standing in its place; a tab that always stands takes no Delete", async () => {
  const container = await render(createElement(Strip, { count: 3 }));
  act(() => tabOf(container, "Tab 2").focus());
  press(tabOf(container, "Tab 2"), "Delete");
  assert.equal(container.querySelectorAll('[role="tab"]').length, 2);
  assert.equal(document.activeElement, tabOf(container, "Tab 3"));
  act(() => tabOf(container, "Tab 1").focus());
  press(tabOf(container, "Tab 1"), "Backspace");
  assert.equal(container.querySelectorAll('[role="tab"]').length, 2);
});

test("an owner's step moves the focused tab a place along, keeps focus on it, and says where it now stands", async () => {
  const controls: { current: TabsControls | null } = { current: null };
  const container = await render(createElement(Strip, { count: 3, controls }));
  act(() => controls.current?.step(1));
  assert.deepEqual(moves, [], "no tab has the focus to move");
  act(() => tabOf(container, "Tab 2").focus());
  act(() => controls.current?.step(1));
  assert.deepEqual(moves, [[1, 2]]);
  assert.equal(document.activeElement, tabOf(container, "Tab 2"));
  assert.equal(
    container.querySelector('[role="status"]')?.textContent,
    "Tab 2 moved to position 3 of 3",
  );
  assert.deepEqual(controls.current?.placeOf(tabOf(container, "Tab 3")), {
    at: 2,
    count: 3,
    onMove: controls.current?.placeOf(tabOf(container, "Tab 3"))?.onMove,
  });
});

test("a preview tab wears its preview, and a double-click keeps it, while a tab of its own takes no keep", async () => {
  const kept: string[] = [];
  const container = await render(
    createElement(Tabs, {
      label: "Tabs",
      onMove: ignore,
      children: ["Preview", "Kept"].map((label) =>
        createElement(Tab, {
          key: label,
          icon: createElement("svg"),
          label,
          selected: label === "Preview",
          preview: label === "Preview",
          onSelect: ignore,
          onKeep: () => kept.push(label),
        }),
      ),
    }),
  );
  assert.equal(pill(container, "Preview").dataset.preview, "true");
  assert.equal(pill(container, "Kept").dataset.preview, "false");
  for (const label of ["Preview", "Kept"]) {
    act(() => {
      tabOf(container, label).dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
  }
  assert.deepEqual(kept, ["Preview"]);
});

test("a card picked on the press is picked as the press lands, and one picked on the click is not picked by a press alone", async () => {
  const picked: string[] = [];
  const container = await render(
    ["Held", "Clicked"].map((label) =>
      createElement(TabCard, {
        key: label,
        icon: createElement("svg"),
        label,
        chosen: false,
        pickOnPress: label === "Held",
        onPoint: ignore,
        onPick: () => picked.push(label),
      }),
    ),
  );
  const [held, clicked] = [...container.querySelectorAll<HTMLElement>('[role="option"]')];
  const down = () => new PointerEvent("pointerdown", { bubbles: true, button: 0 });
  act(() => {
    held?.dispatchEvent(down());
    clicked?.dispatchEvent(down());
  });
  assert.deepEqual(picked, ["Held"]);
  act(() => clicked?.click());
  assert.deepEqual(picked, ["Held", "Clicked"]);
});
