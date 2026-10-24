/**
 * note-line.test.ts -- a note line is a plain line of words, with no press and
 * no alert; one a reader should hear land is a status, and one that is not
 * says nothing as it lands.
 */

// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test } from "vitest";
import { NOTE_LINE_LOOK, NoteLine } from "../../index.js";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const WORDS = "No shells.";

const roots: Root[] = [];

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** Draws `element` into the page and answers the container it was drawn in. */
function mount(element: React.ReactElement): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  return container;
}

for (const look of Object.values(NOTE_LINE_LOOK)) {
  test(`a ${look} note line announced as a status says its words alone, with no alert or press`, () => {
    const container = mount(createElement(NoteLine, { look, status: true, children: WORDS }));
    const statuses = container.querySelectorAll('[role="status"]');

    expect(statuses).toHaveLength(1);
    expect(statuses[0]?.textContent).toBe(WORDS);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector("button")).toBeNull();
  });
}

test("a note line not announced says its words without a live role", () => {
  const container = mount(createElement(NoteLine, { children: WORDS }));

  expect(container.textContent).toBe(WORDS);
  expect(container.querySelector("[role]")).toBeNull();
});
