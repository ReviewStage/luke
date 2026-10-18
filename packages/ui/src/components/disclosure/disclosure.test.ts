// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { Disclosure, DisclosureBody, DisclosureFind, DisclosureSummary } from "./disclosure.js";

/**
 * disclosure.test.ts -- a fold draws its body only once its summary is
 * pressed, says whether it is open on the summary, starts open when asked,
 * follows the element's own toggle (a find's), and draws a closed body,
 * still closed, while a find looks through it.
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

function render(element: ReactElement): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  return container;
}

function fold(defaultOpen = false): ReactElement {
  return createElement(Disclosure, {
    defaultOpen,
    children: [
      createElement(DisclosureSummary, { key: "summary", children: "3 tools called" }),
      createElement(DisclosureBody, { key: "body", children: "Read package.json" }),
    ],
  });
}

function summaryOf(container: HTMLElement): HTMLElement {
  return container.querySelector("summary") ?? assert.fail("a summary");
}

test("a closed fold draws its summary alone, and a press opens it and closes it again", () => {
  const container = render(fold());
  const summary = summaryOf(container);
  assert.equal(summary.textContent, "3 tools called");
  assert.equal(summary.getAttribute("aria-expanded"), "false");
  assert.ok(!container.textContent?.includes("Read package.json"));

  act(() => summary.click());
  assert.equal(summary.getAttribute("aria-expanded"), "true");
  assert.ok(container.textContent?.includes("Read package.json"));

  act(() => summary.click());
  assert.equal(summary.getAttribute("aria-expanded"), "false");
  assert.ok(!container.textContent?.includes("Read package.json"));
});

test("a fold asked to start open draws its body from the first frame", () => {
  const container = render(fold(true));
  assert.equal(summaryOf(container).getAttribute("aria-expanded"), "true");
  assert.ok(container.textContent?.includes("Read package.json"));
});

test("the element's own toggle, as a find's reveal opens it, opens the fold", () => {
  const container = render(fold());
  const details = container.querySelector("details") ?? assert.fail("a details");
  act(() => {
    details.open = true;
    details.dispatchEvent(new Event("toggle"));
  });
  assert.equal(summaryOf(container).getAttribute("aria-expanded"), "true");
  assert.ok(container.textContent?.includes("Read package.json"));
});

test("while a find looks through it, a closed fold draws its body for the find and stays closed", () => {
  const container = render(createElement(DisclosureFind, { finding: true, children: fold() }));
  assert.equal(summaryOf(container).getAttribute("aria-expanded"), "false");
  assert.ok(container.textContent?.includes("Read package.json"));
});

function heldFold(open: boolean, heard: boolean[]): ReactElement {
  return createElement(Disclosure, {
    open,
    onOpenChange: (next: boolean) => heard.push(next),
    children: [
      createElement(DisclosureSummary, { key: "summary", children: "Luke · Lines 3–9" }),
      createElement(DisclosureBody, { key: "body", children: "Why these lines" }),
    ],
  });
}

test("a fold its holder keeps tells the holder of a press and stays as the holder says", () => {
  const heard: boolean[] = [];
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(heldFold(false, heard)));
  act(() => summaryOf(container).click());
  assert.deepEqual(heard, [true]);
  assert.equal(summaryOf(container).getAttribute("aria-expanded"), "false");
  assert.ok(!container.textContent?.includes("Why these lines"));

  act(() => root.render(heldFold(true, heard)));
  assert.equal(summaryOf(container).getAttribute("aria-expanded"), "true");
  assert.ok(container.textContent?.includes("Why these lines"));
  act(() => summaryOf(container).click());
  assert.deepEqual(heard, [true, false]);
});
