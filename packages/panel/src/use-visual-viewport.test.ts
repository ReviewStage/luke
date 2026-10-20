// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { useVisualViewport } from "./use-visual-viewport.js";

/** The window's width and its height at the page's own scale, in CSS pixels. */
const WINDOW_WIDTH = 390;
const WINDOW_HEIGHT = 800;

/**
 * How an engine answers the window's `innerWidth` and `innerHeight` under a
 * pinch: Blink keeps the layout viewport's, and WebKit gives the visual
 * viewport's (WebKit bug 174362), each a keyboard over the page left out.
 */
const ENGINE = { BLINK: "blink", WEBKIT: "webkit" } as const;
type Engine = (typeof ENGINE)[keyof typeof ENGINE];

/** A phone's visual viewport, as tall as it is shown, panned as far as it is, and zoomed as far as it is, in a window its engine measures. */
class FakeVisualViewport extends EventTarget {
  height = WINDOW_HEIGHT;
  offsetTop = 0;
  scale = 1;
  /** The layout viewport's height, which only a window that shrinks for the keyboard (Android's `resizes-content`) changes. */
  layoutHeight = WINDOW_HEIGHT;

  constructor(readonly engine: Engine = ENGINE.BLINK) {
    super();
  }

  /** The zoomed box's width: the window's, over the scale. */
  get width(): number {
    return WINDOW_WIDTH / this.scale;
  }

  /** The window's size as its engine answers it. */
  get window() {
    const shrink = this.engine === ENGINE.WEBKIT ? this.scale : 1;
    // Note that WebKit cuts the window's size to a whole pixel.
    return { width: WINDOW_WIDTH / shrink, height: Math.trunc(this.layoutHeight / shrink) };
  }

  /** The viewport changed as a phone changes it, announced by the event it fires. */
  change(
    next: {
      readonly height: number;
      readonly offsetTop?: number;
      readonly scale?: number;
      readonly layoutHeight?: number;
    },
    event: string,
  ): void {
    this.height = next.height;
    this.layoutHeight = next.layoutHeight ?? this.layoutHeight;
    this.offsetTop = next.offsetTop ?? this.offsetTop;
    this.scale = next.scale ?? this.scale;
    this.dispatchEvent(new Event(event));
  }
}

let root: Root | undefined;

/** Stands the window's visual viewport in for the test, or takes it away, the window measured as the viewport's engine measures it. */
function standViewport(viewport: FakeVisualViewport | undefined): void {
  Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    get: () => viewport?.window.width ?? WINDOW_WIDTH,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    get: () => viewport?.window.height ?? WINDOW_HEIGHT,
  });
  // A window that keeps its pan, as jsdom has none to undo; a test whose engine undoes it says so (`undoesPan`).
  Object.defineProperty(window, "scrollTo", { configurable: true, value: () => undefined });
  // The initial containing block, which jsdom answers as 0: the layout viewport's height in every engine, a pinch or not.
  Object.defineProperty(document.documentElement, "clientHeight", {
    configurable: true,
    get: () => viewport?.layoutHeight ?? WINDOW_HEIGHT,
  });
}

/** A window whose `scrollTo(0, 0)` brings a panned viewport back to its top, as Safari's does. */
function undoesPan(viewport: FakeVisualViewport): void {
  Object.defineProperty(window, "scrollTo", {
    configurable: true,
    value: () => {
      viewport.offsetTop = 0;
    },
  });
}

/** Mounts what the panel's root mounts. */
function mount(): void {
  function Panel() {
    useVisualViewport();
    return null;
  }
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() => root?.render(createElement(Panel)));
}

/**
 * What a layer drawn over `document.body`, as a dialog is, outside the
 * stage, reads of a custom property.
 */
function readOverBody(property: string): string {
  const layer = document.body.appendChild(document.createElement("div"));
  return getComputedStyle(layer).getPropertyValue(property);
}

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  Reflect.deleteProperty(window, "visualViewport");
  Reflect.deleteProperty(window, "innerWidth");
  Reflect.deleteProperty(window, "innerHeight");
  Reflect.deleteProperty(window, "scrollTo");
  Reflect.deleteProperty(document.documentElement, "clientHeight");
  document.body.replaceChildren();
});

