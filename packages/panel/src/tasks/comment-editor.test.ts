// @vitest-environment jsdom

import assert from "node:assert/strict";
import { PULL_REQUEST_WRITE_BOUNDS } from "@luke/features/pull-request-write-wire";
import type { Editor, TiptapEditorHTMLElement } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { Effect } from "effect";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";
import { announcedAsAlert, mountAnnouncer } from "../testing/announcer.js";
import type { AnyAct, FakeActAnswer } from "../testing/app-bridge.js";
import { FAKE_ANSWER } from "../testing/app-bridge.js";
import { editorBundleLanded, installEditorLayout } from "../testing/composer.js";
import { CommentEditor } from "./comment-editor.js";

/**
 * comment-editor.test.ts -- the box a member writes GitHub Markdown in, on
 * the plan's editor, as its owner meets it: the words formatted by the
 * writing chords and handed over as Markdown, ⌘↩ and Esc the owner's, a
 * menu's Esc the box's alone, a comment opened again handed back byte for
 * byte, `@user` and `#123` kept as GitHub reads them, and words past
 * GitHub's bound saying so. The editor is the real one, from its bundle.
 * Synthetic words.
 */

// Note that the editor's keymap reads the platform once, as it loads, to say which key Mod is, so the page is a Mac's before anything is imported.
vi.hoisted(() => {
  Object.defineProperty(navigator, "platform", { value: "MacIntel", configurable: true });
});

/** A review comment as GitHub holds it, with what a comment on github.com is written with. */
const COMMENT = [
  "> [!NOTE]",
  "> cc @dana, this follows #123.",
  "",
  "Why **twice**?",
  "",
  "```suggestion",
  "  once();",
  "```",
].join("\n");

const roots: Root[] = [];

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

/** What the owner heard: each change of the words, and what ⌘↩ and Esc handed it. */
interface Heard {
  readonly changes: string[];
  readonly submitted: string[];
  readonly cancels: number[];
}

/** The box over words its owner holds, as an owner holds them, answering ⌘↩ and Esc where asked. */
function Owner({
  start,
  heard,
  answers,
  suggestion,
}: {
  start: string;
  heard: Heard;
  answers: { submit: boolean; cancel: boolean };
  suggestion: string | undefined;
}): React.JSX.Element {
  const [body, setBody] = useState(start);
  return createElement(CommentEditor, {
    label: "Comment",
    placeholder: "Leave a comment",
    value: body,
    onChange: (next: string) => {
      heard.changes.push(next);
      setBody(next);
    },
    busy: false,
    focus: true,
    onSubmit: answers.submit ? () => heard.submitted.push(body) : undefined,
    onCancel: answers.cancel ? () => heard.cancels.push(heard.cancels.length) : undefined,
    suggestion,
  });
}

/** The box drawn in a holder that records every key reaching it, its words held by an owner. */
function mount(
  start: string,
  answers = { submit: true, cancel: true },
  suggestion: string | undefined = undefined,
) {
  const heard: Heard = { changes: [], submitted: [], cancels: [] };
  const reached: string[] = [];
  // Note that the keys are heard above the root React listens on, as a pane holding the box hears them.
  const pane = document.body.appendChild(document.createElement("div"));
  pane.addEventListener("keydown", (event) => reached.push(event.key));
  const holder = pane.appendChild(document.createElement("div"));
  const root = createRoot(holder);
  roots.push(root);
  act(() => root.render(createElement(Owner, { start, heard, answers, suggestion })));
  const element =
    holder.querySelector<TiptapEditorHTMLElement>('.ProseMirror[aria-label="Comment"]') ??
    assert.fail("the box's editor is mounted");
  const editor: Editor = element.editor ?? assert.fail("the box's editor is running");
  /** Presses a key in the words, as the member would. */
  const press = (init: KeyboardEventInit) =>
    act(() => {
      element.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }),
      );
    });
  /** Types words where the caret stands, as the editor's own input inserts them. */
  const type = (words: string) =>
    act(() => {
      editor.view.dispatch(editor.state.tr.insertText(words));
    });
  return { holder, editor, heard, reached, press, type };
}

test("words typed and bolded with ⌘B are handed over as GitHub Markdown, and ⌘↩ submits them, going no further than the box", () => {
  const { editor, heard, reached, press, type } = mount("");

  type("Ship x");
  act(() => {
    editor.commands.setTextSelection({ from: 6, to: 7 });
  });
  press({ key: "b", code: "KeyB", keyCode: 66, metaKey: true });
  press({ key: "Enter", metaKey: true });

  assert.deepEqual(heard.submitted, ["Ship **x**"]);
  assert.deepEqual(reached, [], "the chord and the submit are the box's alone");
});

