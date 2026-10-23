// @vitest-environment jsdom

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test } from "vitest";
import { InboxListSkeleton } from "../tasks/inbox-list.js";

/**
 * skeleton-rows.test.ts -- a list's placeholder rows stand their blocks
 * where the rows that replace them draw: an Inbox row's tile after the
 * gutter its unread dot stands in, and a pull request part's lines a step
 * apart, as the boxes' own rules space them. jsdom lays nothing out, so
 * what each rule declares is read.
 */

const roots: Root[] = [];

beforeAll(() => {
  const sheet = document.createElement("style");
  sheet.textContent = ["tasks.css", "desktop.css"]
    .map((name) => readFileSync(`${__dirname}/${name}`, "utf8"))
    .join("\n");
  document.head.append(sheet);
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.replaceChildren();
});

test("an Inbox placeholder row stands its tile after the unread dot's gutter, as every item's row does", () => {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(InboxListSkeleton)));
  const marks = [...container.querySelectorAll('.luke-skeleton[data-shape="circle"]')];
  assert.ok(marks.length > 0);
  for (const mark of marks) {
    const gutter = mark.parentElement?.previousElementSibling;
    assert.ok(gutter);
    assert.ok(gutter.classList.contains("inbox-row-gutter"), "the tile's box follows the gutter");
    assert.equal(getComputedStyle(gutter).flexShrink, "0");
  }
});

test("a pull request part's placeholder lines stand a step apart", () => {
  const part = document.body.appendChild(document.createElement("div"));
  part.className = "pull-request-skeleton";
  const [first, second] = [0, 1].map(() => {
    const line = part.appendChild(document.createElement("span"));
    line.className = "luke-skeleton";
    return getComputedStyle(line).marginTop;
  });
  assert.notEqual(second, first);
});
