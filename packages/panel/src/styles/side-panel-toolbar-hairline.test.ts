// @vitest-environment jsdom

import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import { layContainersAt } from "../testing/container-width.js";

/**
 * side-panel-toolbar-hairline.test.ts -- the toolbar's hairline running past
 * both its sides (shell.css's `.desktop-toolbar::before`) is the work
 * column's alone: from a bar inside the side panel, an Inbox item's, it
 * would run on across the column's transcript at that bar's height. jsdom
 * computes no pseudo-element, so the `::before` rules laid that match the
 * bar are read, the later rule's winning.
 */

let laid: HTMLStyleElement | undefined;

afterEach(() => {
  laid?.remove();
  laid = undefined;
  document.body.replaceChildren();
});

/** Every style rule laid in the document, those inside a block included. */
function styleRules(): CSSStyleRule[] {
  const walk = (rules: CSSRuleList): CSSStyleRule[] =>
    [...rules].flatMap((rule) => {
      if (rule instanceof CSSStyleRule) return [rule];
      return rule instanceof CSSGroupingRule ? walk(rule.cssRules) : [];
    });
  return [...document.styleSheets].flatMap((sheet) => walk(sheet.cssRules));
}

/** The `content` the `::before` rules matching `element` leave it, the later rule's winning. */
function beforeContent(element: Element): string | undefined {
  let content: string | undefined;
  for (const rule of styleRules()) {
    const matching = rule.selectorText
      .split(",")
      .map((part) => part.trim())
      .some((part) => part.endsWith("::before") && element.matches(part.slice(0, -8)));
    const declared = rule.style.getPropertyValue("content");
    if (matching && declared !== "") content = declared;
  }
  return content;
}

/** A toolbar standing in the work column, and an Inbox item's bar standing in the side panel beside it. */
function taskPage(): { column: HTMLElement; panel: HTMLElement } {
  laid = layContainersAt({});
  const shell = document.body.appendChild(document.createElement("div"));
  shell.className = "desktop-shell";
  const column = shell.appendChild(document.createElement("header"));
  column.className = "desktop-toolbar";
  const side = shell.appendChild(document.createElement("aside"));
  side.className = "side-panel";
  const item = side.appendChild(document.createElement("div"));
  item.className = "inbox-view-items";
  const panel = item.appendChild(document.createElement("header"));
  panel.className = "desktop-toolbar";
  return { column, panel };
}

test("the work column's toolbar runs its hairline on past its sides", () => {
  const { column } = taskPage();
  assert.notEqual(beforeContent(column), undefined);
  assert.notEqual(beforeContent(column), "none");
});

test("a toolbar in the side panel draws no hairline running across the work column", () => {
  const { panel } = taskPage();
  assert.equal(beforeContent(panel), "none");
});
