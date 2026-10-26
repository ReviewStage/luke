// @vitest-environment jsdom

import assert from "node:assert/strict";
import { NO_EXPERIMENTS } from "@luke/settings";
import { COMMAND_KEY, installCommandKey } from "@luke/settings/shortcuts";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test } from "vitest";
import { DESKTOP_CAPABILITIES } from "../testing/app-state.js";
import { WindowShortcutSections } from "./shortcuts-page.js";

/**
 * Settings › Keyboard shortcuts as the page draws it: its Writing group, each
 * mark and block the editors answer, with the Markdown typed for it and its
 * chord, and the rules no chord reaches among them; Escape named once; and
 * the keys that answer in place, each in the group of what it acts on.
 */

const roots: Root[] = [];

/** What puts back the command key a test installed. */
let restoreCommandKey: (() => void) | undefined;

beforeEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
});

afterEach(() => {
  restoreCommandKey?.();
  restoreCommandKey = undefined;
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
});

/** Each row of one of the page's groups, as its words read: its name, then its Markdown and its chord's glyphs. */
function groupRows(title: string, capabilities = DESKTOP_CAPABILITIES): string[] {
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  act(() =>
    root.render(
      createElement(WindowShortcutSections, { experiments: NO_EXPERIMENTS, capabilities }),
    ),
  );
  const section = [...document.querySelectorAll("section")].find(
    (each) => each.querySelector("h2")?.textContent === title,
  );
  if (section === undefined) return [];
  return [...section.querySelectorAll("[data-search-anchor]")].map((row) =>
    [...row.querySelectorAll(".luke-settings-row-label, .luke-text, .luke-shortcut-glyph")]
      .map((part) => part.textContent)
      .join(" "),
  );
}

/** Each row of the page's Writing group. */
function writingRows(): string[] {
  return groupRows("Writing");
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

test("the window's Escape is one row, under General, however many layers it steps back from", () => {
  const general = groupRows("General");
  // Note that Files changed's own Escape, which lets go of the file stood on, is the view's to list, as its sheet does.
  const escapes = [...document.querySelectorAll("section")]
    .filter((section) => section.querySelector("h2")?.textContent !== "Files changed")
    .flatMap((section) => [...section.querySelectorAll(".luke-shortcut")])
    .filter((chord) => chord.textContent === "Esc");

  assert.equal(escapes.length, 1);
  assert.ok(general.includes("Close what's open, or step back Esc"), general.join("\n"));
});

test("the keys that answer in place stand in the group of what they act on", () => {
  assert.ok(groupRows("Tasks").includes("Choose an ask's option by its number 1 – 9"));
  assert.ok(groupRows("Tasks").includes("Choose an issue for a new task ⌘ L"));
  assert.ok(groupRows("Tabs & panels").includes("Close focused tab ⌫"));
  assert.ok(groupRows("Navigation").includes("Go to chosen card ⏎"));
  assert.ok(groupRows("Image viewer").includes("Zoom image out −"));
  assert.ok(writingRows().includes("Link selected words ⌘ K"));
  assert.ok(writingRows().includes("Mention highlighted row ⇥"));
});

test("a chord in place draws its Command as the window's command key, Ctrl where Command is Ctrl", () => {
  restoreCommandKey = installCommandKey(COMMAND_KEY.CONTROL);

  assert.ok(groupRows("Tasks").includes("Choose an issue for a new task Ctrl L"));
});

test("the tab switcher's keys are listed only where the switcher stands", () => {
  assert.equal(
    groupRows("Navigation", []).some((row) => row.startsWith("Go to chosen card")),
    false,
  );
});