test("a layer over the body is measured by the visible height, above the keyboard as it opens", () => {
  const viewport = new FakeVisualViewport();
  standViewport(viewport);
  mount();
  assert.equal(readOverBody("--luke-viewport-top"), "0px");
  assert.equal(readOverBody("--luke-stage-height"), "800px");
  assert.equal(readOverBody("--luke-keyboard-inset"), "0px");

  act(() => viewport.change({ height: 480 }, "resize"));
  assert.equal(readOverBody("--luke-stage-height"), "480px");
  assert.equal(readOverBody("--luke-keyboard-inset"), "320px");

  // Note that a viewport panned down to the field is seen, not covered.
  act(() => viewport.change({ height: 480, offsetTop: 120 }, "scroll"));
  assert.equal(readOverBody("--luke-viewport-top"), "120px");
  assert.equal(readOverBody("--luke-keyboard-inset"), "200px");

  act(() => viewport.change({ height: 800, offsetTop: 0 }, "resize"));
  assert.equal(readOverBody("--luke-viewport-top"), "0px");
  assert.equal(readOverBody("--luke-stage-height"), "800px");
  assert.equal(readOverBody("--luke-keyboard-inset"), "0px");
});

for (const engine of [ENGINE.BLINK, ENGINE.WEBKIT]) {
  test(`in ${engine} a pinch-zoom is not the keyboard: zoomed in and panned, the stage keeps what it was measured by, and the keyboard still lifts it once the zoom is let go`, () => {
    const viewport = new FakeVisualViewport(engine);
    standViewport(viewport);
    mount();

    // Zoomed in twice over, the viewport shows half the page and follows the finger down it.
    act(() => viewport.change({ height: 400, scale: 2 }, "resize"));
    act(() => viewport.change({ height: 400, offsetTop: 250, scale: 2 }, "scroll"));
    assert.equal(readOverBody("--luke-viewport-top"), "0px");
    assert.equal(readOverBody("--luke-stage-height"), "800px");
    assert.equal(readOverBody("--luke-keyboard-inset"), "0px");

    act(() => viewport.change({ height: 800, offsetTop: 0, scale: 1 }, "resize"));
    act(() => viewport.change({ height: 480 }, "resize"));
    assert.equal(readOverBody("--luke-stage-height"), "480px");
    assert.equal(readOverBody("--luke-keyboard-inset"), "320px");
  });

  test(`in ${engine} a keyboard opened while zoomed in still lifts the stage above it, and closed while zoomed lets it down again`, () => {
    const viewport = new FakeVisualViewport(engine);
    standViewport(viewport);
    mount();
    act(() => viewport.change({ height: 400, scale: 2 }, "resize"));

    // Twice over, a keyboard 320px tall at the page's own scale leaves 240px of the zoomed box seen.
    act(() => viewport.change({ height: 240, offsetTop: 300 }, "resize"));
    assert.equal(readOverBody("--luke-viewport-top"), "0px");
    assert.equal(readOverBody("--luke-stage-height"), "480px");
    assert.equal(readOverBody("--luke-keyboard-inset"), "320px");

    act(() => viewport.change({ height: 400, offsetTop: 100 }, "resize"));
    assert.equal(readOverBody("--luke-stage-height"), "800px");
    assert.equal(readOverBody("--luke-keyboard-inset"), "0px");
  });
}

test("a window that shrinks for the keyboard, as Android's does, counts no keyboard below it, zoomed in or not", () => {
  const viewport = new FakeVisualViewport(ENGINE.BLINK);
  standViewport(viewport);
  mount();
  act(() => viewport.change({ height: 480, layoutHeight: 480 }, "resize"));
  assert.equal(readOverBody("--luke-stage-height"), "480px");
  assert.equal(readOverBody("--luke-keyboard-inset"), "0px");

  act(() => viewport.change({ height: 240, scale: 2 }, "resize"));
  assert.equal(readOverBody("--luke-stage-height"), "480px");
  assert.equal(readOverBody("--luke-keyboard-inset"), "0px");

  // The keyboard put away while zoomed hands the window its height back.
  act(() => viewport.change({ height: 400, layoutHeight: 800 }, "resize"));
  assert.equal(readOverBody("--luke-stage-height"), "800px");
  assert.equal(readOverBody("--luke-keyboard-inset"), "0px");
});

test("without a visual viewport nothing is written, so the tokens' own window height stands", () => {
  standViewport(undefined);
  mount();
  assert.equal(readOverBody("--luke-viewport-top"), "");
  assert.equal(readOverBody("--luke-stage-height"), "");
  assert.equal(readOverBody("--luke-keyboard-inset"), "");
});

test("a panel taken down leaves the window to the tokens' own height", () => {
  standViewport(new FakeVisualViewport());
  mount();
  act(() => root?.unmount());
  root = undefined;
  assert.equal(readOverBody("--luke-viewport-top"), "");
  assert.equal(readOverBody("--luke-stage-height"), "");
  assert.equal(readOverBody("--luke-keyboard-inset"), "");
});

