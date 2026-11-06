// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { useVisualViewport } from "./use-visual-viewport.js";

const WINDOW_WIDTH = 390;
const WINDOW_HEIGHT = 800;

const ENGINE = { BLINK: "blink", WEBKIT: "webkit" } as const;
type Engine = (typeof ENGINE)[keyof typeof ENGINE];

class FakeVisualViewport extends EventTarget {
  height = WINDOW_HEIGHT;
  offsetTop = 0;
  scale = 1;
  layoutHeight = WINDOW_HEIGHT;

  constructor(readonly engine: Engine = ENGINE.BLINK) {
    super();
  }

  get width(): number {
    return WINDOW_WIDTH / this.scale;
  }

  get window() {
    const shrink = this.engine === ENGINE.WEBKIT ? this.scale : 1;
    return { width: WINDOW_WIDTH / shrink, height: Math.trunc(this.layoutHeight / shrink) };
  }

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
  Object.defineProperty(window, "scrollTo", { configurable: true, value: () => undefined });
  Object.defineProperty(document.documentElement, "clientHeight", {
    configurable: true,
    get: () => viewport?.layoutHeight ?? WINDOW_HEIGHT,
  });
}

function undoesPan(viewport: FakeVisualViewport): void {
  Object.defineProperty(window, "scrollTo", {
    configurable: true,
    value: () => {
      viewport.offsetTop = 0;
    },
  });
}

function stageTop(): number {
  return (
    Number.parseFloat(document.documentElement.style.getPropertyValue("--ui-viewport-top")) || 0
  );
}

function mount(): void {
  function Panel() {
    useVisualViewport();
    return null;
  }
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() => root?.render(createElement(Panel)));
}

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
  assert.equal(readOverBody("--ui-viewport-top"), "0px");
  assert.equal(readOverBody("--ui-stage-height"), "800px");
  assert.equal(readOverBody("--ui-keyboard-inset"), "0px");

  act(() => viewport.change({ height: 480 }, "resize"));
  assert.equal(readOverBody("--ui-stage-height"), "480px");
  assert.equal(readOverBody("--ui-keyboard-inset"), "320px");

  act(() => viewport.change({ height: 480, offsetTop: 120 }, "scroll"));
  assert.equal(readOverBody("--ui-viewport-top"), "120px");
  assert.equal(readOverBody("--ui-keyboard-inset"), "200px");

  act(() => viewport.change({ height: 800, offsetTop: 0 }, "resize"));
  assert.equal(readOverBody("--ui-viewport-top"), "0px");
  assert.equal(readOverBody("--ui-stage-height"), "800px");
  assert.equal(readOverBody("--ui-keyboard-inset"), "0px");
});

for (const engine of [ENGINE.BLINK, ENGINE.WEBKIT]) {
  test(`in ${engine} a pinch-zoom is not the keyboard: zoomed in and panned, the stage keeps what it was measured by, and the keyboard still lifts it once the zoom is let go`, () => {
    const viewport = new FakeVisualViewport(engine);
    standViewport(viewport);
    mount();

    act(() => viewport.change({ height: 400, scale: 2 }, "resize"));
    act(() => viewport.change({ height: 400, offsetTop: 250, scale: 2 }, "scroll"));
    assert.equal(readOverBody("--ui-viewport-top"), "0px");
    assert.equal(readOverBody("--ui-stage-height"), "800px");
    assert.equal(readOverBody("--ui-keyboard-inset"), "0px");

    act(() => viewport.change({ height: 800, offsetTop: 0, scale: 1 }, "resize"));
    act(() => viewport.change({ height: 480 }, "resize"));
    assert.equal(readOverBody("--ui-stage-height"), "480px");
    assert.equal(readOverBody("--ui-keyboard-inset"), "320px");
  });

  test(`in ${engine} a keyboard opened while zoomed in still lifts the stage above it, and closed while zoomed lets it down again`, () => {
    const viewport = new FakeVisualViewport(engine);
    standViewport(viewport);
    mount();
    act(() => viewport.change({ height: 400, scale: 2 }, "resize"));

    act(() => viewport.change({ height: 240, offsetTop: 300 }, "resize"));
    assert.equal(readOverBody("--ui-viewport-top"), "0px");
    assert.equal(readOverBody("--ui-stage-height"), "480px");
    assert.equal(readOverBody("--ui-keyboard-inset"), "320px");

    act(() => viewport.change({ height: 400, offsetTop: 100 }, "resize"));
    assert.equal(readOverBody("--ui-stage-height"), "800px");
    assert.equal(readOverBody("--ui-keyboard-inset"), "0px");
  });
}

test("a window that shrinks for the keyboard, as Android's does, counts no keyboard below it, zoomed in or not", () => {
  const viewport = new FakeVisualViewport(ENGINE.BLINK);
  standViewport(viewport);
  mount();
  act(() => viewport.change({ height: 480, layoutHeight: 480 }, "resize"));
  assert.equal(readOverBody("--ui-stage-height"), "480px");
  assert.equal(readOverBody("--ui-keyboard-inset"), "0px");

  act(() => viewport.change({ height: 240, scale: 2 }, "resize"));
  assert.equal(readOverBody("--ui-stage-height"), "480px");
  assert.equal(readOverBody("--ui-keyboard-inset"), "0px");

  act(() => viewport.change({ height: 400, layoutHeight: 800 }, "resize"));
  assert.equal(readOverBody("--ui-stage-height"), "800px");
  assert.equal(readOverBody("--ui-keyboard-inset"), "0px");
});