test("Esc is the owner's cancel; with the / menu open it closes the menu alone, and nothing above the box hears it", () => {
  const { holder, editor, heard, reached, press, type } = mount("Intro.");
  act(() => {
    editor.view.focus();
    editor.view.dispatch(
      editor.state.tr
        .setSelection(TextSelection.atEnd(editor.state.doc))
        .split(editor.state.doc.content.size - 1),
    );
  });
  type("/");
  assert.ok(holder.querySelector(".luke-block-menu") !== null, "the / menu stands");

  press({ key: "Escape" });
  assert.equal(holder.querySelector(".luke-block-menu"), null, "Esc closes the menu");
  assert.deepEqual(heard.cancels, [], "and lets nothing go");

  press({ key: "Escape" });
  assert.deepEqual(heard.cancels, [0]);
  assert.deepEqual(reached, [], "neither Esc reaches what holds the box");
});

test("a box whose owner answers neither ⌘↩ nor Esc passes them on to what holds it", () => {
  const { reached, press } = mount("Words.", { submit: false, cancel: false });

  press({ key: "Enter", metaKey: true });
  press({ key: "Escape" });

  assert.deepEqual(reached, ["Enter", "Escape"]);
});

test("a comment opened on its Markdown hands nothing over untouched, and an edit of one paragraph changes that paragraph alone, the alert, the mention, the issue, and the suggestion byte for byte", () => {
  const { editor, heard, type } = mount(COMMENT);

  assert.deepEqual(heard.changes, [], "opening it changes nothing");

  let at = -1;
  editor.state.doc.descendants((node, pos) => {
    const found = node.isText ? (node.text ?? "").indexOf("twice") : -1;
    if (at < 0 && found >= 0) at = pos + found;
  });
  act(() => {
    editor.commands.setTextSelection({ from: at, to: at + "twice".length });
  });
  type("thrice");

  assert.equal(heard.changes.at(-1), COMMENT.replace("twice", "thrice"));
});

test("@user and #123 typed at a line's start stay as GitHub reads them, a mention and an issue, not escaped", () => {
  const { heard, type } = mount("");

  type("#123 is fixed, thanks @dana");

  assert.equal(heard.changes.at(-1), "#123 is fixed, thanks @dana");
});

test("Esc in the link field gives the link up alone: the box stays open and nothing above it hears the key", () => {
  const { holder, editor, heard, reached } = mount("Ship it");
  act(() => {
    editor.view.focus();
    editor.commands.setTextSelection({ from: 1, to: 5 });
  });
  act(() =>
    (
      holder.querySelector<HTMLButtonElement>('[role="toolbar"] button[aria-label="Link"]') ??
      assert.fail("the toolbar offers Link")
    ).click(),
  );
  const field =
    holder.querySelector<HTMLInputElement>('input[aria-label="Link"]') ??
    assert.fail("Link opens the link field");

  act(() => {
    field.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );
  });

  assert.equal(holder.querySelector('input[aria-label="Link"]'), null, "the link field closes");
  assert.deepEqual(heard.cancels, [], "the box is not let go");
  assert.deepEqual(reached, [], "nothing above the box hears the Esc");
});

test("Add a suggestion over words selected into an empty last line keeps the words and lays the block in after them", () => {
  const { holder, editor, heard } = mount("Please fix this", undefined, "  once();");
  act(() => {
    editor.view.focus();
    editor.view.dispatch(
      editor.state.tr
        .setSelection(TextSelection.atEnd(editor.state.doc))
        .split(editor.state.doc.content.size - 1),
    );
  });
  act(() => {
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, 8, editor.state.doc.content.size - 1),
      ),
    );
  });
  assert.equal(
    editor.state.selection.$to.parent.content.size,
    0,
    "the selection ends on the empty line",
  );

  act(() =>
    (
      holder.querySelector<HTMLButtonElement>('button[aria-label="Add a suggestion"]') ??
      assert.fail("a suggestion is offered")
    ).click(),
  );

  const sent = heard.changes.at(-1) ?? assert.fail("the block is handed over");
  assert.ok(sent.startsWith("Please fix this\n"), "the selected words stay");
  assert.ok(sent.endsWith("```suggestion\n  once();\n```"), "the suggestion follows them");
});

test("words past GitHub's bound say by how much, and are announced as an alert", () => {
  mountAnnouncer();
  const { holder } = mount("a".repeat(PULL_REQUEST_WRITE_BOUNDS.MAX_BODY_CHARS + 2));

  assert.equal(
    holder.querySelector(".comment-editor-note")?.textContent,
    "2 characters over GitHub's limit.",
  );
  assert.equal(announcedAsAlert(), "2 characters over GitHub's limit.");
});
