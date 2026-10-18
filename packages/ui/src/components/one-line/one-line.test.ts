// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import { ONE_LINE_ELEMENT, OneLine } from "./one-line.js";

/**
 * one-line.test.ts -- a line reads its words whole to a reader, and its
 * hint says them whole only while its box cuts them short. jsdom lays
 * nothing out, so the box's widths are stood in for, and the observer that
 * measures it is fired by hand.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

/** The measurement each observed box was handed, fired as a resize. */
const resizes: (() => void)[] = [];

/** Fires every observed box's measurement, as a resize would. */
function resize(): void {
  act(() => {
    for (const fire of resizes) fire();
  });
}

class StandInObserver {
  readonly #fire: () => void;
  constructor(fire: () => void) {
    this.#fire = fire;
  }
  observe(): void {
    resizes.push(this.#fire);
  }
  disconnect(): void {}
}

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
  resizes.splice(0);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function render(element: ReactElement): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  return container;
}

/** A hint that says the address whole while the line is cut short, as an app's tooltip would. */
function hint(line: ReactElement, clipped: boolean): ReactElement {
  return createElement("span", { "data-hint": clipped ? "sam@example.com" : "" }, line);
}

test("a line drawn whole raises no hint, and one cut short says its words whole", () => {
  vi.stubGlobal("ResizeObserver", StandInObserver);
  const view = render(
    createElement(OneLine, { as: ONE_LINE_ELEMENT.SMALL, hint, children: "sam@example.com" }),
  );
  const line = view.querySelector("small") ?? assert.fail("the line");
  assert.equal(line.textContent, "sam@example.com");
  const said = () => view.querySelector("[data-hint]")?.getAttribute("data-hint");
  vi.spyOn(line, "scrollWidth", "get").mockReturnValue(120);
  vi.spyOn(line, "clientWidth", "get").mockReturnValue(120);
  resize();
  assert.equal(said(), "");
  vi.spyOn(line, "clientWidth", "get").mockReturnValue(80);
  resize();
  assert.equal(said(), "sam@example.com");
});
