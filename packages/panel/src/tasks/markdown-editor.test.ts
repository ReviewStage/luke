// @vitest-environment jsdom

import assert from "node:assert/strict";
import { BLOCK_MENU_GROUP } from "@luke/ui";
import type { Editor, TiptapEditorHTMLElement } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { Effect } from "effect";
import { act, createElement, type RefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test } from "vitest";
import { type PlanEditorHandle, SLASH_INSERT } from "../plan-editor/contract.js";
import type { AnyAct, FakeActAnswer } from "../testing/app-bridge.js";
import { FAKE_ANSWER } from "../testing/app-bridge.js";
import { editorBundleLanded, installEditorLayout } from "../testing/composer.js";
import { MarkdownEditor, type MarkdownEditorProps } from "./markdown-editor.js";

/**
 * markdown-editor.test.ts -- the plan's editor mounted by a document that
 * takes none of the plan's options, as a pull request's description or a
 * review's comment mounts it: a GitHub-flavored body handed back byte for
 * byte, and changed only where it is edited; the whole format toolbar over
 * selected words; and the `/` menu offering the document's own block, less
 * the blocks it drops. The editor is the real one, from its bundle.
 * Synthetic body.
 */

/** A pull request's description as GitHub holds it, every construct its Markdown has that the plan's text has not among it. */
const BODY = [
  "## Summary",
  "",
  "This lifts the editor out of the plan.",
  "",
  "> [!NOTE]",
  "> The plan behaves as before.",
  "",
  "<details>",
  "<summary>Why it moved</summary>",
  "",
  "Two more documents mount it.",
  "",
  "</details>",
  "",
  "- [x] The plan mounts it",
  "- [ ] A description mounts it",
  "",
  "| Case | Kept |",
  "| --- | :-: |",
  "| alert | yes |",
  "",
  "![The toolbar](https://example.com/toolbar.png)",
  "",
  "It keeps footnotes[^1] too.",
  "",
  "[^1]: Byte for byte.",
  "",
  "```suggestion",
  "const kept = true;",
  "```",
  "",
].join("\n");

/** A review comment's own block, as a line comment offers it. */
const SUGGESTION = {
  group: BLOCK_MENU_GROUP.BLOCKS,
  row: { id: "suggestion", label: "Suggestion", icon: null },
  aliases: ["suggest"],
  markdown: "```suggestion\nconst kept = true;\n```",
};

const roots: Root[] = [];

// Landed before any document renders, as the panel lands it after its first paint.
beforeAll(() => Effect.runPromise(editorBundleLanded));

beforeEach(() => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  installEditorLayout();
  Object.defineProperty(window, "luke", {
    configurable: true,
    value: {
      act: (_request: AnyAct): Promise<FakeActAnswer> =>
        Promise.resolve({ status: FAKE_ANSWER.UNKNOWN_ACT }),
      recordSurfaceEvent: () => undefined,
    },
  });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** The editor mounted on `markdown` with none of the plan's options but those given, each draft it hands over kept. */
function mounted(markdown: string, options: Partial<MarkdownEditorProps> = {}) {
  const drafts: string[] = [];
  const handle: RefObject<PlanEditorHandle | undefined> = { current: undefined };
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(MarkdownEditor, {
        markdown,
        label: "Description",
        roomLabel: "Editing the description",
        placeholder: "Add a description",
        className: "markdown",
        onDraft: (draft) => drafts.push(draft),
        onFinish: () => undefined,
        handle,
        ...options,
      }),
    ),
  );
  const element = container.querySelector<TiptapEditorHTMLElement>(".ProseMirror");
  const editor = element?.editor ?? assert.fail("the editor is running");
  return {
    container,
    editor,
    handle: handle.current ?? assert.fail("the editor's handle is kept"),
    last: () => drafts.at(-1) ?? assert.fail("a draft was handed over"),
  };
}

/** Where `words` stand in the editor's text, as positions. */
function positionsOf(editor: Editor, words: string): { from: number; to: number } {
  let found: { from: number; to: number } | undefined;
  editor.state.doc.descendants((node, pos) => {
    const at = node.isText ? (node.text ?? "").indexOf(words) : -1;
    if (found === undefined && at >= 0) found = { from: pos + at, to: pos + at + words.length };
  });
  return found ?? assert.fail(`${words} is in the text`);
}

/** Words typed where the caret stands, as the editor's own input inserts them. */
function type(editor: Editor, words: string): void {
  act(() => {
    editor.view.dispatch(editor.state.tr.insertText(words));
  });
}

