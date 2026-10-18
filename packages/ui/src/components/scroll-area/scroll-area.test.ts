// @vitest-environment jsdom

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, createElement, createRef, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import {
  SCROLL_FADE,
  SCROLL_FADE_INSET,
  SCROLL_GUTTER,
  SCROLL_SIZE,
  ScrollArea,
} from "../../index.js";

/**
 * scroll-area.test.ts -- an area is the scroller its caller reaches: the
 * caller's ref, its scroll and key handlers, and its focus land on the
 * area itself, and a tab panel drawn as one is named by its tab and holds
 * what the caller put in it; and every value of an option past its default
 * is drawn by the area's sheet.
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

function render(element: ReactElement): void {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
}

test("the caller's ref, scroll handler, and keys reach the area that scrolls", () => {
  const area = createRef<HTMLDivElement>();
  const scrolledTo: number[] = [];
  const keys: string[] = [];
  render(
    createElement(ScrollArea, {
      ref: area,
      tabIndex: -1,
      fade: SCROLL_FADE.START,
      onScroll: (event) => scrolledTo.push(event.currentTarget.scrollTop),
      onKeyDown: (event) => keys.push(event.key),
      children: createElement("p", null, "A long description."),
    }),
  );
  const scroller = area.current ?? assert.fail("the ref reaches the area");
  assert.equal(scroller.textContent, "A long description.");

  act(() => {
    scroller.scrollTop = 120;
    scroller.dispatchEvent(new Event("scroll"));
  });
  act(() => scroller.focus());
  act(() => {
    scroller.dispatchEvent(new KeyboardEvent("keydown", { key: "PageDown", bubbles: true }));
  });

  assert.deepEqual(scrolledTo, [120]);
  assert.equal(document.activeElement, scroller);
  assert.deepEqual(keys, ["PageDown"]);
});

test("an area drawn as a tab panel is named by its tab and holds the caller's element", () => {
  render(
    createElement(
      "div",
      null,
      createElement(
        "button",
        { type: "button", id: "inbox-tab", role: "tab", "aria-controls": "inbox" },
        "Mine",
      ),
      createElement(ScrollArea, {
        id: "inbox",
        role: "tabpanel",
        "aria-labelledby": "inbox-tab",
        size: SCROLL_SIZE.CONTENT,
        children: createElement(
          "ul",
          { "aria-label": "Items" },
          createElement("li", null, "Review #42"),
        ),
      }),
    ),
  );
  const panel = document.querySelector('[role="tabpanel"]') ?? assert.fail("the panel is drawn");

  assert.equal(
    document.getElementById(panel.getAttribute("aria-labelledby") ?? "")?.textContent,
    "Mine",
  );
  assert.equal(panel.querySelector('ul[aria-label="Items"]')?.textContent, "Review #42");
});

/** The selectors of `scroll-area.css`'s rules, comments dropped, read as the sheet is written. */
function sheetSelectors(): string[] {
  const sheet = readFileSync(join(import.meta.dirname, "scroll-area.css"), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );
  return [...sheet.matchAll(/([^{};]+)\{/g)].map(([, selector = ""]) => selector.trim());
}

test("every value of an area's fade inset and gutter but the default is drawn by a rule of its own", () => {
  const options = [
    { prop: "fadeInset", values: SCROLL_FADE_INSET, initial: SCROLL_FADE_INSET.NONE },
    { prop: "gutter", values: SCROLL_GUTTER, initial: SCROLL_GUTTER.AUTO },
  ] as const;
  const selectors = sheetSelectors();
  const undrawn: string[] = [];
  for (const { prop, values, initial } of options) {
    for (const value of Object.values(values)) {
      if (value === initial) continue;
      const area = createRef<HTMLDivElement>();
      render(
        createElement(ScrollArea, {
          ref: area,
          [prop]: value,
          children: createElement("p", null, "A line."),
        }),
      );
      const scroller = area.current ?? assert.fail("the ref reaches the area");
      const worn = [...scroller.attributes].find(
        (attribute) => attribute.name.startsWith("data-") && attribute.value === value,
      );
      const rule = worn === undefined ? undefined : `.luke-scroll-area[${worn.name}="${value}"]`;
      if (rule === undefined || !selectors.some((selector) => selector.includes(rule))) {
        undrawn.push(`${prop}: ${value}`);
      }
    }
  }
  assert.deepEqual(undrawn, []);
});
