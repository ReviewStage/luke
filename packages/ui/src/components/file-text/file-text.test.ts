// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { FILE_TEXT_EXTENT, FileText } from "./file-text.js";

/**
 * file-text.test.ts -- the file's words reach the page exactly as written,
 * a region named for a reader; the whole takes the keyboard to scroll, a peek does not.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

/** Draws `element` on the page and hands back what it was drawn into. */
function draw(element: React.ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  return container;
}

const SKILL = "---\nname: grill-me\n---\n\n# Grill me\n\n  Ask one question at a time.\n";

test("the whole file reads exactly as written, as a named region the keyboard can scroll", () => {
  draw(createElement(FileText, { text: SKILL, label: "grill-me's SKILL.md" }));
  const region = document.querySelector<HTMLElement>("section");
  expect(region?.getAttribute("aria-label")).toBe("grill-me's SKILL.md");
  expect(region?.textContent).toBe(SKILL);
  expect(region?.tabIndex).toBe(0);
});

test("a peek keeps the words and its name but takes no place in the Tab order", () => {
  const container = draw(
    createElement(FileText, {
      text: SKILL,
      label: "Pasted text",
      extent: FILE_TEXT_EXTENT.PEEK,
    }),
  );
  expect(container.textContent).toBe(SKILL);
  expect(document.querySelector("section")?.getAttribute("aria-label")).toBe("Pasted text");
  expect(container.querySelector("[tabindex]")).toBeNull();
});
