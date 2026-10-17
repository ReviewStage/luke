// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { TiptapEditorHTMLElement } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { afterEach, beforeEach, test } from "vitest";
import { installEditorLayout } from "../testing/composer.js";
import type { EditorAnchors, PlanEditorHandle } from "./contract.js";
import { mountPlanEditor } from "./plan-editor.js";

/**
 * A comment thread's words in the real editor: marked as it opens with
 * nothing handed over and the text written as it was; reported where they
 * stand as words are typed before them; gone from the report, though still
 * carried, once deleted; back with their words on undo, and gone again on
 * redo. Synthetic plan.
 */

const THREAD = "0f9b5f6e-6a8e-4c51-9a0e-2c1f2f0b7a11";

const WORDS = "Admins can withdraw an invite.";

const TEXT = `## Approach\n\nThe email follows the _mock_.\n\n${WORDS} A withdrawn link never grants access again.\n`;

const editors: PlanEditorHandle[] = [];

beforeEach(installEditorLayout);

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  document.body.innerHTML = "";
});

/** The editor mounted on the text with the thread's words anchored, and every draft and report it handed over. */
function mounted() {
  const drafts: { markdown: string; anchors: EditorAnchors | undefined }[] = [];
  const host = document.createElement("div");
  document.body.append(host);
  const from = TEXT.indexOf(WORDS);
  const handle = mountPlanEditor(host, {
    markdown: TEXT,
    placement: undefined,
    focus: true,
    label: "Plan",
    className: "markdown plan-unit",
    onDraft: (markdown, anchors) => drafts.push({ markdown, anchors }),
    onFinish: () => undefined,
    onLeaveUp: () => undefined,
    anchors: [{ thread: THREAD, from, to: from + WORDS.length }],
  });
  editors.push(handle);
  const element = host.querySelector<TiptapEditorHTMLElement>(".plan-document-text");
  const editor = element?.editor;
  assert.ok(editor, "the editor is running");
  /** Where the words stand in the editor's document. */
  const spanOf = (words: string) => {
    let at: number | undefined;
    editor.state.doc.descendants((node, position) => {
      if (at === undefined && node.isText && node.text?.includes(words)) {
        at = position + node.text.indexOf(words);
      }
    });
    assert.ok(at !== undefined, `"${words}" is in the editor`);
    return { from: at, to: at + words.length };
  };
  const select = (span: { from: number; to: number }) =>
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, span.from, span.to)),
    );
  const last = () => {
    const draft = drafts.at(-1);
    assert.ok(draft, "a draft was handed over");
    return draft;
  };
  /** The words the last draft reports the thread on, or nothing where it reports none. */
  const anchored = () => {
    const { markdown, anchors } = last();
    const anchor = anchors?.anchors.find((each) => each.thread === THREAD);
    return anchor === undefined ? undefined : markdown.slice(anchor.from, anchor.to);
  };
  return { editor, handle, drafts, spanOf, select, last, anchored, host };
}

test("a thread's words are marked as the editor opens, handing nothing over and writing the text as it was", () => {
  const { drafts, host, handle } = mounted();

  assert.deepEqual(drafts, []);
  assert.equal(host.querySelector(`mark[data-threads~="${THREAD}"]`)?.textContent, WORDS);
  assert.equal(handle.markdown(), TEXT);
});

test("words typed before a thread's words move its report with them", () => {
  const { editor, spanOf, anchored, last } = mounted();
  const at = spanOf("Admins").from;
  editor.view.dispatch(editor.state.tr.insertText("Note: ", at));

  assert.equal(anchored(), WORDS);
  assert.ok(last().markdown.includes(`Note: ${WORDS}`));
});

test("deleted words leave the thread carried with no anchor, undo brings the anchor back with them, and redo takes it again", () => {
  const { editor, spanOf, select, anchored, last } = mounted();

  select(spanOf(WORDS));
  editor.commands.deleteSelection();
  assert.equal(anchored(), undefined);
  assert.deepEqual(last().anchors?.carried, [THREAD]);
  assert.ok(!last().markdown.includes(WORDS));

  editor.commands.undo();
  assert.equal(anchored(), WORDS);
  assert.ok(last().markdown.includes(WORDS));

  editor.commands.redo();
  assert.equal(anchored(), undefined);
  assert.deepEqual(last().anchors?.carried, [THREAD]);
});
