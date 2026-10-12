// @vitest-environment jsdom

import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import { DOCUMENT_TEXT } from "#testing/document-plan";
import type { PlanEditorPlacement, PlanEditorProps } from "./contract";
import { mountPlanEditor } from "./plan-editor";

/**
 * The editor as its bundle mounts it: TipTap over a plan's whole text. jsdom
 * lays nothing out, so a click's point is not tested here (the plan
 * document's tests hand one over).
 */

const TEXT = `${DOCUMENT_TEXT}\n`;

const handles: { destroy: () => void }[] = [];

afterEach(() => {
  for (const handle of handles.splice(0)) handle.destroy();
  document.body.innerHTML = "";
});

/** The editor mounted on the text, with every hand-over, finish, and leaving it reported. */
function mounted(placement: PlanEditorPlacement | undefined = undefined, focus = true) {
  const host = document.createElement("div");
  document.body.append(host);
  const drafts: string[] = [];
  const finishes: number[] = [];
  let leftUp = 0;
  const props: PlanEditorProps = {
    markdown: TEXT,
    placement,
    focus,
    label: "Plan",
    className: "markdown plan-unit",
    onDraft: (markdown) => drafts.push(markdown),
    onFinish: (section) => finishes.push(section),
    onLeaveUp: () => {
      leftUp += 1;
    },
  };
  const handle = mountPlanEditor(host, props);
  handles.push(handle);
  const editable = host.querySelector<HTMLElement>("[contenteditable=true]");
  assert.ok(editable, "the editor's words");
  return { handle, editable, drafts, finishes, leftUps: () => leftUp };
}

function press(editable: HTMLElement, key: string, init: KeyboardEventInit = {}): void {
  editable.dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }),
  );
}

test("the text opens as the document draws it: a labelled multi-line text box, each heading in the read view's class and level, nothing handed over yet", () => {
  const { editable, drafts } = mounted();

  assert.equal(editable.getAttribute("role"), "textbox");
  assert.equal(editable.getAttribute("aria-label"), "Plan");
  assert.ok(editable.classList.contains("markdown"));
  assert.deepEqual(
    [...editable.querySelectorAll(".markdown-heading")].map((heading) => [
      heading.textContent,
      heading.getAttribute("data-level"),
    ]),
    [
      ["Context", "1"],
      ["Goal", "2"],
      ["Approach", "2"],
      ["Assumptions", "2"],
    ],
  );
  assert.ok(editable.querySelector("pre")?.textContent?.includes("## Not a section"));
  assert.deepEqual(drafts, []);
});

test("Esc and ⌘↩ finish, each naming the section the caret stands in; opened on a section, the caret stands at its end", () => {
  const { editable, finishes } = mounted({ section: 2 });

  press(editable, "Escape");
  press(editable, "Enter", { metaKey: true });

  assert.deepEqual(finishes, [2, 2]);
});

test("a save's merged answer lays Luke's change in and answers the base and the text the editor holds", () => {
  const { handle } = mounted();
  const merged = TEXT.replace("Invites land by email.", "Invites land by email or link.");

  const taken = handle.take(TEXT, merged);

  assert.deepEqual(taken, { base: merged, text: merged });
});

test("opened by a key or a click it takes the keyboard; drawn by a page, it leaves it where it was", () => {
  const opened = mounted();
  assert.ok(opened.editable.contains(document.activeElement));

  const drawn = mounted(undefined, false);
  assert.ok(!drawn.editable.contains(document.activeElement));
});