test("in WebKit the keyboard's pan is undone, so the stage stays at the window's top and ends where the keyboard begins", () => {
  const viewport = new FakeVisualViewport(ENGINE.WEBKIT);
  standViewport(viewport);
  undoesPan(viewport);
  mount();

  // Safari opens a keyboard 320px tall and pans the page up to the field under it.
  act(() => viewport.change({ height: 480, offsetTop: 320 }, "resize"));

  assert.equal(viewport.offsetTop, 0, "the pan is undone");
  assert.equal(readOverBody("--luke-viewport-top"), "0px");
  assert.equal(readOverBody("--luke-stage-height"), "480px");
  assert.equal(readOverBody("--luke-keyboard-inset"), "320px");
});

test("a pinch's pan is the developer's own and is never undone", () => {
  const viewport = new FakeVisualViewport(ENGINE.WEBKIT);
  standViewport(viewport);
  undoesPan(viewport);
  mount();

  act(() => viewport.change({ height: 400, scale: 2 }, "resize"));
  act(() => viewport.change({ height: 400, offsetTop: 250, scale: 2 }, "scroll"));

  assert.equal(viewport.offsetTop, 250);
  assert.equal(readOverBody("--luke-viewport-top"), "0px");
});

test("a keyboard rising over a focused field scrolls its caret into view within its own column, and one over nothing focused scrolls nothing", () => {
  const viewport = new FakeVisualViewport(ENGINE.WEBKIT);
  standViewport(viewport);
  undoesPan(viewport);
  // A column 700 tall holding more than it shows, and words in it to type in, the caret 620 down the window.
  const column = document.body.appendChild(document.createElement("div"));
  column.style.overflowY = "auto";
  Object.defineProperty(column, "scrollHeight", { configurable: true, value: 2000 });
  Object.defineProperty(column, "clientHeight", { configurable: true, value: 700 });
  column.getBoundingClientRect = () => DOMRect.fromRect({ y: 0, height: 700, width: 390 });
  const field = column.appendChild(document.createElement("div"));
  field.contentEditable = "true";
  Object.defineProperty(field, "isContentEditable", { configurable: true, value: true });
  field.getBoundingClientRect = () => DOMRect.fromRect({ y: 600, height: 20, width: 390 });
  mount();

  act(() => viewport.change({ height: 480, offsetTop: 320 }, "resize"));
  assert.equal(column.scrollTop, 0, "nothing was focused");
  act(() => viewport.change({ height: 800, offsetTop: 0 }, "resize"));

  field.tabIndex = 0;
  field.focus();
  act(() => viewport.change({ height: 480, offsetTop: 320 }, "resize"));

  // The caret's foot at 620 stands under the keyboard's top at 480, kept 24 above it.
  assert.equal(column.scrollTop, 620 + 24 - 480);
});

test("the focus leaving the field lets the stage down at once, ahead of WebKit measuring the keyboard gone, and a field taking it measures the keyboard again", () => {
  const viewport = new FakeVisualViewport(ENGINE.WEBKIT);
  standViewport(viewport);
  undoesPan(viewport);
  const field = document.body.appendChild(document.createElement("textarea"));
  const other = document.body.appendChild(document.createElement("input"));
  const button = document.body.appendChild(document.createElement("button"));
  mount();
  field.focus();
  act(() => viewport.change({ height: 480 }, "resize"));
  assert.equal(readOverBody("--luke-keyboard-inset"), "320px");

  // The focus moving to another field keeps the keyboard up.
  act(() => other.focus());
  assert.equal(readOverBody("--luke-keyboard-inset"), "320px");

  // Done: the keyboard slides away while WebKit still measures it, until it has gone.
  act(() => button.focus());
  assert.equal(readOverBody("--luke-stage-height"), "800px");
  assert.equal(readOverBody("--luke-keyboard-inset"), "0px");
  act(() => viewport.change({ height: 480 }, "scroll"));
  assert.equal(
    readOverBody("--luke-keyboard-inset"),
    "0px",
    "a late event of the keyboard going holds the stage down",
  );
  act(() => viewport.change({ height: 800 }, "resize"));
  assert.equal(readOverBody("--luke-keyboard-inset"), "0px");

  act(() => field.focus());
  act(() => viewport.change({ height: 480 }, "resize"));
  assert.equal(readOverBody("--luke-keyboard-inset"), "320px");
});
