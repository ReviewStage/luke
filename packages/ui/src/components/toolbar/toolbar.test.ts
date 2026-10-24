// @vitest-environment jsdom

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { NOT_FOUND_THING, NotFound, TOOLBAR_INSET, Toolbar, type ToolbarProps } from "./toolbar.js";

/**
 * toolbar.test.ts -- a workspace's bar reads its lead, its title as the
 * page's heading, the tag after it, and its actions, in that order, drawing
 * only the slots that say something, and its actions end it even with no
 * title; each edge stands at the inset it is named; and a place that is not found keeps its bar above the words
 * saying so. jsdom lays nothing out and drops a layer whole, so the sheet
 * is laid out of its layer and a length is read as it declares it.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.head.replaceChildren();
  document.body.replaceChildren();
  document.documentElement.removeAttribute("data-luke-profile");
});

/** Draws `element` into the page and answers the box it stands in. */
function draw(element: React.ReactElement): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  return container;
}

/** Draws a bar holding `props` and answers its banner. */
function bar(props: ToolbarProps): HTMLElement {
  return draw(createElement(Toolbar, props)).querySelector("header") ?? assert.fail("no bar");
}

/** The text of each of the bar's own parts, in the order they stand. */
function parts(banner: HTMLElement): string[] {
  return [...banner.children].map((part) => part.textContent ?? "");
}

/** The sheets a bar's lengths are built from, in the order the page lays them: the scale, the profiles' roles, then the bar's own. */
const SHEETS = ["../../tokens/scale.css", "../../tokens/profiles.css", "./toolbar.css"] as const;

/** The scale, the roles, and the bar's sheet laid under the desktop's profile, each layer opened so jsdom keeps its rules. */
function laySheets(): void {
  document.documentElement.setAttribute("data-luke-profile", "desktop");
  for (const path of SHEETS) {
    const css = readFileSync(new URL(path, import.meta.url), "utf8");
    const style = document.head.appendChild(document.createElement("style"));
    style.textContent = css.replace(/@layer [a-z-]+ \{([\s\S]*)\}\s*$/, "$1");
  }
}

/** A length in pixels as `element` declares `value`: every custom property spelled out, then a sum of pixel terms. */
function pixels(element: Element, value: string): number {
  const style = getComputedStyle(element);
  let text = value;
  for (let depth = 0; depth < 16 && text.includes("var("); depth += 1) {
    text = text.replace(/var\((--[\w-]+)\)/g, (_, name: string) =>
      style.getPropertyValue(name).trim(),
    );
  }
  const terms = text
    .replace(/calc\(|\)|px/g, " ")
    .trim()
    .split(/\s+/);
  let sum = 0;
  let sign = 1;
  for (const term of terms) {
    if (term === "+" || term === "-") {
      sign = term === "+" ? 1 : -1;
      continue;
    }
    assert.match(term, /^-?[\d.]+$/, text);
    sum += sign * Number(term);
  }
  return sum;
}

/**
 * The last `property` the rules reaching `element` declare, in the order
 * they are laid. Note that it is read off the rules, because jsdom keeps a
 * shorthand that names a custom property only as its rule's text.
 */
function declared(element: Element, property: string): string {
  let value = "";
  for (const sheet of document.styleSheets) {
    for (const rule of sheet.cssRules) {
      if (!(rule instanceof CSSStyleRule) || !element.matches(rule.selectorText)) continue;
      value = rule.style.getPropertyValue(property).trim() || value;
    }
  }
  return value;
}

/** Where the bar's first and last things stand in from its edges, as its sheet declares them. */
function insets(banner: HTMLElement): { start: number; end: number } {
  const padding = declared(banner, "padding");
  const sides = padding.match(/calc\([^()]*(?:\([^()]*\)[^()]*)*\)|var\([^()]*\)|\S+/g);
  assert.equal(sides?.length, 4, padding);
  return { start: pixels(banner, sides?.[3] ?? ""), end: pixels(banner, sides?.[1] ?? "") };
}

test("the bar reads its lead, its title, the tag after it, and its actions, in that order", () => {
  const banner = bar({
    lead: createElement("span", null, "Back"),
    title: "New thread",
    tag: createElement("span", null, "Experiment"),
    actions: createElement("span", null, "Discard"),
  });

  assert.deepEqual(parts(banner), ["Back", "New threadExperiment", "Discard"]);
  const heading = banner.querySelector("h1") ?? assert.fail("no heading");
  assert.equal(heading.textContent, "New thread");
});

test("a bar draws only the slots that say something, and its actions end it with no title", () => {
  const banner = bar({
    lead: false,
    title: "",
    tag: null,
    actions: createElement("span", null, "New"),
  });

  assert.deepEqual(parts(banner), ["", "New"]);
  assert.equal(banner.querySelector("h1"), null);
  assert.equal(banner.lastElementChild?.textContent, "New");
});

test("a title that is more than words stands in the title's place as given", () => {
  const banner = bar({
    title: createElement("input", { "aria-label": "Name", defaultValue: "Inbox" }),
  });

  assert.equal(banner.querySelector("h1"), null);
  assert.equal(banner.querySelector<HTMLInputElement>("input[aria-label='Name']")?.value, "Inbox");
});

test("an edge named for the column's own edge stands nearer it than one named for its words", () => {
  laySheets();
  const page = insets(bar({ title: "Automations" }));
  const column = insets(bar({ start: TOOLBAR_INSET.COLUMN, end: TOOLBAR_INSET.COLUMN }));
  const mixed = insets(bar({ start: TOOLBAR_INSET.COLUMN, end: TOOLBAR_INSET.PAGE }));

  assert.equal(page.start, page.end);
  assert.ok(column.start > 0, JSON.stringify(column));
  assert.ok(column.start < page.start, JSON.stringify({ page, column }));
  assert.equal(column.end, column.start);
  assert.deepEqual(mixed, { start: column.start, end: page.end });
});

test("a place not found keeps its bar, its way back pressable, above the words saying so", () => {
  let backed = false;
  const region = draw(
    createElement(NotFound, {
      thing: NOT_FOUND_THING.AUTOMATION,
      bar: {
        lead: createElement(
          "button",
          { type: "button", onClick: () => (backed = true) },
          "Automations",
        ),
      },
    }),
  );
  const page = region.querySelector("section") ?? assert.fail("no page");
  const banner = page.firstElementChild;

  assert.equal(banner?.tagName, "HEADER");
  assert.match(page.textContent ?? "", /Not found/);
  assert.match(
    page.textContent ?? "",
    /This automation doesn't exist, or you don't have access to it\./,
  );
  const way = banner?.querySelector("button") ?? assert.fail("no way back");
  act(() => way.click());
  assert.ok(backed);
});

test("a not-found state under a bar already drawn draws no second bar", () => {
  const region = draw(createElement(NotFound, { thing: NOT_FOUND_THING.TASK }));

  assert.equal(region.querySelector("header"), null);
  assert.match(region.textContent ?? "", /This task doesn't exist/);
});
