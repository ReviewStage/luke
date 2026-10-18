// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { Prose } from "../../index.js";

/**
 * prose.test.ts -- what a reader of a generated document meets: its own
 * headings at their levels, its links where they lead, its lists' items in
 * order, and its keys and code as the words they are.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const DOCUMENT = [
  "<h3>Fixes</h3>",
  '<p>Fixed in <a href="https://github.com/acme/acme/pull/42">#42</a>.</p>',
  "<ol><li>Open a plan.</li><li>Press <kbd>⌘</kbd><kbd>K</kbd> on <code>budget.ts</code>.</li></ol>",
].join("");

const containers: HTMLElement[] = [];

afterEach(() => {
  for (const container of containers.splice(0)) container.remove();
});

async function render(html: string): Promise<HTMLElement> {
  const container = document.createElement("div");
  document.body.append(container);
  containers.push(container);
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await act(async () => createRoot(container).render(createElement(Prose, { html })));
  return container;
}

test("a document reads as its own headings, links, and list items, in order", async () => {
  const container = await render(DOCUMENT);
  expect(container.querySelector("h3")?.textContent).toBe("Fixes");
  expect(container.querySelector("a")?.getAttribute("href")).toBe(
    "https://github.com/acme/acme/pull/42",
  );
  expect([...container.querySelectorAll("ol > li")].map((item) => item.textContent)).toEqual([
    "Open a plan.",
    "Press ⌘K on budget.ts.",
  ]);
});
