// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { Fact, Facts } from "./facts.js";

/**
 * facts.test.ts -- each fact reads as a term and its definition, in the
 * order they were handed.
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

test("each fact is a term and its definition", () => {
  const container = draw(
    createElement(Facts, {
      ruled: true,
      children: [
        createElement(Fact, { key: "used", label: "Used", children: "41%" }),
        createElement(Fact, { key: "left", label: "Left", children: "~118k" }),
      ],
    }),
  );
  const read = [...container.querySelectorAll("dt")].map((term) => [
    term.textContent,
    term.nextElementSibling?.tagName === "DD" ? term.nextElementSibling.textContent : undefined,
  ]);
  expect(read).toEqual([
    ["Used", "41%"],
    ["Left", "~118k"],
  ]);
});
