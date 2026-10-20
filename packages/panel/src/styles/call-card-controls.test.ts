// @vitest-environment jsdom

import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import { layContainersAt } from "../testing/container-width.js";

/**
 * call-card-controls.test.ts -- the floating call window's card keeps its
 * buttons apart and in columns. The card's bar is 222px wide, narrow enough
 * that its controls close up (desktop.css's `@container call-bar`), yet the
 * speaker, the microphone, and End call still stand a step apart, the head's
 * own step, so the microphone stands under Video on and End call under the
 * way back. jsdom lays nothing out, so the sheets are laid for a bar that
 * narrow (`testing/container-width.ts`) and the card is built in the markup
 * `call-card.tsx` draws.
 */

let laid: HTMLStyleElement | undefined;

afterEach(() => {
  laid?.remove();
  laid = undefined;
  document.body.replaceChildren();
});

/** A floating window's card with its bar at the window's 222px: its head, its controls, and its mutes. */
function windowCard() {
  laid = layContainersAt({ "call-bar": 222 });
  const card = document.body.appendChild(document.createElement("section"));
  card.className = "call-card";
  card.dataset.surface = "window";
  const head = card.appendChild(document.createElement("div"));
  head.className = "call-card-head";
  const bar = card
    .appendChild(document.createElement("div"))
    .appendChild(document.createElement("footer"));
  bar.className = "call-bar";
  bar.dataset.call = "true";
  const controls = bar.appendChild(document.createElement("div"));
  controls.className = "call-controls";
  const mutes = controls.appendChild(document.createElement("div"));
  mutes.className = "call-mutes";
  return { head, controls, mutes };
}

test("in the floating window the call's buttons stand the head's step apart, never touching", () => {
  const { head, controls, mutes } = windowCard();
  const step = getComputedStyle(head).gap;
  assert.notEqual(step, "0px");
  assert.equal(getComputedStyle(mutes).gap, step);
  assert.equal(getComputedStyle(controls).gap, step);
});
