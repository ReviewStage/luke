// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { AttachFilesButton } from "./attach-files-button.js";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

const ignore = () => undefined;

test("a + held from taking files still opens its menu of other rows, only its Attachment dimmed", () => {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      createElement(AttachFilesButton, {
        label: "Add files and more",
        disabled: true,
        onFiles: ignore,
        more: [{ label: "MCP servers", onSelect: ignore }],
      }),
    ),
  );
  const plus =
    container.querySelector<HTMLButtonElement>('button[aria-label="Add files and more"]') ??
    assert.fail("the + stands");
  assert.equal(plus.disabled, false);
  act(() => plus.click());
  const rows = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
  assert.deepEqual(
    rows.map((row) => [row.textContent, row.disabled]),
    [
      ["Attach files", true],
      ["MCP servers", false],
    ],
  );
});
