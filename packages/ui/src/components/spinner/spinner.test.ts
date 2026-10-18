// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { BusyLabel, SPINNER_SIZE, Spinner, SpinnerRegion, SpinnerRing } from "./spinner.js";

/**
 * spinner.test.ts -- a wait is said to a reader from a status line that
 * stands before it shows, and a busy control says what it is doing beside
 * the words it keeps, and a ring beside words that already say the wait
 * says nothing more.
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

test("a wait's status line stands empty until it shows, and then says the wait", () => {
  const waiting = render(createElement(Spinner, { label: "Loading transcript", shown: false }));
  assert.equal(waiting.querySelector('[role="status"]')?.textContent, "");
  const shown = render(createElement(SpinnerRegion, { label: "Loading transcript" }));
  assert.equal(shown.querySelector('[role="status"]')?.textContent, "Loading transcript");
});

test("a busy control keeps its words and says what it is doing; at rest it says its words alone", () => {
  const busy = render(
    createElement(BusyLabel, {
      busy: true,
      label: "Checking for updates",
      children: "Check for updates",
    }),
  );
  assert.equal(busy.textContent, "Check for updatesChecking for updates");
  const idle = render(
    createElement(BusyLabel, {
      busy: false,
      label: "Checking for updates",
      children: "Check for updates",
    }),
  );
  assert.equal(idle.textContent, "Check for updates");
});

test("a ring drawn at a size beside words that say the wait adds nothing a reader hears", () => {
  const line = render(
    createElement(
      "span",
      null,
      createElement(SpinnerRing, { size: SPINNER_SIZE.SMALL }),
      "Waiting",
    ),
  );
  assert.equal(line.querySelector('[role="status"]'), null);
  const ring = line.firstElementChild?.firstElementChild ?? assert.fail("the ring");
  assert.equal(ring.getAttribute("aria-hidden"), "true");
  assert.equal(line.textContent, "Waiting");
});
