// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { Editor, TiptapEditorHTMLElement } from "@tiptap/core";
import { afterEach, beforeEach, test } from "vitest";
import { installEditorLayout } from "../testing/composer.js";
import type { PlanEditorHandle } from "./contract.js";
import { mountPlanEditor } from "./plan-editor.js";

/**
 * block-rules.test.ts -- the plan editor's Markdown rules that make a block,
 * typed at the start of a line: each makes its block on a line of the text,
 * and does nothing in a table's cell, which holds one line of words, while
 * a mark's rule still marks words there. Synthetic plan.
 */

const TABLE = "| Role | Invites |\n| --- | --- |\n| Admin | Anyone |\n";

/** Each rule that makes a block, as typed, and the Markdown its block is written as on a line saying `Anyone`. */
const BLOCK_RULES = [
  { typed: "## ", written: "## Anyone" },
  { typed: "- ", written: "- Anyone" },
  { typed: "1. ", written: "1. Anyone" },
  { typed: "[ ] ", written: "- [ ] Anyone" },
  { typed: "> ", written: "> Anyone" },
] as const;

const editors: PlanEditorHandle[] = [];

beforeEach(installEditorLayout);

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  document.body.innerHTML = "";
});

/** The editor mounted on the text, and its handle. */
function mounted(markdown: string): { editor: Editor; handle: PlanEditorHandle } {
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
  editors.push(handle);
  const element = host.querySelector<TiptapEditorHTMLElement>(".plan-document-text");
  return { editor: element?.editor ?? assert.fail("the editor is running"), handle };
}

/** The caret put before `words`. */
function caretBefore(editor: Editor, words: string): void {
  let at: number | undefined;
  editor.state.doc.descendants((node, pos) => {
    if (at === undefined && node.isText && node.text?.startsWith(words)) at = pos;
  });
  editor
    .chain()
    .focus()
    .setTextSelection(at ?? assert.fail(`${words} is in the text`))
    .run();
}

/** The words typed one key at a time, as the browser's text input hands each to the editor, so a Markdown rule a key completes runs. */
function typeKeys(editor: Editor, text: string): void {
  const { view } = editor;
  for (const character of text) {
    const { from, to } = view.state.selection;
    const typed = () => view.state.tr.insertText(character, from, to);
    const ruled = view.someProp("handleTextInput", (handle) =>
      handle(view, from, to, character, typed),
    );
    if (ruled !== true) view.dispatch(typed());
  }
}

test("each rule that makes a block makes it on a line of the text", () => {
  for (const rule of BLOCK_RULES) {
    const { editor, handle } = mounted("Anyone\n");
    caretBefore(editor, "Anyone");

    typeKeys(editor, rule.typed);

    assert.equal(handle.markdown().trim(), rule.written, rule.typed);
  }
});

test("each rule that makes a block does nothing in a table's cell, its words kept as typed", () => {
  for (const rule of BLOCK_RULES) {
    const { editor, handle } = mounted(TABLE);
    caretBefore(editor, "Anyone");

    typeKeys(editor, rule.typed);

    const cells = [...editor.view.dom.querySelectorAll("td")].map((cell) => cell.innerHTML);
    assert.deepEqual(
      cells,
      ["<p>Admin</p>", `<p>${rule.typed.replace(">", "&gt;")}Anyone</p>`],
      rule.typed,
    );
    assert.ok(handle.markdown().trim().startsWith("| Role"), `${rule.typed}: the table stands`);
  }
});

test("a mark's rule still marks words in a table's cell", () => {
  const { editor, handle } = mounted(TABLE);
  caretBefore(editor, "Anyone");

  typeKeys(editor, "**all**");

  assert.ok(handle.markdown().includes("| **all**Anyone |"));
});
