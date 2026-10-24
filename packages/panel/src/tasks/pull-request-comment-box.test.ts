// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { Editor, TiptapEditorHTMLElement } from "@tiptap/core";
import { Effect } from "effect";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";
import { editorBundleLanded, installEditorLayout } from "../testing/composer.js";
import { type PullRequestComment, PullRequestCommentBox } from "./pull-request-comment-box.js";

/**
 * pull-request-comment-box.test.ts -- the "Add a comment" box at the foot of a pull request's Conversation, as a member meets it: Esc lets go of the box and keeps the words, and the window above it never hears the key, which would leave the task.
 *
 * The editor is the real one, from its bundle. Synthetic words.
 */

// Note that the editor's keymap reads the platform once, as it loads, to say which key Mod is, so the page is a Mac's before anything is imported.
vi.hoisted(() => {
  Object.defineProperty(navigator, "platform", { value: "MacIntel", configurable: true });
});

const roots: Root[] = [];

beforeAll(() => Effect.runPromise(editorBundleLanded));

beforeEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  installEditorLayout();
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** The box over words its tab holds, with no change out. */
function Tab({ start }: { start: string }): React.JSX.Element {
  const [body, setBody] = useState(start);
  const comment: PullRequestComment = {
    writes: {
      pending: undefined,
      note: undefined,
      write: () => Promise.reject(new Error("Not in this test.")),
      dismiss: () => undefined,
    },
    body,
    setBody,
  };
  return createElement(PullRequestCommentBox, { comment });
}

test("Esc in the comment box lets go of it, keeps its words, and never reaches the window", () => {
  const reached: string[] = [];
  // Note that the keys are heard on the window, as the app's own Escape hears them.
  const hear = (event: KeyboardEvent) => reached.push(event.key);
  window.addEventListener("keydown", hear);
  const holder = document.body.appendChild(document.createElement("div"));
  const root = createRoot(holder);
  roots.push(root);
  act(() => root.render(createElement(Tab, { start: "Looks right to me." })));
  const element =
    holder.querySelector<TiptapEditorHTMLElement>('.ProseMirror[aria-label="Comment"]') ??
    assert.fail("the box's editor is mounted");
  const editor: Editor = element.editor ?? assert.fail("the box's editor is running");
  act(() => editor.view.focus());
  assert.equal(document.activeElement, element, "the caret is in the words");

  act(() => {
    element.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
  });
  window.removeEventListener("keydown", hear);

  assert.deepEqual(reached, [], "the window never hears the Esc");
  assert.notEqual(document.activeElement, element, "the caret is let go");
  assert.equal(editor.getText(), "Looks right to me.");
});

test("Esc that closes the / menu keeps the caret in the box, and the next Esc lets go of it", () => {
  const holder = document.body.appendChild(document.createElement("div"));
  const root = createRoot(holder);
  roots.push(root);
  act(() => root.render(createElement(Tab, { start: "Looks right" })));
  const element =
    holder.querySelector<TiptapEditorHTMLElement>('.ProseMirror[aria-label="Comment"]') ??
    assert.fail("the box's editor is mounted");
  const editor: Editor = element.editor ?? assert.fail("the box's editor is running");
  const escape = () =>
    act(() => {
      element.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      );
    });
  act(() => {
    editor.view.focus();
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
  });
  act(() => {
    editor.view.dispatch(editor.state.tr.insertText(" /"));
  });
  const opened = holder.querySelector('[role="listbox"]') !== null;

  escape();
  const afterFirst = document.activeElement;
  escape();

  assert.ok(opened, "the / menu opens");
  assert.equal(afterFirst, element, "the first Esc closes the menu and keeps the caret");
  assert.notEqual(document.activeElement, element, "the second Esc lets go of the box");
});
