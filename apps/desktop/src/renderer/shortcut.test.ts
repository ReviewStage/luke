// @vitest-environment jsdom

import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "vitest";
import { APP_COMMAND, APP_SHORTCUTS, SHORTCUT_KEY } from "#shared/shortcuts";
import { Shortcut } from "./shortcut";

/** The chord as the window draws it: the one element, as a reader and an eye meet it. */
function drawn(props: Parameters<typeof Shortcut>[0]): HTMLElement {
  const holder = document.createElement("div");
  holder.innerHTML = renderToStaticMarkup(createElement(Shortcut, props));
  const element = holder.querySelector<HTMLElement>("kbd.shortcut");
  assert.ok(element, "a chord is drawn as one kbd");
  return element;
}

test("a window chord reads as its glyphs set tight, modifiers in the order macOS writes them", () => {
  assert.equal(drawn({ chord: APP_SHORTCUTS[APP_COMMAND.INBOX].chord }).textContent, "⇧⌘I");
  assert.equal(
    drawn({ chord: APP_SHORTCUTS[APP_COMMAND.TOGGLE_SIDE_PANEL].chord }).textContent,
    "⌥⌘B",
  );
  assert.equal(
    drawn({ chord: { key: SHORTCUT_KEY.F, control: true, option: true, shift: true } }).textContent,
    "⌃⌥⇧⌘F",
  );
});

test("a key is spelt as a Mac menu spells it: ⏎ for Return, ⌫ for Delete, Esc, and the arrows", () => {
  // ⏎ is the system face's own Return mark; it has no ↩, which another face would draw off the line.
  assert.equal(drawn({ chord: { key: SHORTCUT_KEY.ENTER } }).textContent, "⌘⏎");
  assert.equal(drawn({ chord: { key: SHORTCUT_KEY.BACKSPACE } }).textContent, "⌘⌫");
  assert.equal(drawn({ chord: { key: SHORTCUT_KEY.PLUS } }).textContent, "⌘+");
  assert.equal(drawn({ chord: { key: SHORTCUT_KEY.MINUS } }).textContent, "⌘−");
  assert.equal(drawn({ chord: { key: SHORTCUT_KEY.ESCAPE, bare: true } }).textContent, "Esc");
  assert.equal(drawn({ chord: { key: SHORTCUT_KEY.UP, bare: true } }).textContent, "↑");
});

test("a system-wide key's accelerator is spelt by the same rule as the window's chords", () => {
  assert.equal(drawn({ accelerator: "Alt+Space" }).textContent, "⌥Space");
  assert.equal(drawn({ accelerator: "Alt+S" }).textContent, "⌥S");
  // Whatever order an accelerator names its modifiers in, the chord reads in macOS's.
  assert.equal(drawn({ accelerator: "Command+Shift+K" }).textContent, "⇧⌘K");
  assert.equal(drawn({ accelerator: "CommandOrControl+Option+Ctrl+J" }).textContent, "⌃⌥⌘J");
});

test("each key is a glyph of its own, which the stylesheet sets on the capitals' line", () => {
  const glyphs = (props: Parameters<typeof Shortcut>[0]) =>
    [...drawn(props).children].map((glyph) => [glyph.className, glyph.textContent]);
  assert.deepEqual(glyphs({ chord: APP_SHORTCUTS[APP_COMMAND.INBOX].chord }), [
    ["shortcut-glyph", "⇧"],
    ["shortcut-glyph", "⌘"],
    ["shortcut-glyph", "I"],
  ]);
  assert.deepEqual(
    glyphs({ accelerator: "Alt+Space" }),
    [
      ["shortcut-glyph", "⌥"],
      ["shortcut-glyph", "Space"],
    ],
    "a key's name is one glyph, never a glyph per letter",
  );
});

test("a chord is hidden from a reader unless it is spoken, since its control already names it", () => {
  assert.equal(drawn({ accelerator: "Alt+Space" }).getAttribute("aria-hidden"), "true");
  assert.equal(drawn({ accelerator: "Alt+Space", spoken: true }).getAttribute("aria-hidden"), null);
});
