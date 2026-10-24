// @vitest-environment jsdom

import assert from "node:assert/strict";
import { MOTION_DELAY_MS } from "@luke/brand";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import { BusyLabel, SPINNER_SIZE, Spinner, SpinnerRegion, SpinnerRing } from "./spinner.js";

/**
 * spinner.test.ts -- a wait is said to a reader from a status line that
 * stands before its ring shows, and its ring waits the settle delay by
 * default, or shows at once where asked; a busy control says what it is
 * doing beside the words it keeps, which give way to the ring once the
 * delay has passed; and a ring beside words that already say the wait says
 * nothing more.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
  vi.useRealTimers();
});

/** Whether a turning ring stands in `container`. */
function ringIn(container: HTMLElement): boolean {
  return container.querySelector(".luke-spinner-ring") !== null;
}

function render(element: ReactElement): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  return container;
}

test("a wait's status line stands from the start, and its ring waits the settle delay by default", () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const inline = render(createElement(Spinner, { label: "Loading transcript" }));
  const region = render(createElement(SpinnerRegion, { label: "Loading transcript" }));
  for (const wait of [inline, region]) {
    assert.equal(wait.querySelector('[role="status"]')?.textContent, "Loading transcript");
    assert.equal(ringIn(wait), false);
  }
  act(() => vi.advanceTimersByTime(MOTION_DELAY_MS.SETTLE - 1));
  assert.deepEqual([ringIn(inline), ringIn(region)], [false, false]);
  act(() => vi.advanceTimersByTime(1));
  assert.deepEqual([ringIn(inline), ringIn(region)], [true, true]);
});

test("a wait that asks for no delay shows its ring at once", () => {
  const prompt = render(createElement(Spinner, { label: "Loading transcript", delay: false }));
  assert.equal(ringIn(prompt), true);
});

test("a busy control's words stand until the settle delay passes, then give way to the ring", () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const busy = render(createElement(BusyLabel, { busy: true, label: "Saving", children: "Save" }));
  const words = busy.querySelector(".luke-busy-label-words") ?? assert.fail("the words");
  assert.deepEqual(
    { ring: ringIn(busy), hidden: words.classList.contains("invisible") },
    {
      ring: false,
      hidden: false,
    },
  );
  act(() => vi.advanceTimersByTime(MOTION_DELAY_MS.SETTLE));
  assert.deepEqual(
    { ring: ringIn(busy), hidden: words.classList.contains("invisible") },
    {
      ring: true,
      hidden: true,
    },
  );
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
