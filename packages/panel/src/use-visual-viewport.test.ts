// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { useVisualViewport } from "./use-visual-viewport.js";

/** A phone's visual viewport, as tall as it is shown, panned as far as it is, and zoomed as far as it is. */
class FakeVisualViewport extends EventTarget {
  height = 800;
  offsetTop = 0;
  scale = 1;

  /** The viewport changed as a phone changes it, announced by the event it fires. */
  change(
    next: { readonly height: number; readonly offsetTop?: number; readonly scale?: number },
    event: string,
  ): void {
    this.height = next.height;
    this.offsetTop = next.offsetTop ?? this.offsetTop;
    this.scale = next.scale ?? this.scale;
    this.dispatchEvent(new Event(event));
  }
}

const WINDOW_HEIGHT = 800;

let root: Root | undefined;

/** Stands the window's visual viewport in for the test, or takes it away. */
function standViewport(viewport: FakeVisualViewport | undefined): void {
  Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: WINDOW_HEIGHT });
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
  Reflect.deleteProperty(window, "innerHeight");
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

test("a pinch-zoom is not the keyboard: zoomed in and panned, the stage keeps what it was measured by, and the keyboard still lifts it once the zoom is let go", () => {
  const viewport = new FakeVisualViewport();
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

test("a keyboard opened while zoomed in still lifts the stage above it, and closed while zoomed lets it down again", () => {
  const viewport = new FakeVisualViewport();
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
