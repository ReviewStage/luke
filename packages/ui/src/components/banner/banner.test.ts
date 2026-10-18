// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { BANNER_LOOK, BANNER_TONE, Banner } from "./banner.js";

/**
 * banner.test.ts -- a banner is a region named by its own words, its glyph
 * is not read, and its presses answer it in reading order.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
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
      tone: BANNER_TONE.ATTENTION,
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
