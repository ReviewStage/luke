// @vitest-environment jsdom

import assert from "node:assert/strict";
import type { TiptapEditorHTMLElement } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";
import { afterEach, beforeEach, test } from "vitest";
import { installEditorLayout } from "../testing/composer.js";
import type { PlanEditorHandle } from "./contract.js";
import { mountPlanEditor } from "./plan-editor.js";

/**
 * diagram-preview.test.ts -- a Mermaid code block in the plan editor stays
 * code, and the panel draws its diagram under it, out of the text: a block
 * in another language has none, the text saves as written, and a change to
 * the block's code asks for its diagram again, handing the code it held
 * before. The panel's drawing stands in as the code's own words. Synthetic
 * plan.
 */

const FLOW = "flowchart LR\n  Invite --> Join";

const TEXT = `## Flow\n\n\`\`\`mermaid\n${FLOW}\n\`\`\`\n\n## Setup\n\n\`\`\`sh\npnpm install\n\`\`\`\n`;

const editors: PlanEditorHandle[] = [];

beforeEach(installEditorLayout);

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  document.body.innerHTML = "";
});

/** The editor mounted on the text, each diagram drawn as the code it was asked for after the code it held before. */
function mounted(markdown: string) {
  const host = document.createElement("div");
  document.body.append(host);
  const handle = mountPlanEditor(host, {
    markdown,
    placement: undefined,
    focus: true,
    label: "Plan",
    className: "markdown plan-unit",
    onDraft: () => undefined,
    onFinish: () => undefined,
    onLeaveUp: () => undefined,
    drawDiagram: (element, diagram) => {
      element.textContent = `${diagram.previous ?? "nothing"} then ${diagram.code}`;
      return () => undefined;
    },
  });
  editors.push(handle);
  const editor = host.querySelector<TiptapEditorHTMLElement>(".plan-document-text")?.editor;
  assert.ok(editor, "the editor is running");
  return { host, handle, editor };
}

/** Each code block in the editor, its code, and what stands right under it. */
function blocks(host: HTMLElement): [string | null, string | null][] {
  return [...host.querySelectorAll("pre")].map((pre) => [
    pre.textContent,
    pre.nextElementSibling?.classList.contains("plan-diagram-preview") === true
      ? pre.nextElementSibling.textContent
      : null,
  ]);
}

test("a Mermaid code block stays code, its diagram drawn under it, and a block in another language has none", () => {
  const { host, handle } = mounted(TEXT);

  assert.deepEqual(blocks(host), [
    [FLOW, `nothing then ${FLOW}`],
    ["pnpm install", null],
  ]);
  const preview = host.querySelector(".plan-diagram-preview");
  assert.equal(preview?.getAttribute("contenteditable"), "false");
  assert.ok(preview?.classList.contains("ph-no-capture"));
  assert.equal(handle.markdown(), TEXT);
});

test("a change to the block's code draws its diagram again, from the code it held before", () => {
  const { host, editor } = mounted(TEXT);
  let end: number | undefined;
  editor.state.doc.descendants((node, position) => {
    if (node.type.name === "codeBlock" && node.attrs.language === "mermaid") {
      end = position + node.nodeSize - 1;
    }
  });
  assert.ok(end !== undefined, "the text holds the Mermaid block");

  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, end)));
  editor.view.dispatch(editor.state.tr.insertText("\n  Join --> Member"));

  const changed = `${FLOW}\n  Join --> Member`;
  assert.deepEqual(blocks(host), [
    [changed, `${FLOW} then ${changed}`],
    ["pnpm install", null],
  ]);
  assert.equal(host.querySelectorAll(".plan-diagram-preview").length, 1);
});
