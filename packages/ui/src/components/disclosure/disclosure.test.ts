// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import {
  DISCLOSURE_SUMMARY,
  Disclosure,
  DisclosureAction,
  DisclosureBody,
  DisclosureFind,
  DisclosureSummary,
} from "./disclosure.js";

/**
 * disclosure.test.ts -- a fold draws its body only once its summary is
 * pressed, says whether it is open on the summary, starts open when asked,
 * follows the element's own toggle (a find's), and draws a closed body,
 * still closed, while a find looks through it; and a control in its
 * summary's action slot is pressed without folding it.
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

/** A fold whose summary holds a ⋯ and a box in its action slot, and a menu the ⋯ draws elsewhere. */
function foldWithActions(pressed: string[], menuHost: HTMLElement): ReactElement {
  return createElement(Disclosure, {
    children: [
      createElement(DisclosureSummary, {
        key: "summary",
        children: [
          createElement("span", { key: "words", className: "words" }, "Review thread"),
          createElement(DisclosureAction, {
            key: "action",
            children: createElement(
              "span",
              { className: "ground" },
              createElement(
                "button",
                { type: "button", className: "more", onClick: () => pressed.push("more") },
                "⋯",
              ),
              createElement("input", {
                type: "checkbox",
                className: "box",
                "aria-label": "Viewed",
              }),
              createPortal(
                createElement(
                  "button",
                  { type: "button", className: "item", onClick: () => pressed.push("item") },
                  "Copy link",
                ),
                menuHost,
              ),
            ),
          }),
        ],
      }),
      createElement(DisclosureBody, { key: "body", children: "The thread's comments" }),
    ],
  });
}

function drawWithActions(pressed: string[]): HTMLElement {
  const menuHost = document.body.appendChild(document.createElement("div"));
  const container = render(foldWithActions(pressed, menuHost));
  return container;
}

function find<T extends HTMLElement>(selector: string): T {
  return document.querySelector<T>(selector) ?? assert.fail(selector);
}

test("a press on a control in the summary's action slot acts on the control and leaves the fold as it stood", () => {
  const pressed: string[] = [];
  const container = drawWithActions(pressed);
  act(() => find(".more").click());
  assert.deepEqual(pressed, ["more"]);
  assert.equal(summaryOf(container).getAttribute("aria-expanded"), "false");
  assert.ok(!container.textContent?.includes("The thread's comments"));

  act(() => find(".words").click());
  assert.equal(summaryOf(container).getAttribute("aria-expanded"), "true", "the words still fold");
});

test("a press inside a menu the slot's control drew elsewhere leaves the fold as it stood", () => {
  const pressed: string[] = [];
  const container = drawWithActions(pressed);
  act(() => find(".item").click());
  assert.deepEqual(pressed, ["item"]);
  assert.equal(summaryOf(container).getAttribute("aria-expanded"), "false");
});

test("a box in the slot still checks, and a press on the slot's bare ground folds nothing", () => {
  const container = drawWithActions([]);
  const box = find<HTMLInputElement>(".box");
  act(() => box.click());
  assert.equal(box.checked, true);
  const ground = new MouseEvent("click", { bubbles: true, cancelable: true });
  act(() => find(".ground").dispatchEvent(ground));
  assert.equal(ground.defaultPrevented, true, "the element's own toggle is stopped too");
  assert.equal(summaryOf(container).getAttribute("aria-expanded"), "false");
});

test("a row summary draws no chevron of its own, stays out of the tab order, and folds on a press", () => {
  const root = render(
    createElement(Disclosure, {
      defaultOpen: true,
      children: createElement(DisclosureSummary, {
        look: DISCLOSURE_SUMMARY.ROW,
        children: createElement("span", null, "src/seats.ts"),
      }),
    }),
  );
  const summary = root.querySelector("summary") ?? assert.fail("the summary stands");
  assert.equal(summary.querySelector(".luke-disclosure-turn"), null);
  assert.equal(summary.tabIndex, -1);
  assert.equal(summary.getAttribute("aria-expanded"), "true");
  act(() => summary.click());
  assert.equal(summary.getAttribute("aria-expanded"), "false");
});
