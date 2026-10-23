// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { holdExits } from "../../testing/held-exits.js";
import { SavedTick } from "./saved-tick.js";

/**
 * saved-tick.test.ts -- a tick says nothing for the writes that landed
 * before it watched, says Saved in its live region once one lands, stands
 * through its motion and is taken once the motion ends, and starts over for a
 * write landing while it stands.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

/** The tick's motion, which runs until the test ends it. */
let motion: ReturnType<typeof holdExits>;

beforeEach(() => {
  motion = holdExits((element) => element.classList.contains("luke-saved-tick"));
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
  motion.restore();
});

/** An autosave that has landed `start` writes, and a button that lands one more. */
function Autosave({ start }: { start: number }): React.JSX.Element {
  const [saves, setSaves] = useState(start);
  return createElement(
    "div",
    null,
    createElement("button", { type: "button", onClick: () => setSaves(saves + 1) }, "Write"),
    createElement(SavedTick, { saves }),
  );
}

function render(start: number): HTMLElement {
  const page = document.body.appendChild(document.createElement("div"));
  const root = createRoot(page);
  roots.push(root);
  act(() => root.render(createElement(Autosave, { start })));
  return page;
}

const status = (page: HTMLElement) => page.querySelector('[role="status"]');
const land = (page: HTMLElement) => act(() => page.querySelector("button")?.click());

/** The tick's motion ending, its exit last. */
const end = () => act(() => motion.finish());

test("a tick says nothing for writes that landed before it watched", () => {
  const page = render(3);
  assert.equal(status(page)?.textContent, "");
});

test("a write landing says Saved in the live region until its motion ends", () => {
  const page = render(0);
  land(page);
  assert.equal(status(page)?.textContent, "Saved");
  end();
  assert.equal(status(page)?.textContent, "");
});

test("a write landing while the tick stands starts it over", () => {
  const page = render(0);
  land(page);
  const first = page.querySelector(".luke-saved-tick");
  land(page);
  const second = page.querySelector(".luke-saved-tick");
  assert.ok(second);
  assert.notEqual(second, first, "a tick of its own, its motion from the start");
  end();
  assert.equal(status(page)?.textContent, "");
  land(page);
  assert.equal(status(page)?.textContent, "Saved");
});