/** The rows the `/` menu offers now, by their words; none while it stands closed. */
function offered(container: HTMLElement): string[] {
  return [...container.querySelectorAll(".luke-block-menu .luke-combobox-option-label")].map(
    (row) => row.textContent ?? "",
  );
}

test("a document with none of the plan's options hands a GitHub body back byte for byte, and a word changed in one paragraph changes that paragraph's source alone", () => {
  const { editor, handle, last } = mounted(BODY);

  assert.equal(handle.markdown(), BODY);

  const { from, to } = positionsOf(editor, "lifts");
  act(() => {
    editor.view.dispatch(editor.state.tr.insertText("moves", from, to));
  });

  assert.equal(last(), BODY.replace("This lifts the editor", "This moves the editor"));
});

test("words selected in a document with none of the plan's options raise the whole format toolbar, Turn into among it, and no Comment", () => {
  const { container, editor } = mounted(BODY);

  act(() => {
    editor.view.focus();
    editor.commands.setTextSelection(positionsOf(editor, "lifts the editor"));
  });

  const toolbar =
    container.querySelector<HTMLElement>('[role="toolbar"][aria-label="Formatting"]') ??
    assert.fail("the toolbar stands");
  const names = [...toolbar.querySelectorAll("button")].map(
    (each) => each.getAttribute("aria-label") ?? each.textContent ?? "",
  );
  assert.ok(
    names.some((name) => name.startsWith("Turn into")),
    "Turn into stands",
  );
  for (const name of ["Bold", "Italic", "Strikethrough", "Code", "Link"]) {
    assert.ok(names.includes(name), `${name} stands`);
  }
  assert.ok(!names.includes("Comment"), "no Comment stands where the document takes none");
});

test("a / offers the document's own block in its group, less the blocks the document drops, and choosing it lays in its Markdown in place of the / word's line", () => {
  const { container, editor, last } = mounted("Intro.\n", {
    ownBlocks: [SUGGESTION],
    droppedBlocks: new Set([SLASH_INSERT.DIAGRAM, SLASH_INSERT.TABLE]),
  });
  act(() => {
    editor.view.focus();
    editor.view.dispatch(
      editor.state.tr
        .setSelection(TextSelection.atEnd(editor.state.doc))
        .split(editor.state.doc.content.size - 1),
    );
  });

  type(editor, "/");
  const rows = offered(container);
  assert.ok(rows.includes("Suggestion"), "the document's own block is offered");
  assert.ok(rows.includes("Divider"), "the menu's own blocks stay");
  assert.ok(!rows.includes("Diagram") && !rows.includes("Table"), "the dropped blocks are not");
  assert.ok(
    rows.indexOf("Suggestion") > rows.indexOf("Code block"),
    "it stands at the end of its group",
  );

  type(editor, "sugg");
  assert.deepEqual(offered(container), ["Suggestion"]);
  act(() => {
    editor.view.dom.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
    );
  });

  assert.deepEqual(offered(container), [], "the menu closes on the choice");
  assert.equal(last(), "Intro.\n\n```suggestion\nconst kept = true;\n```\n");
});

test("a document with nothing above its text leaves ↑ on its first line to the editor", () => {
  const { editor } = mounted(BODY);
  act(() => {
    editor.view.focus();
    editor.commands.setTextSelection(1);
  });

  const up = new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true });
  act(() => {
    editor.view.dom.dispatchEvent(up);
  });

  assert.equal(up.defaultPrevented, false);
});

test("a word changed inside a GitHub alert keeps its marker unescaped, so GitHub still draws it as an alert", () => {
  const { editor, last } = mounted(BODY);

  const { from, to } = positionsOf(editor, "behaves");
  act(() => {
    editor.view.dispatch(editor.state.tr.insertText("works", from, to));
  });

  assert.equal(last(), BODY.replace("The plan behaves as before.", "The plan works as before."));
});

test("a body saved with Windows line endings comes back byte for byte untouched, and keeps them where a word is changed", () => {
  const crlf = BODY.replaceAll("\n", "\r\n");
  const { editor, handle, last } = mounted(crlf);

  assert.equal(handle.markdown(), crlf);

  const { from, to } = positionsOf(editor, "lifts");
  act(() => {
    editor.view.dispatch(editor.state.tr.insertText("moves", from, to));
  });

  assert.equal(last(), crlf.replace("This lifts the editor", "This moves the editor"));
});
