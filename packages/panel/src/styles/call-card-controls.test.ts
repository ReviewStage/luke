// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CALL_CONTROL_LABEL, CallBar } from "@luke/ui";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, test } from "vitest";
import { layContainersAt } from "../testing/container-width.js";

/**
 * call-card-controls.test.ts -- the floating call window's card keeps its
 * buttons apart and in columns. The card's bar is 222px wide, narrow enough
 * that its controls close up (`@luke/ui`'s `@container luke-call-bar`), yet the
 * speaker, the microphone, and End call still stand a step apart, the head's
 * own step, so the microphone stands under Video on and End call under the
 * way back. jsdom lays nothing out, so the sheets are laid for a bar that
 * narrow (`testing/container-width.ts`) and the card is built in the markup
 * `call-card.tsx` and `CallBar` draw. End call is the one control filled
 * red, since hanging up cannot be undone.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let laid: HTMLStyleElement | undefined;

afterEach(() => {
  laid?.remove();
  laid = undefined;
  document.body.replaceChildren();
});

/** A floating window's card with its bar at the window's 222px: its head, its controls, and its mutes. */
function windowCard() {
  laid = layContainersAt({ "luke-call-bar": 222 });
  const card = document.body.appendChild(document.createElement("section"));
  card.className = "call-card";
  card.dataset.surface = "window";
  const head = card.appendChild(document.createElement("div"));
  head.className = "call-card-head flex min-w-0 items-center gap-tight-gap";
  const bar = card
    .appendChild(document.createElement("div"))
    .appendChild(document.createElement("footer"));
  bar.className = "luke-call-bar";
  const controls = bar.appendChild(document.createElement("div"));
  controls.className = "luke-call-controls";
  const mutes = controls.appendChild(document.createElement("div"));
  mutes.className = "luke-call-mutes";
  return { head, controls, mutes };
}

test("in the floating window the call's buttons stand the head's step apart, never touching", () => {
  const { head, controls, mutes } = windowCard();
  const step = getComputedStyle(head).gap;
  assert.notEqual(step, "0px");
  assert.equal(getComputedStyle(mutes).gap, step);
  assert.equal(getComputedStyle(controls).gap, step);
});

test("End call is the bar's one red control, and the mutes are not red until muted", () => {
  laid = layContainersAt({ "luke-call-bar": 222 });
  document.documentElement.dataset.lukeProfile = "desktop";
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  const drawBar = (muted: boolean) =>
    act(() =>
      root.render(
        createElement(CallBar, {
          status: undefined,
          microphone: { muted, onPress: () => undefined },
          speaker: { muted: false, onPress: () => undefined },
          onEnd: () => undefined,
        }),
      ),
    );
  const fillOf = (name: string) => {
    const found = container.querySelector(`button[aria-label="${name}"]`);
    assert.ok(found, `${name} is offered`);
    return getComputedStyle(found).getPropertyValue("--luke-button-fill").trim();
  };
  const red = "var(--luke-color-danger-fill)";
  drawBar(false);
  assert.equal(fillOf(CALL_CONTROL_LABEL.END_CALL), red);
  const reds = [...container.querySelectorAll("button")].filter(
    (each) => getComputedStyle(each).getPropertyValue("--luke-button-fill").trim() === red,
  );
  assert.equal(reds.length, 1, "only End call is filled red");
  drawBar(true);
  assert.notEqual(
    fillOf(CALL_CONTROL_LABEL.UNMUTE_MICROPHONE),
    red,
    "a mute is tinted, never filled red",
  );
  act(() => root.unmount());
});
