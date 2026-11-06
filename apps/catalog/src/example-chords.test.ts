// @vitest-environment jsdom

import assert from "node:assert/strict";
import { APP_SHORTCUTS, shortcutAccelerator, shortcutGlyphs } from "@repo/settings/shortcuts";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { EXAMPLES } from "./examples.js";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class StillObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): [] {
    return [];
  }
}

globalThis.ResizeObserver ??= StillObserver as unknown as typeof ResizeObserver;
globalThis.IntersectionObserver ??= StillObserver as unknown as typeof IntersectionObserver;
Element.prototype.scrollIntoView ??= () => undefined;

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

function draw(id: string): HTMLElement {
  const example = EXAMPLES.find((each) => each.id === id);
  assert.ok(example, `the catalog has an example ${id}`);
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(example.Render)));
  return document.body;
}

const WINDOW_CHORDS: ReadonlySet<string> = new Set(
  Object.values(APP_SHORTCUTS).map((shortcut) =>
    shortcutGlyphs(shortcutAccelerator(shortcut.chord)).join(""),
  ),
);

test("the menu example's Copy link shows the window's chord for it", () => {
  const page = draw("menu");
  const trigger = page.querySelector<HTMLElement>("[aria-label='Task actions'][aria-haspopup]");
  assert.ok(trigger, "the task menu has its ⋯");
  act(() => trigger.click());
  const copyLink = [...page.querySelectorAll("[role='menuitem']")].find((item) =>
    item.textContent?.includes("Copy link"),
  );
  assert.ok(copyLink, "the task menu offers Copy link");
  assert.equal(copyLink.querySelector(".ui-shortcut")?.textContent, "⇧⌘C");
});

test("every chord the settings-row example draws is one the window has", () => {
  const chords = [...draw("settings-row").querySelectorAll(".ui-shortcut")].map(
    (chord) => chord.textContent,
  );
  assert.ok(chords.length > 0, "the shortcut rows draw their chords");
  for (const chord of chords) assert.ok(WINDOW_CHORDS.has(chord ?? ""), `${chord}`);
});
