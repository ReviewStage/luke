// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { Editor, TiptapEditorHTMLElement } from "@tiptap/core";
import { afterEach, beforeEach, test } from "vitest";
import { installEditorLayout } from "../testing/composer.js";
import type { PlanEditorBlocks, PlanEditorHandle } from "./contract.js";
import { mountPlanEditor } from "./plan-editor.js";

/**
 * plan-placeholder.test.ts -- what the plan editor's empty blocks say under
 * the caret: the empty plan its own words, an empty line how to open the `/`
 * menu where one stands over the text, and an empty heading its level's
 * name. Synthetic plan.
 */

/** A `/` menu that takes no key, for an editor that offers one. */
const QUIET_BLOCKS: PlanEditorBlocks = { onTrigger: () => undefined, onKey: () => false };

const editors: PlanEditorHandle[] = [];

beforeEach(installEditorLayout);

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  document.body.innerHTML = "";
});

/** The editor mounted on the text, the `/` menu over it unless `offersBlocks` says not. */
function mounted(markdown: string, offersBlocks = true): Editor {
  const host = document.body.appendChild(document.createElement("div"));
  editors.push(
    mountPlanEditor(host, {
      markdown,
      placement: undefined,
      focus: true,
      label: "Plan",
      className: "markdown plan-unit",
      onDraft: () => undefined,
      onFinish: () => undefined,
      onLeaveUp: () => undefined,
      blocks: offersBlocks ? QUIET_BLOCKS : undefined,
    }),
  );
  const element = host.querySelector<TiptapEditorHTMLElement>(".plan-document-text");
  return element?.editor ?? assert.fail("the editor is running");
}

/** What the empty block under the caret says, where one says anything. */
function said(editor: Editor): string | undefined {
  return editor.view.dom.querySelector(".is-empty")?.getAttribute("data-placeholder") ?? undefined;
}

/** A new empty line after the text's last words, the caret on it. */
function newLine(editor: Editor): void {
  editor
    .chain()
    .focus()
    .setTextSelection(editor.state.doc.content.size - 1)
    .splitBlock()
    .run();
}

test("an empty plan reads Write the plan", () => {
  const editor = mounted("");

  assert.equal(said(editor), "Write the plan");
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
