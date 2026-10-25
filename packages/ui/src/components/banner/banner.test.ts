// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { STATUS_TONE } from "../../status-tone.js";
import { BANNER_LOOK, Banner } from "./banner.js";

/**
 * banner.test.ts -- a banner is a region named by its own words, its glyph
 * is not read, and its presses answer it in reading order. A strip's words
 * cut short fade out at their end rather than ending in an ellipsis.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

/** The measurement each observed box was handed, fired as a resize; jsdom lays nothing out, so nothing reports one of its own accord. */
const resizes: (() => void)[] = [];

class StandInResizeObserver {
  readonly #fire: () => void;
  constructor(fire: () => void) {
    this.#fire = fire;
  }
  observe(): void {
    resizes.push(this.#fire);
  }
  disconnect(): void {}
}

/** Stands every box's words `wide` pixels in a box 100px wide, and fires every observed box's measurement, as a resize would. */
function resize(wide: number): void {
  vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockReturnValue(wide);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(100);
  act(() => {
    for (const fire of resizes) fire();
  });
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", StandInResizeObserver);
});

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

test("a banner is named by its words, and its glyph is not read", () => {
  const view = render(
    createElement(Banner, {
      look: BANNER_LOOK.CARD,
      glyph: createElement("svg"),
      children: "This plan is archived",
    }),
  );
  const region = view.querySelector("section") ?? assert.fail("a banner");
  const named = document.getElementById(region.getAttribute("aria-labelledby") ?? "");
  assert.equal(named?.textContent, "This plan is archived");
  assert.equal(view.querySelector("svg")?.parentElement?.getAttribute("aria-hidden"), "true");
  assert.deepEqual([...view.querySelectorAll("button")], []);
});

test("a banner's presses answer it, in reading order after its words", () => {
  const pressed: string[] = [];
  const view = render(
    createElement(Banner, {
      look: BANNER_LOOK.STRIP,
      tone: STATUS_TONE.ATTENTION,
      glyph: null,
      actions: [
        createElement(
          "button",
          { key: "stop", type: "button", onClick: () => pressed.push("stop") },
          "Stop",
        ),
        createElement(
          "button",
          { key: "move", type: "button", onClick: () => pressed.push("move") },
          "Move",
        ),
      ],
      children: "This repository belongs to Acme",
    }),
  );
  assert.equal(view.textContent, "This repository belongs to AcmeStopMove");
  for (const button of view.querySelectorAll("button")) act(() => button.click());
  assert.deepEqual(pressed, ["stop", "move"]);
});

test("a strip's words fade out at their end only while the strip cuts them short, with no ellipsis", () => {
  const words = "This repository belongs to Acme, which this account cannot push to";
  const view = render(
    createElement(Banner, { look: BANNER_LOOK.STRIP, glyph: null, children: words }),
  );
  const said = () => view.querySelector(".luke-banner-words");
  resize(80);
  assert.equal(said()?.getAttribute("data-overflow"), "false");
  resize(160);
  assert.equal(said()?.getAttribute("data-overflow"), "true");
  assert.equal(said()?.textContent, words);
});
