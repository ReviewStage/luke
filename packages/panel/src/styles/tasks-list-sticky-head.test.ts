// @vitest-environment jsdom

import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import { layContainersAt } from "../testing/container-width.js";

/**
 * tasks-list-sticky-head.test.ts -- a Tasks List group's head sticks flush
 * under the window's toolbar while its rows scroll beneath it, with no rule
 * under its band. A sticky box sticks inside its scroller's padding, so a
 * gap the page opens under the toolbar on its scroller would leave the rows
 * showing above a stuck head; the gap is the content's. jsdom lays nothing
 * out, so the sheets are laid (`testing/container-width.ts`) and the page
 * is built in the markup `CollectionPage` and `tasks-list.tsx` draw.
 */

let laid: HTMLStyleElement | undefined;

afterEach(() => {
  laid?.remove();
  laid = undefined;
  document.body.replaceChildren();
});

/** The `border-bottom` the rules matching `element` declare, the later rule's winning; jsdom computes no shorthand drawn in a token. */
function declaredBorderBottom(element: Element): string {
  const walk = (rules: CSSRuleList): CSSStyleRule[] =>
    [...rules].flatMap((rule) => {
      if (rule instanceof CSSStyleRule) return [rule];
      return rule instanceof CSSGroupingRule ? walk(rule.cssRules) : [];
    });
  let border = "";
  for (const rule of [...document.styleSheets].flatMap((sheet) => walk(sheet.cssRules))) {
    const declared = rule.style.getPropertyValue("border-bottom");
    if (declared !== "" && element.matches(rule.selectorText)) border = declared;
  }
  return border;
}

/** An element of the class given, appended to the parent given. */
function child(parent: HTMLElement, tag: string, className: string): HTMLElement {
  const element = parent.appendChild(document.createElement(tag));
  element.className = className;
  return element;
}

/** The List under the toolbar with no filters, answering its scroller, its content, and a group's head. */
function list() {
  laid = layContainersAt({});
  const page = child(document.body, "section", "luke-collection-page");
  page.dataset.frame = "toolbar";
  page.dataset.width = "full";
  child(page, "header", "desktop-toolbar");
  const scroll = child(page, "div", "luke-collection-page-scroll");
  const content = child(scroll, "div", "luke-collection-page-content");
  const group = child(child(content, "div", "tasks-list"), "section", "tasks-list-group");
  const head = child(group, "h2", "tasks-list-head");
  return { scroll, content, head };
}

test("a group's head sticks at the very top of the scroller, the gap under the toolbar opening inside the content", () => {
  const { scroll, content, head } = list();
  assert.equal(getComputedStyle(head).position, "sticky");
  assert.equal(getComputedStyle(head).top, "0px");
  assert.equal(Number.parseFloat(getComputedStyle(scroll).paddingTop), 0);
  assert.equal(getComputedStyle(content).paddingTop, "var(--luke-section-gap)");
});

test("a group's head draws no rule under its band", () => {
  const { head } = list();
  assert.equal(declaredBorderBottom(head), "");
});
