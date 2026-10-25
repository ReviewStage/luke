// @vitest-environment jsdom

import assert from "node:assert/strict";
import { RegistryContext } from "@effect/atom-react/RegistryContext";
import { MOTION_DELAY_MS } from "@luke/brand";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import { ONE_LINE_ELEMENT, OneLine } from "./one-line.js";

/**
 * one-line.test.ts -- a line reads its words whole to a reader, and its
 * hint says them whole only while its box cuts them short, the window's
 * tooltip where its caller gives none. jsdom lays nothing out, so the box's widths are stood in for, and the observer that
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

/** The pointer arriving on `target` and resting there past the hint's wait, on a faked clock. */
function restOn(target: Element): void {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    act(() => {
      target.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
    });
    act(() => {
      vi.advanceTimersByTime(MOTION_DELAY_MS.HINT);
    });
  } finally {
    vi.useRealTimers();
  }
}

/** A line as the window draws it, its box `width` wide against words 120 wide, with no hint of its caller's. */
function renderUnhinted(width: number): { view: HTMLElement; line: Element } {
  vi.stubGlobal("ResizeObserver", StandInObserver);
  const view = render(
    createElement(
      RegistryContext.Provider,
      { value: AtomRegistry.make() },
      createElement(OneLine, { children: "A very long task name" }),
    ),
  );
  const line = view.querySelector(".luke-one-line") ?? assert.fail("the line");
  vi.spyOn(line, "scrollWidth", "get").mockReturnValue(120);
  vi.spyOn(line, "clientWidth", "get").mockReturnValue(width);
  resize();
  return { view, line };
}

test("a line cut short reads its words whole in the window's tooltip, though its caller gave no hint", () => {
  const { line } = renderUnhinted(80);
  restOn(line);
  const said = document.querySelector('[role="tooltip"]') ?? assert.fail("the tooltip");
  assert.equal(said.textContent, "A very long task name");
});

test("a line drawn whole raises no tooltip of its own", () => {
  const { line } = renderUnhinted(120);
  restOn(line);
  assert.equal(document.querySelector('[role="tooltip"]'), null);
});

test("a caller's own hint stands in the tooltip's place", () => {
  vi.stubGlobal("ResizeObserver", StandInObserver);
  const view = render(
    createElement(
      RegistryContext.Provider,
      { value: AtomRegistry.make() },
      createElement(OneLine, { hint, children: "sam@example.com" }),
    ),
  );
  const line = view.querySelector(".luke-one-line") ?? assert.fail("the line");
  vi.spyOn(line, "scrollWidth", "get").mockReturnValue(120);
  vi.spyOn(line, "clientWidth", "get").mockReturnValue(80);
  resize();
  restOn(line);
  assert.equal(document.querySelector('[role="tooltip"]'), null);
  assert.equal(view.querySelector("[data-hint]")?.getAttribute("data-hint"), "sam@example.com");
});
