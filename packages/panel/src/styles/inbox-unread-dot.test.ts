// @vitest-environment jsdom

import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import { layContainersAt } from "../testing/container-width.js";

/**
 * inbox-unread-dot.test.ts -- an Inbox row's unread dot stands level with
 * its title's capitals: its gutter sets its line in the title's type, so
 * the two share a baseline, and the dot stands on that baseline raised to
 * the capitals' middle, rather than on the middle of the line's box, which
 * the system's face sets its letters low in. Nothing but the row's leading
 * gap stands between the gutter and the title. jsdom lays nothing out and
 * resolves no custom property, so the sheets are laid
 * (`testing/container-width.ts`) and what they declare for each part of a
 * row built in the markup `inbox-list.tsx` draws is read.
 */

let laid: HTMLStyleElement | undefined;

afterEach(() => {
  laid?.remove();
  laid = undefined;
  document.body.replaceChildren();
  document.documentElement.removeAttribute("data-luke-profile");
});

/** Appends an element of `tag` with `className` to `parent`; answers it. */
function part(parent: Element, tag: string, className: string): HTMLElement {
  const element = parent.appendChild(document.createElement(tag));
  element.className = className;
  return element;
}

/** An unread Inbox row as the list draws it, its metadata on its title's line; answers its gutter, its dot, and its title. */
function unreadRow() {
  const list = part(document.body, "ul", "luke-list");
  const row = part(list, "li", "luke-list-row");
  row.setAttribute("data-meta", "title");
  row.setAttribute("data-unread", "true");
  const press = part(row, "button", "luke-list-row-main");
  const leading = part(press, "span", "luke-list-row-leading");
  const gutter = part(leading, "span", "inbox-row-gutter");
  const dot = part(gutter, "span", "inbox-row-unread");
  const words = part(press, "span", "luke-list-row-text");
  const head = part(words, "span", "luke-list-row-head");
  const title = part(head, "span", "luke-list-row-title");
  return { gutter, dot, title };
}

test("an Inbox row's unread dot sets its line in the title's type and stands at the capitals' middle, the leading's gap alone before the title", () => {
  document.documentElement.setAttribute("data-luke-profile", "desktop");
  laid = layContainersAt({});
  const { gutter, dot, title } = unreadRow();
  const [lined, titled] = [getComputedStyle(gutter), getComputedStyle(title)];

  assert.equal(lined.fontSize, titled.fontSize, "the gutter's type is the title's");
  assert.equal(lined.lineHeight, titled.lineHeight, "the gutter's line is the title's");
  assert.equal(getComputedStyle(dot).display, "inline-block", "the dot stands on the line");
  assert.match(getComputedStyle(dot).verticalAlign, /0\.5cap/u, "raised to the capitals' middle");
  assert.ok(
    ["", "0", "0px"].includes(lined.marginInlineEnd),
    `no gap of the gutter's own: ${lined.marginInlineEnd}`,
  );
});
