// @vitest-environment jsdom

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "vitest";
import { installEditorLayout } from "../testing/composer.js";
import { mountComposer } from "./composer-editor.js";
import { mountDescriptionEditor } from "./description-editor.js";

const mounted: { destroy: () => void }[] = [];

beforeEach(installEditorLayout);

afterEach(() => {
  for (const editor of mounted.splice(0)) editor.destroy();
  for (const style of document.querySelectorAll("style")) style.remove();
  document.body.innerHTML = "";
});

function host(): HTMLElement {
  const element = document.createElement("div");
  document.body.append(element);
  return element;
}

test("the description editor writes no inline style element into the page", () => {
  mounted.push(
    mountDescriptionEditor(host(), {
      markdown: "## Goal\n\nShip the invite flow.\n",
      placement: undefined,
      focus: true,
      label: "Description",
      className: "markdown description-unit",
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
