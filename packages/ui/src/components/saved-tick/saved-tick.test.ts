// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, Fragment, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { holdExits } from "../../testing/held-exits.js";
import { Announcer } from "../announcer/announcer.js";
import { SavedTick } from "./saved-tick.js";

/**
 * saved-tick.test.ts -- a tick says nothing for the writes that landed
 * before it watched, says Saved through the announcer once one lands, stands
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
  act(() =>
    root.render(
      createElement(Fragment, null, createElement(Announcer), createElement(Autosave, { start })),
    ),
  );
  return page;
}

/** What the window's announcer says politely now. */
const said = () => document.querySelector('[role="status"]')?.textContent;
/** The tick's words while it stands, or nothing once it is taken. */
const shown = (page: HTMLElement) => page.querySelector(".luke-saved-tick")?.textContent ?? "";
const land = (page: HTMLElement) => act(() => page.querySelector("button")?.click());

/** The tick's motion ending, its exit last. */
const end = () => act(() => motion.finish());

test("a tick says nothing for writes that landed before it watched", () => {
  const page = render(3);
  assert.equal(shown(page), "");
  assert.equal(said(), "");
});

test("a write landing shows Saved until its motion ends, and says it politely", () => {
  const page = render(0);
  land(page);
  assert.equal(shown(page), "Saved");
  assert.equal(said(), "Saved");
  end();
  assert.equal(shown(page), "");
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
  assert.equal(shown(page), "");
  land(page);
  assert.equal(shown(page), "Saved");
});
