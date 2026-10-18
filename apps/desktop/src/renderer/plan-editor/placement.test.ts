// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  PLACEMENT_END,
  type PlanEditorHandle,
  type PlanEditorPlacement,
} from "@luke/panel/plan-editor/contract";
import { afterEach, beforeEach, test } from "vitest";
import { installEditorLayout } from "#testing/composer";
import { mountPlanEditor } from "./plan-editor";

/**
 * placement.test.ts -- where the plan editor's caret stands as it opens and
 * as a press on its text's room moves it: the end of the text, or the end
 * of a section, read back as the section Esc names. And what an empty text
 * says until a word is typed. Synthetic text.
 */

const TEXT = "## Goal\n\nShip the invite flow.\n\n## Risks\n\nEmail may bounce.\n";

/** Every editor mounted, taken down after each test. */
const mounted: PlanEditorHandle[] = [];

beforeEach(installEditorLayout);

afterEach(() => {
  for (const editor of mounted.splice(0)) editor.destroy();
  document.body.innerHTML = "";
});

/** The editor mounted on `markdown` with its caret where `placement` says, and each section Esc named, in order. */
function mount(markdown: string, placement: PlanEditorPlacement | undefined, placeholder?: string) {
  const host = document.body.appendChild(document.createElement("div"));
  const finished: number[] = [];
  const handle = mountPlanEditor(host, {
    markdown,
    placement,
    focus: true,
    label: "Plan",
    placeholder,
    className: "markdown plan-unit",
    onDraft: () => undefined,
    onFinish: (section) => finished.push(section),
    onLeaveUp: () => undefined,
  });
  mounted.push(handle);
  const element = host.querySelector<HTMLElement>("[role=textbox]") ?? assert.fail("the editor");
  return { finished, handle, element };
}

/** Esc in the editor, which names the section the caret stands in. */
function pressEscape(element: HTMLElement): void {
  element.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
}

test("an editor opened at the text's end stands its caret in the last section, and a press on its room moves the caret", () => {
  const { finished, handle, element } = mount(TEXT, PLACEMENT_END);
  pressEscape(element);
  handle.focusAt({ section: 0 });
  pressEscape(element);
  handle.focusAt(PLACEMENT_END);
  pressEscape(element);

  assert.deepEqual(finished, [1, 0, 1]);
  assert.equal(document.activeElement, element, "the editor keeps the keyboard");
});

test("an empty text says the placeholder it was given, and the plan's own without one", () => {
  const given = mount("", PLACEMENT_END, "Add a description…");
  const plan = mount("", undefined);

  assert.equal(
    given.element.querySelector("p")?.getAttribute("data-placeholder"),
    "Add a description…",
  );
  assert.equal(plan.element.querySelector("p")?.getAttribute("data-placeholder"), "Write the plan");
});
