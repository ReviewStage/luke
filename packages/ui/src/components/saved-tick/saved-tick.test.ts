// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, Fragment, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { holdExits } from "../../testing/held-exits.js";
import { Announcer } from "../announcer/announcer.js";
import { SavedTick } from "./saved-tick.js";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

let motion: ReturnType<typeof holdExits>;

beforeEach(() => {
  motion = holdExits((element) => element.classList.contains("ui-saved-tick"));
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
  motion.restore();
});

function Autosave({ start }: { start: number }): React.JSX.Element {
  const [saves, setSaves] = useState(start);
  return createElement(
    "div",
    null,
    createElement("button", { type: "button", onClick: () => setSaves(saves + 1) }, "Write"),
    createElement("button", { type: "button", onClick: () => setSaves(0) }, "Refuse"),
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

const said = () => document.querySelector('[role="status"]')?.textContent;
const shown = (page: HTMLElement) => page.querySelector(".ui-saved-tick")?.textContent ?? "";
const land = (page: HTMLElement) => act(() => page.querySelector("button")?.click());

const end = () => act(() => motion.finish());

test("a tick says nothing for writes that landed before it watched, nor for a count that falls back", () => {
  const page = render(3);
  assert.equal(shown(page), "");
  act(() => page.querySelectorAll("button")[1]?.click());
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
  const first = page.querySelector(".ui-saved-tick");
  land(page);
  const second = page.querySelector(".ui-saved-tick");
  assert.ok(second);
  assert.notEqual(second, first, "a tick of its own, its motion from the start");
  end();
  assert.equal(shown(page), "");
  land(page);
  assert.equal(shown(page), "Saved");
});
