// @vitest-environment jsdom

import assert from "node:assert/strict";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import type { TiptapEditorHTMLElement } from "@tiptap/core";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { useAppCommand, useAppKeymap } from "../app-commands.js";
import { installEditorLayout } from "../testing/composer.js";
import type { PlanEditorHandle } from "./contract.js";
import { mountPlanEditor } from "./plan-editor.js";

/**
 * writing-chords.test.ts -- the plan editor's writing chords against the
 * window's own: a chord the editor answers while it has the caret is the
 * editor's alone, and a chord it no longer answers reaches the window as
 * before. Synthetic text.
 */

// Note that the editor's keymap reads the platform once, as it loads, to say which key Mod is, so the page is a Mac's before anything is imported.
vi.hoisted(() => {
  Object.defineProperty(navigator, "platform", { value: "MacIntel", configurable: true });
});

/** Every editor mounted and every root drawn, taken down after each test. */
const mounted: PlanEditorHandle[] = [];
const roots: Root[] = [];

beforeEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  installEditorLayout();
});

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  for (const editor of mounted.splice(0)) editor.destroy();
  document.body.innerHTML = "";
});

/** The window's commands that share a key with a writing chord or the editor's Enter, each run recorded. */
function KeyedWindow({ ran }: { ran: string[] }): ReactElement | null {
  useAppKeymap(true);
  useAppCommand(APP_COMMAND.TOGGLE_SIDEBAR, () => ran.push("toggle sidebar"));
  useAppCommand(APP_COMMAND.TOGGLE_SPEAKER, () => ran.push("toggle speaker"));
  useAppCommand(APP_COMMAND.COPY_LINK, () => ran.push("copy link"));
  useAppCommand(APP_COMMAND.TOGGLE_FULL_SCREEN, () => ran.push("toggle full screen"));
  return null;
}

/** The window's keymap answering, with the plan editor open on `markdown` and every word of its first line selected. */
function mount(markdown: string) {
  const ran: string[] = [];
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  act(() => root.render(createElement(KeyedWindow, { ran })));
  const host = document.body.appendChild(document.createElement("div"));
  const handle = mountPlanEditor(host, {
    markdown,
    placement: undefined,
    focus: true,
    label: "Plan",
    className: "markdown plan-unit",
    onDraft: () => undefined,
    onFinish: () => undefined,
    onLeaveUp: () => undefined,
  });
  mounted.push(handle);
  const element =
    host.querySelector<TiptapEditorHTMLElement>("[role=textbox]") ?? assert.fail("the editor");
  const editor = element.editor ?? assert.fail("the editor is running");
  editor.commands.setTextSelection({ from: 1, to: editor.state.doc.firstChild?.nodeSize ?? 1 });
  return { ran, handle, element };
}

/** A key on the US layout a chord ends in: what it types alone, the character Shift makes of it, and its place. */
const KEYS = {
  b: { key: "b", shifted: "B", code: "KeyB", keyCode: 66 },
  c: { key: "c", shifted: "C", code: "KeyC", keyCode: 67 },
  e: { key: "e", shifted: "E", code: "KeyE", keyCode: 69 },
  s: { key: "s", shifted: "S", code: "KeyS", keyCode: 83 },
  x: { key: "x", shifted: "X", code: "KeyX", keyCode: 88 },
  "2": { key: "2", shifted: "@", code: "Digit2", keyCode: 50 },
  "8": { key: "8", shifted: "*", code: "Digit8", keyCode: 56 },
} as const;

/** Presses Command and `key` on `target`, with Shift or Option where asked, as a Mac keyboard spells the press: Option turns the character into another. */
function press(
  target: EventTarget,
  key: keyof typeof KEYS,
  held: { shift?: true; option?: true } = {},
): void {
  const pressed = KEYS[key];
  const character = held.option ? "∑" : held.shift ? pressed.shifted : pressed.key;
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: character,
        code: pressed.code,
        keyCode: pressed.keyCode,
        metaKey: true,
        shiftKey: held.shift === true,
        altKey: held.option === true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

test("⌘B in the plan bolds its words and leaves the sidebar alone, and toggles the sidebar with the caret in no text", () => {
  const { ran, handle, element } = mount("Ship the invite flow.\n");
  press(element, "b");
  assert.equal(handle.markdown().trim(), "**Ship the invite flow.**");
  assert.deepEqual(ran, [], "the sidebar stays as it was");

  press(document.body, "b");
  assert.deepEqual(ran, ["toggle sidebar"]);
});

test("⇧⌘X strikes the plan's words, and ⇧⌘S leaves them and toggles the speaker", () => {
  const { ran, handle, element } = mount("Ship the invite flow.\n");
  press(element, "s", { shift: true });
  assert.equal(handle.markdown().trim(), "Ship the invite flow.");
  assert.deepEqual(ran, ["toggle speaker"]);

  press(element, "x", { shift: true });
  assert.equal(handle.markdown().trim(), "~~Ship the invite flow.~~");
  assert.deepEqual(ran, ["toggle speaker"], "the speaker is left as it was");
});

test("⌥⌘C leaves the plan's line as words and copies the link", () => {
  const { ran, handle, element } = mount("Ship the invite flow.\n");
  press(element, "c", { option: true });
  assert.equal(handle.markdown().trim(), "Ship the invite flow.");
  assert.deepEqual(ran, ["copy link"]);
});

test("⌘E sets code, ⌥⌘2 a second heading, and ⇧⌘8 a bulleted list, none of them reaching the window", () => {
  const code = mount("npm test\n");
  press(code.element, "e");
  assert.equal(code.handle.markdown().trim(), "`npm test`");

  const heading = mount("Risks\n");
  press(heading.element, "2", { option: true });
  assert.equal(heading.handle.markdown().trim(), "## Risks");

  const list = mount("Email may bounce.\n");
  press(list.element, "8", { shift: true });
  assert.equal(list.handle.markdown().trim(), "- Email may bounce.");

  assert.deepEqual([...code.ran, ...heading.ran, ...list.ran], []);
});

test("⇧⌘⏎, which the editor's Enter handles too, still toggles the panel full screen", () => {
  const { ran, element } = mount("Ship the invite flow.\n");
  act(() => {
    element.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        keyCode: 13,
        metaKey: true,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  assert.deepEqual(ran, ["toggle full screen"]);
});
