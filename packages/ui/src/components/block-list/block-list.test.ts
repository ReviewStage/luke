// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { BLOCK_LIST_ELEMENT, BlockList, BlockListItem } from "./block-list.js";

/**
 * block-list.test.ts -- a list of blocks is a list a reader finds by its
 * name, its blocks its items in the order they were handed.
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

test("a list of blocks is named, and holds its blocks in order", () => {
  const container = draw(
    createElement(BlockList, {
      as: BLOCK_LIST_ELEMENT.OL,
      label: "Pending",
      children: ["src/invite.ts", "src/session.ts"].map((path) =>
        createElement(BlockListItem, { key: path, children: path }),
      ),
    }),
  );
  const list = container.querySelector('ol[aria-label="Pending"]');
  expect([...(list?.children ?? [])].map((item) => item.textContent)).toEqual([
    "src/invite.ts",
    "src/session.ts",
  ]);
});
