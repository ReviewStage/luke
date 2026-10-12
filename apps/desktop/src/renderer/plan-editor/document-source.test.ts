// @vitest-environment jsdom

import assert from "node:assert/strict";
import { Editor } from "@tiptap/core";
import { diffLines } from "diff";
import { afterEach, test } from "vitest";
import {
  documentManager,
  documentMarkdown,
  documentOpened,
  documentTook,
  sourcesOf,
} from "./document-source";
import { markdownExtensions } from "./plan-editor";

/**
 * A whole plan in the editor keeps every block's exact source but the ones
 * the developer changes, so an edit is a change on its own lines only.
 */

const DOCUMENT = [
  "## Problem",
  "",
  "Only an admin can add someone,",
  "soft wrapped onto a second line with _em_ and __strong__.",
  "",
  "* one",
  "* two",
  "",
  "1) first",
  "2) second",
  "",
  "Press <kbd>Ctrl</kbd> twice.",
  "",
  "A footnote[^1] and a [link][ref].",
  "",
  "[^1]: The note.",
  "",
  "[ref]: https://example.com",
  "",
  "| a | b |",
  "| - | - |",
  "| 1 | 2 |",
  "",
  "## Decisions",
  "",
  "Model an invite as a `memberships` row.",
  "",
  "<div>block html</div>",
  "",
].join("\n");

const editors: Editor[] = [];

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  document.body.innerHTML = "";
});

/** The document in an editor, with what it would hand over now. */
function opened(markdown: string) {
  const extensions = markdownExtensions();
  const manager = documentManager(extensions);
  const source = documentOpened(manager, markdown);
  const host = document.createElement("div");
  document.body.append(host);
  const editor = new Editor({
    element: host,
    extensions,
    content: source.content,
    contentType: "json",
  });
  editors.push(editor);
  let held = sourcesOf(editor.state.doc, source);
  return {
    editor,
    host,
    handedOver: () => documentMarkdown(manager, editor.state.doc, held),
    took: (sent: string, merged: string) => {
      const answer = documentTook(editor, manager, held, sent, merged);
      held = answer.held;
      return answer.base;
    },
  };
}

async function retype(host: HTMLElement, words: string, next: string): Promise<void> {
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node !== null && !node.textContent?.includes(words)) node = walker.nextNode();
  assert.ok(node, words);
  node.textContent = node.textContent?.replace(words, next) ?? next;
  await new Promise<void>((settled) => queueMicrotask(settled));
  await new Promise<void>((settled) => queueMicrotask(settled));
}

/** The lines one document has that the other does not. */
function changedLines(before: string, after: string): string[] {
  return diffLines(before, after)
    .filter((part) => part.added === true || part.removed === true)
    .flatMap((part) =>
      part.value
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => `${part.added ? "+" : "-"}${line}`),
    );
}

test("a document opened and handed over untouched is byte for byte what it was", () => {
  const { handedOver } = opened(DOCUMENT);

  assert.equal(handedOver(), DOCUMENT);
});

test("a word typed into one paragraph changes that paragraph's lines and nothing else", async () => {
  const { host, handedOver } = opened(DOCUMENT);

  await retype(host, "Model an invite as a", "Model an invite as one");

  assert.deepEqual(changedLines(DOCUMENT, handedOver()), [
    "-Model an invite as a `memberships` row.",
    "+Model an invite as one `memberships` row.",
  ]);
});

test("what the editor cannot draw faithfully stays raw and locked: inline HTML, footnotes, link definitions, block HTML", () => {
  const { host } = opened(DOCUMENT);

  const raw = [...host.querySelectorAll("pre[data-raw-block]")].map((block) =>
    block.textContent?.trim(),
  );
  assert.deepEqual(raw, [
    "Press <kbd>Ctrl</kbd> twice.",
    "A footnote[^1] and a [link][ref].",
    "[^1]: The note.",
    "[ref]: https://example.com",
    "<div>block html</div>",
  ]);
  assert.ok(
    [...host.querySelectorAll("pre[data-raw-block]")].every(
      (block) => block.getAttribute("contenteditable") === "false",
    ),
  );
});

test("Luke's part of a merged answer replaces only the blocks he changed, and the caret stays in the developer's block", async () => {
  const { editor, host, handedOver, took } = opened(DOCUMENT);
  await retype(host, "Model an invite as a", "Model an invite as one");
  const sent = handedOver();
  editor.commands.setTextSelection(editor.state.doc.content.size - 30);
  const caretBlock = editor.state.selection.$from.node(1).textContent;
  const merged = sent.replace(
    "Only an admin can add someone,",
    "Only an admin or an owner can add someone,",
  );

  took(sent, merged);

  assert.equal(handedOver(), merged);
  assert.equal(editor.state.selection.$from.node(1).textContent, caretBlock);
  editor.commands.undo();
  assert.equal(
    handedOver(),
    DOCUMENT.replace(
      "Only an admin can add someone,",
      "Only an admin or an owner can add someone,",
    ),
    "undo takes back the developer's words, not Luke's",
  );
});

test("a block the developer changed after the save went out stays theirs when the answer comes back", async () => {
  const { host, handedOver, took } = opened(DOCUMENT);
  await retype(host, "Model an invite as a", "Model an invite as one");
  const sent = handedOver();
  await retype(host, " row.", " row, pending.");
  const merged = sent.replace("1) first", "1) first, by Luke");

  assert.equal(took(sent, merged), merged, "Luke's change taken whole is the next save's base");
  assert.deepEqual(changedLines(merged, handedOver()), [
    "-Model an invite as one `memberships` row.",
    "+Model an invite as one `memberships` row, pending.",
  ]);
});

test("a change Luke made to a block the developer changed after the save went out is left out of the editor and out of the next base", async () => {
  const { host, handedOver, took } = opened(DOCUMENT);
  await retype(host, "Model an invite as a", "Model an invite as one");
  const sent = handedOver();
  await retype(host, " row.", " row, pending.");
  const merged = sent.replace("Model an invite as one", "Model each invite as one");

  const base = took(sent, merged);

  assert.equal(
    base,
    sent,
    "the base keeps what was sent where Luke's change waits for the next save",
  );
  assert.ok(handedOver().includes("Model an invite as one `memberships` row, pending."));
});
