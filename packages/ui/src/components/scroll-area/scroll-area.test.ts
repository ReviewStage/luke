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
  type ScrollAreaProps,
} from "../../index.js";

/**
 * scroll-area.test.ts -- an area is the scroller its caller reaches: the
 * caller's ref, its scroll and key handlers, and its focus land on the
 * area itself, and a tab panel drawn as one is named by its tab and holds
 * what the caller put in it; and its gutter and its fade's inset compute
 * from its sheet as the caller asked.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
  document.head.replaceChildren();
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

/**
 * Lays the area's own sheet into the document. Note that its rules are taken
 * out of their cascade layer, because jsdom drops an `@layer` block whole;
 * nothing else in the document competes with them.
 */
function laySheet(): void {
  const sheet = readFileSync(join(import.meta.dirname, "scroll-area.css"), "utf8");
  const style = document.createElement("style");
  style.textContent = sheet.replace(/@layer components \{([\s\S]*)\}\s*$/, "$1");
  document.head.append(style);
}

/** The style an area drawn with `options` computes to, its sheet laid in. */
function areaStyle(options: Partial<ScrollAreaProps>): CSSStyleDeclaration {
  const area = createRef<HTMLDivElement>();
  render(
    createElement(ScrollArea, {
      ...options,
      ref: area,
      children: createElement("p", null, "A line."),
    }),
  );
  return getComputedStyle(area.current ?? assert.fail("the ref reaches the area"));
}

test("a stable gutter keeps the scroll bar's room while nothing scrolls, and an area that names none keeps it only once it scrolls", () => {
  laySheet();

  assert.equal(areaStyle({ gutter: SCROLL_GUTTER.STABLE }).scrollbarGutter, "stable");
  assert.equal(areaStyle({}).scrollbarGutter, "auto");
});

test("a band inset starts the fade beneath the stuck band, and what the keys reach clears both; an area with none starts both at its edge", () => {
  laySheet();
  const banded = areaStyle({ fade: SCROLL_FADE.BOTH, fadeInset: SCROLL_FADE_INSET.BAND });
  const plain = areaStyle({ fade: SCROLL_FADE.BOTH });

  assert.equal(banded.getPropertyValue("--luke-scroll-area-fade-inset"), "var(--luke-scroll-band)");
  assert.equal(plain.getPropertyValue("--luke-scroll-area-fade-inset"), "");
  assert.equal(
    banded.getPropertyValue("scroll-padding-block-start"),
    "calc(var(--luke-scroll-area-fade-inset) + var(--luke-scroll-fade))",
  );
  assert.match(banded.maskImage, /transparent var\(--luke-scroll-area-fade-inset\)/);
});
