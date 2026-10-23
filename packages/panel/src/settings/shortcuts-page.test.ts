// @vitest-environment jsdom

import assert from "node:assert/strict";
import { NO_EXPERIMENTS } from "@luke/settings";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { DESKTOP_CAPABILITIES } from "../testing/app-state.js";
import { WindowShortcutSections } from "./shortcuts-page.js";

/**
 * Settings › Keyboard shortcuts' Writing group as the page draws it: each
 * mark and block the editors answer, with the Markdown typed for it and its
 * chord, and the rules no chord reaches among them.
 */

const roots: Root[] = [];

beforeEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
});

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
});

/** Each row of the page's Writing group, as its words read: its name, then its Markdown and its chord's glyphs. */
function writingRows(): string[] {
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  act(() =>
    root.render(
      createElement(WindowShortcutSections, {
        experiments: NO_EXPERIMENTS,
        capabilities: DESKTOP_CAPABILITIES,
      }),
    ),
  );
  const section = [...document.querySelectorAll("section")].find(
    (each) => each.querySelector("h2")?.textContent === "Writing",
  );
  if (section === undefined) return [];
  return [...section.querySelectorAll("[data-search-anchor]")].map((row) =>
    [...row.querySelectorAll(".luke-settings-row-label, .luke-text, .luke-shortcut-glyph")]
      .map((part) => part.textContent)
      .join(" "),
  );
}

test("Writing lists each mark and block with the Markdown typed for it and its chord, Strikethrough on ⇧⌘X and Code block on no chord", () => {
  const rows = writingRows();

  assert.ok(rows.includes("Bold **x** ⌘ B"), rows.join("\n"));
  assert.ok(rows.includes("Strikethrough ~~x~~ ⇧ ⌘ X"));
  assert.ok(rows.includes("Heading 2 ## ⌥ ⌘ 2"));
  assert.ok(rows.includes("Code block ```"));
  assert.ok(rows.includes("Divider ---"));
  assert.ok(rows.includes("Text ⌥ ⌘ 0"));
});
