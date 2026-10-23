// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { RollingNumber } from "./rolling-number.js";

/**
 * rolling-number.test.ts -- a count drawn first stands still; a change rolls
 * only the digits that changed, up as it grows and down as it falls, the
 * digit leaving never among the words a reader hears or copies, and gone
 * once its exit has run.
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

/** A count drawn into the page, and a way to draw it again at another value. */
function drawn(value: number): { view: HTMLElement; to: (next: number) => void } {
  const view = document.body.appendChild(document.createElement("p"));
  const root = createRoot(view);
  roots.push(root);
  act(() => root.render(createElement(RollingNumber, { value })));
  return {
    view,
    to: (next) => act(() => root.render(createElement(RollingNumber, { value: next }))),
  };
}

/** The digits rolling in, by their way. */
function rolling(view: HTMLElement): string[] {
  return [...view.querySelectorAll(".luke-rolling-number-digit[data-roll]")].map(
    (digit) => `${digit.textContent ?? ""}:${digit.getAttribute("data-roll") ?? ""}`,
  );
}

/** The digits leaving, by their way. */
function leaving(view: HTMLElement): string[] {
  return [...view.querySelectorAll(".luke-rolling-number-leaving")].map(
    (digit) => `${digit.getAttribute("data-digit") ?? ""}:${digit.getAttribute("data-roll") ?? ""}`,
  );
}

test("a count drawn first stands still", () => {
  const { view } = drawn(12);
  assert.equal(view.textContent, "12");
  assert.deepEqual(rolling(view), []);
  assert.deepEqual(leaving(view), []);
});

test("a count that grows rolls up only the digits that changed, saying only its new value", () => {
  const { view, to } = drawn(19);
  to(20);
  assert.equal(view.textContent, "20");
  assert.deepEqual(rolling(view), ["2:up", "0:up"]);
  assert.deepEqual(leaving(view), ["1:up", "9:up"]);
  to(21);
  assert.deepEqual(rolling(view), ["1:up"]);
  assert.deepEqual(leaving(view), ["0:up"]);
});

test("a count that falls rolls down, and one that gains a digit rolls the new one in alone", () => {
  const { view, to } = drawn(3);
  to(2);
  assert.deepEqual(rolling(view), ["2:down"]);
  assert.deepEqual(leaving(view), ["3:down"]);
  to(10);
  assert.equal(view.textContent, "10");
  assert.deepEqual(rolling(view), ["1:up", "0:up"]);
  assert.deepEqual(leaving(view), ["2:up"]);
});

test("a digit leaving is taken out once its exit has run, the one arriving left as it is", () => {
  const { view, to } = drawn(4);
  to(5);
  const exit = view.querySelector(".luke-rolling-number-leaving") ?? assert.fail("a digit leaving");
  act(() => {
    // Note that React hears the end under whichever name the engine says it has, which jsdom leaves it to guess.
    for (const name of ["animationend", "webkitAnimationEnd"]) {
      exit.dispatchEvent(new Event(name, { bubbles: true }));
    }
  });
  assert.deepEqual(leaving(view), []);
  assert.deepEqual(rolling(view), ["5:up"]);
});
