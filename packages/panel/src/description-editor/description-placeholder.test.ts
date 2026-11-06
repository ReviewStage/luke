// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { Editor, TiptapEditorHTMLElement } from "@tiptap/core";
import { afterEach, beforeEach, test } from "vitest";
import { installEditorLayout } from "../testing/composer.js";
import type { DescriptionEditorBlocks, DescriptionEditorHandle } from "./contract.js";
import { mountDescriptionEditor } from "./description-editor.js";

const QUIET_BLOCKS: DescriptionEditorBlocks = { onTrigger: () => undefined, onKey: () => false };

const editors: DescriptionEditorHandle[] = [];

beforeEach(installEditorLayout);

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  document.body.innerHTML = "";
});

function mounted(markdown: string, offersBlocks = true): Editor {
  const host = document.body.appendChild(document.createElement("div"));
  editors.push(
    mountDescriptionEditor(host, {
      markdown,
      placement: undefined,
      focus: true,
      label: "Description",
      className: "markdown description-unit",
      onDraft: () => undefined,
      onFinish: () => undefined,
      onLeaveUp: () => undefined,
      blocks: offersBlocks ? QUIET_BLOCKS : undefined,
    }),
  );
  const element = host.querySelector<TiptapEditorHTMLElement>(".description-document-text");
  return element?.editor ?? assert.fail("the editor is running");
}

function said(editor: Editor): string | undefined {
  return editor.view.dom.querySelector(".is-empty")?.getAttribute("data-placeholder") ?? undefined;
}

function newLine(editor: Editor): void {
  editor
    .chain()
    .focus()
    .setTextSelection(editor.state.doc.content.size - 1)
    .splitBlock()
    .run();
}

test("an empty description reads Write the description", () => {
  const editor = mounted("");

  assert.equal(said(editor), "Write the description");
});

test("an empty line under the caret says how to open the `/` menu", () => {
  const editor = mounted("## Goal\n\nShip it.\n");

  newLine(editor);

  assert.equal(said(editor), "Write, or press / for blocks");
});

test("an empty line says nothing where no `/` menu stands over the text", () => {
  const editor = mounted("## Goal\n\nShip it.\n", false);

  newLine(editor);

  assert.equal(said(editor) ?? "", "");
});

test("an empty heading reads its level's name", () => {
  const editor = mounted("## Goal\n\nShip it.\n");

  newLine(editor);
  editor.commands.setHeading({ level: 2 });
  assert.equal(said(editor), "Heading 2");

  editor.commands.setHeading({ level: 3 });
  assert.equal(said(editor), "Heading 3");
});
