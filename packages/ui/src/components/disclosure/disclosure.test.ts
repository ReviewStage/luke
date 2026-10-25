// @vitest-environment jsdom

import assert from "node:assert/strict";
import { act, createElement, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import {
  DISCLOSURE_BODY,
  DISCLOSURE_FILL,
  DISCLOSURE_LOOK,
  DISCLOSURE_SUMMARY,
  Disclosure,
  DisclosureBody,
  DisclosureChevron,
  DisclosureFind,
  DisclosureFrame,
  DisclosureSummary,
} from "./disclosure.js";

/**
 * disclosure.test.ts -- a fold draws its body only once its summary is
 * pressed, says whether it is open on the summary, starts open when asked,
 * follows the element's own toggle (a find's), and draws a closed body,
 * still closed, while a find looks through it; a control its head holds
 * stands beside its summary, never in it, and is pressed without folding
 * it, while the row's bare ground beside it folds; and a card's head
 * draws its body only once a press opens it.
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

/** A fold whose head holds a ⋯ and a box beside its summary, and a menu the ⋯ draws elsewhere. */
function foldWithActions(pressed: string[], menuHost: HTMLElement): ReactElement {
  return createElement(Disclosure, {
    actions: createElement(
      "span",
      { className: "ground" },
      createElement(
        "button",
        { type: "button", className: "more", onClick: () => pressed.push("more") },
        "⋯",
      ),
      createElement("input", { type: "checkbox", className: "box", "aria-label": "Viewed" }),
      createPortal(
        createElement(
          "button",
          { type: "button", className: "item", onClick: () => pressed.push("item") },
          "Copy link",
        ),
        menuHost,
      ),
    ),
    children: [
      createElement(DisclosureSummary, {
        key: "summary",
        children: createElement("span", { className: "words" }, "Review thread"),
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

/** What takes a press or the focus of its own. */
const CONTROL = "a[href], button, input, select, textarea, [role='button'], [tabindex]";

test("a head's controls stand beside its summary, which its own words alone name, open or closed", () => {
  const container = drawWithActions([]);
  const summary = summaryOf(container);
  assert.equal(summary.querySelector(CONTROL), null, "no control stands in the summary");
  assert.equal(summary.textContent, "Review thread");
  const more = find(".more");
  assert.equal(summary.contains(more), false);
  assert.equal(container.querySelector("details")?.contains(more), false, "nor in the fold");
  assert.ok(more.isConnected, "drawn while the fold is closed");
  assert.equal(
    summary.compareDocumentPosition(more) & Node.DOCUMENT_POSITION_FOLLOWING,
    Node.DOCUMENT_POSITION_FOLLOWING,
    "after the summary, where the keyboard reaches it next",
  );
  more.focus();
  assert.equal(document.activeElement, more, "the keyboard reaches it");
});

test("a press on a control beside the summary acts on the control and leaves the fold as it stood", () => {
  const pressed: string[] = [];
  const container = drawWithActions(pressed);
  act(() => find(".more").click());
  assert.deepEqual(pressed, ["more"]);
  assert.equal(summaryOf(container).getAttribute("aria-expanded"), "false");
  assert.ok(!container.textContent?.includes("The thread's comments"));

  act(() => find(".words").click());
  assert.equal(summaryOf(container).getAttribute("aria-expanded"), "true", "the words still fold");
  act(() => find(".more").click());
  assert.equal(summaryOf(container).getAttribute("aria-expanded"), "true", "and open stays open");
});

test("a press inside a menu a control beside the summary drew elsewhere leaves the fold as it stood", () => {
  const pressed: string[] = [];
  const container = drawWithActions(pressed);
  act(() => find(".item").click());
  assert.deepEqual(pressed, ["item"]);
  assert.equal(summaryOf(container).getAttribute("aria-expanded"), "false");
});

test("a box beside the summary still checks, and a press on the row's bare ground beside it folds", () => {
  const container = drawWithActions([]);
  const box = find<HTMLInputElement>(".box");
  act(() => box.click());
  assert.equal(box.checked, true);
  assert.equal(summaryOf(container).getAttribute("aria-expanded"), "false");
  act(() => find(".ground").click());
  assert.equal(summaryOf(container).getAttribute("aria-expanded"), "true");
});

test("a lead stands before the summary, and a press on the row reaches its holder", () => {
  const stood: string[] = [];
  const container = render(
    createElement(Disclosure, {
      look: DISCLOSURE_LOOK.CARD,
      lead: createElement("button", { type: "button", className: "fold" }, "Fold"),
      fill: DISCLOSURE_FILL.ACTIONS,
      children: createElement(DisclosureSummary, { look: DISCLOSURE_SUMMARY.HEAD, children: "M" }),
    }),
  );
  const lead = find(".fold");
  assert.equal(
    lead.compareDocumentPosition(summaryOf(container)) & Node.DOCUMENT_POSITION_FOLLOWING,
    Node.DOCUMENT_POSITION_FOLLOWING,
  );

  const held = render(
    createElement(DisclosureFrame, {
      actions: createElement("button", { type: "button", className: "copy" }, "Copy path"),
      onPointerDown: () => stood.push("row"),
      children: createElement(Disclosure, {
        children: createElement(DisclosureSummary, { children: "src/seats.ts" }),
      }),
    }),
  );
  const copy = held.querySelector<HTMLElement>(".copy") ?? assert.fail("a copy");
  act(() => copy.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
  act(() => summaryOf(held).dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
  assert.deepEqual(stood, ["row", "row"]);
  assert.equal(summaryOf(held).querySelector(CONTROL), null);
});

test("a row summary stays out of the tab order, and folds on a press", () => {
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
  assert.equal(summary.tabIndex, -1);
  assert.equal(summary.getAttribute("aria-expanded"), "true");
  act(() => summary.click());
  assert.equal(summary.getAttribute("aria-expanded"), "false");
});

test("a card's head draws its body only once a press opens it", () => {
  const root = render(
    createElement(Disclosure, {
      look: DISCLOSURE_LOOK.CARD,
      "aria-label": "To-dos",
      children: [
        createElement(DisclosureSummary, {
          key: "head",
          look: DISCLOSURE_SUMMARY.HEAD,
          children: [
            createElement("span", { key: "words" }, "2 of 5 done"),
            createElement(DisclosureChevron, { key: "chevron" }),
          ],
        }),
        createElement(DisclosureBody, {
          key: "body",
          inset: DISCLOSURE_BODY.CARD,
          children: "Write the failing test",
        }),
      ],
    }),
  );
  const card = root.querySelector("[aria-label='To-dos']") ?? assert.fail("the card stands");
  const summary = card.querySelector("summary") ?? assert.fail("the head stands");
  assert.equal(card.textContent, "2 of 5 done");
  act(() => summary.click());
  assert.equal(summary.getAttribute("aria-expanded"), "true");
  assert.equal(card.textContent, "2 of 5 doneWrite the failing test");
});
