// @vitest-environment jsdom

import assert from "node:assert/strict";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import type { TiptapEditorHTMLElement } from "@tiptap/core";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { useAppCommand, useAppKeymap } from "../app-commands.js";
import { installEditorLayout } from "../testing/composer.js";
import type { DescriptionEditorHandle } from "./contract.js";
import { mountDescriptionEditor } from "./description-editor.js";

vi.hoisted(() => {
  Object.defineProperty(navigator, "platform", { value: "MacIntel", configurable: true });
});

const mounted: DescriptionEditorHandle[] = [];
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

function KeyedWindow({ ran }: { ran: string[] }): ReactElement | null {
  useAppKeymap(true);
  useAppCommand(APP_COMMAND.TOGGLE_SIDEBAR, () => ran.push("toggle sidebar"));
  useAppCommand(APP_COMMAND.COPY_CONTENT, () => ran.push("copy description"));
  useAppCommand(APP_COMMAND.TOGGLE_FULL_SCREEN, () => ran.push("toggle full screen"));
  return null;
}

function mount(markdown: string) {
  const ran: string[] = [];
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  act(() => root.render(createElement(KeyedWindow, { ran })));
  const host = document.body.appendChild(document.createElement("div"));
  const handle = mountDescriptionEditor(host, {
    markdown,
    placement: undefined,
    focus: true,
    label: "Description",
    className: "markdown description-unit",
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

const KEYS = {
  b: { key: "b", shifted: "B", code: "KeyB", keyCode: 66 },
  c: { key: "c", shifted: "C", code: "KeyC", keyCode: 67 },
  e: { key: "e", shifted: "E", code: "KeyE", keyCode: 69 },
  x: { key: "x", shifted: "X", code: "KeyX", keyCode: 88 },
  "2": { key: "2", shifted: "@", code: "Digit2", keyCode: 50 },
  "8": { key: "8", shifted: "*", code: "Digit8", keyCode: 56 },
} as const;

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

test("⌘B in the description bolds its words and leaves the sidebar alone, and toggles the sidebar with the caret in no text", () => {
  const { ran, handle, element } = mount("Ship the invite flow.\n");
  press(element, "b");
  assert.equal(handle.markdown().trim(), "**Ship the invite flow.**");
  assert.deepEqual(ran, [], "the sidebar stays as it was");

  press(document.body, "b");
  assert.deepEqual(ran, ["toggle sidebar"]);
});

test("⇧⌘X strikes the description's words", () => {
  const { ran, handle, element } = mount("Ship the invite flow.\n");
  press(element, "x", { shift: true });
  assert.equal(handle.markdown().trim(), "~~Ship the invite flow.~~");
  assert.deepEqual(ran, []);
});

test("⌥⌘C leaves the description's line as words and copies the description", () => {
  const { ran, handle, element } = mount("Ship the invite flow.\n");
  press(element, "c", { option: true });
  assert.equal(handle.markdown().trim(), "Ship the invite flow.");
  assert.deepEqual(ran, ["copy description"]);
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

test("a block's chord in a table's cell does nothing, reaching neither the cell nor the window, while ⌘B still bolds there", () => {
  const { handle, element } = mount("| Role | Invites |\n| --- | --- |\n| Admin | Anyone |\n");
  const editor = element.editor ?? assert.fail("the editor is running");
  let cell = { from: 0, to: 0 };
  editor.state.doc.descendants((node, pos) => {
    if (node.isText && node.text === "Anyone") cell = { from: pos, to: pos + node.nodeSize };
  });
  const before = handle.markdown();

  const heard: string[] = [];
  const hear = (event: KeyboardEvent) => heard.push(event.key);
  act(() => {
    editor.commands.setTextSelection(cell);
  });
  window.addEventListener("keydown", hear);
  press(element, "2", { option: true });
  press(element, "8", { shift: true });
  press(element, "b", { shift: true });
  window.removeEventListener("keydown", hear);

  assert.equal(handle.markdown(), before, "the cell keeps its one line of words");
  assert.deepEqual(heard, [], "the window hears none of them");
  press(element, "b");
  assert.ok(handle.markdown().includes("| **Anyone** |"), "a mark is still laid on in a cell");
});

test("a block's chord over words that run through a table, from a line before it to one after, leaves the description as it was", () => {
  const { handle, element } = mount("Intro\n\n| A |\n| --- |\n| value |\n\nOutro\n");
  const editor = element.editor ?? assert.fail("the editor is running");
  const before = handle.markdown();

  act(() => {
    editor.commands.setTextSelection({ from: 1, to: editor.state.doc.content.size - 1 });
  });
  press(element, "2", { option: true });
  press(element, "8", { shift: true });

  assert.equal(handle.markdown(), before);
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