test("without a visual viewport nothing is written, so the tokens' own window height stands", () => {
  standViewport(undefined);
  mount();
  assert.equal(readOverBody("--ui-viewport-top"), "");
  assert.equal(readOverBody("--ui-stage-height"), "");
  assert.equal(readOverBody("--ui-keyboard-inset"), "");
});

test("a panel taken down leaves the window to the tokens' own height", () => {
  standViewport(new FakeVisualViewport());
  mount();
  act(() => root?.unmount());
  root = undefined;
  assert.equal(readOverBody("--ui-viewport-top"), "");
  assert.equal(readOverBody("--ui-stage-height"), "");
  assert.equal(readOverBody("--ui-keyboard-inset"), "");
});

test("in WebKit the keyboard's pan to the field is followed, never scrolled back, so the stage stands over what is seen", () => {
  const viewport = new FakeVisualViewport(ENGINE.WEBKIT);
  standViewport(viewport);
  undoesPan(viewport);
  mount();

  act(() => viewport.change({ height: 480, offsetTop: 320 }, "resize"));

  assert.equal(viewport.offsetTop, 320, "the pan stands where Safari put it");
  assert.equal(readOverBody("--ui-viewport-top"), "320px");
  assert.equal(readOverBody("--ui-stage-height"), "480px");
  assert.equal(readOverBody("--ui-keyboard-inset"), "0px");
});

test("a keyboard rising over a focused field, panned to or not, scrolls its caret into view within its own column, and one over nothing focused scrolls nothing", () => {
  const viewport = new FakeVisualViewport(ENGINE.WEBKIT);
  standViewport(viewport);
  const column = scrollingColumn();
  const field = column.appendChild(document.createElement("div"));
  field.contentEditable = "true";
  Object.defineProperty(field, "isContentEditable", { configurable: true, value: true });
  field.getBoundingClientRect = () =>
    DOMRect.fromRect({ y: stageTop() + 600, height: 20, width: 390 });
  mount();

  act(() => viewport.change({ height: 480, offsetTop: 320 }, "resize"));
  assert.equal(column.scrollTop, 0, "nothing was focused");
  act(() => viewport.change({ height: 800, offsetTop: 0 }, "resize"));

  field.tabIndex = 0;
  field.focus();
  act(() => viewport.change({ height: 480, offsetTop: 320 }, "resize"));

  assert.equal(column.scrollTop, 620 + 24 - 480);
});

test("the focus leaving the field lets the stage down at once, ahead of WebKit measuring the keyboard gone, and a field taking it measures the keyboard again", () => {
  const viewport = new FakeVisualViewport(ENGINE.WEBKIT);
  standViewport(viewport);
  const field = document.body.appendChild(document.createElement("textarea"));
  const other = document.body.appendChild(document.createElement("input"));
  const button = document.body.appendChild(document.createElement("button"));
  mount();
  field.focus();
  act(() => viewport.change({ height: 480, offsetTop: 320 }, "resize"));
  assert.equal(readOverBody("--ui-stage-height"), "480px");

  act(() => other.focus());
  assert.equal(readOverBody("--ui-stage-height"), "480px");

  act(() => button.focus());
  assert.equal(readOverBody("--ui-viewport-top"), "0px");
  assert.equal(readOverBody("--ui-stage-height"), "800px");
  assert.equal(readOverBody("--ui-keyboard-inset"), "0px");
  act(() => viewport.change({ height: 480, offsetTop: 0 }, "scroll"));
  assert.equal(
    readOverBody("--ui-stage-height"),
    "800px",
    "a late event of the keyboard going holds the stage down",
  );
  act(() => viewport.change({ height: 800 }, "resize"));
  assert.equal(readOverBody("--ui-stage-height"), "800px");

  act(() => field.focus());
  act(() => viewport.change({ height: 480 }, "resize"));
  assert.equal(readOverBody("--ui-stage-height"), "480px");
  assert.equal(readOverBody("--ui-keyboard-inset"), "320px");
});

function scrollingColumn(): HTMLElement {
  const column = document.body.appendChild(document.createElement("div"));
  column.style.overflowY = "auto";
  Object.defineProperty(column, "scrollHeight", { configurable: true, value: 2000 });
  Object.defineProperty(column, "clientHeight", { configurable: true, value: 700 });
  column.getBoundingClientRect = () => DOMRect.fromRect({ y: stageTop(), height: 700, width: 390 });
  return column;
}

test("a box focused while words stand selected elsewhere on the page is kept above the keyboard by its own place, not theirs", () => {
  const viewport = new FakeVisualViewport(ENGINE.WEBKIT);
  standViewport(viewport);
  const column = scrollingColumn();
  const words = column.appendChild(document.createElement("p"));
  words.textContent = "Words selected on the page.";
  const field = column.appendChild(document.createElement("textarea"));
  field.getBoundingClientRect = () =>
    DOMRect.fromRect({ y: stageTop() + 650, height: 20, width: 390 });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: () => DOMRect.fromRect({ y: 150, height: 20, width: 200 }),
  });
  try {
    mount();
    field.focus();
    window.getSelection()?.selectAllChildren(words);

    act(() => viewport.change({ height: 480, offsetTop: 320 }, "resize"));

    assert.equal(column.scrollTop, 650 + 20 + 24 - 480);
  } finally {
    Reflect.deleteProperty(Range.prototype, "getBoundingClientRect");
  }
});
