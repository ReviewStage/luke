// @vitest-environment jsdom

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "vitest";
import { installEditorLayout } from "#testing/composer";
import { mountComposer } from "./composer-editor";
import { mountPlanEditor } from "./plan-editor";

/**
 * inline-style.test.ts -- neither editor of the bundle writes a `<style>`
 * element into the page, which the panel's policy (`style-src 'self'`,
 * `../index.html`) refuses and the console reports as an error each time.
 * Synthetic text.
 */

/** Every editor mounted, taken down after each test. */
const mounted: { destroy: () => void }[] = [];

beforeEach(installEditorLayout);

afterEach(() => {
  for (const editor of mounted.splice(0)) editor.destroy();
  for (const style of document.querySelectorAll("style")) style.remove();
  document.body.innerHTML = "";
});

/** A fresh element in the page to mount an editor on. */
function host(): HTMLElement {
  const element = document.createElement("div");
  document.body.append(element);
  return element;
}

test("the plan editor writes no inline style element into the page", () => {
  mounted.push(
    mountPlanEditor(host(), {
      markdown: "## Goal\n\nShip the invite flow.\n",
      placement: undefined,
      focus: true,
      label: "Plan",
      className: "markdown plan-unit",
      onDraft: () => undefined,
      onFinish: () => undefined,
      onLeaveUp: () => undefined,
    }),
  );

  assert.equal(document.querySelectorAll("style").length, 0);
});

test("the message box writes no inline style element into the page", () => {
  mounted.push(
    mountComposer(host(), {
      text: "Cut the release",
      skills: new Set(),
      maxLength: 16_000,
      label: "Message to the agent",
      className: "agent-composer-input",
      focus: true,
      onDraft: () => undefined,
      onKey: () => false,
      onEnter: () => undefined,
      onPasteFiles: () => false,
      onTrigger: () => undefined,
      drawChip: () => () => undefined,
    }),
  );

  assert.equal(document.querySelectorAll("style").length, 0);
});
