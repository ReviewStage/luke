// @vitest-environment jsdom

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test } from "vitest";
import { InboxListSkeleton } from "../tasks/inbox-list.js";

/**
 * skeleton-rows.test.ts -- a list's placeholder rows stand their blocks
 * where the rows that replace them draw: an Inbox row's words after the
 * gutter its unread dot stands in, and no tile, and a pull request part's lines a step
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

test("an Inbox placeholder row leads with the unread dot's gutter alone, no tile after it, as every item's row does", () => {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(createElement(InboxListSkeleton)));
  const leadings = [...container.querySelectorAll(".luke-list-row-leading")];
  assert.ok(leadings.length > 0);
  for (const leading of leadings) {
    const [gutter, ...rest] = [...leading.children];
    assert.ok(gutter?.classList.contains("inbox-row-gutter"), "the gutter leads");
    assert.ok(gutter);
    assert.deepEqual(rest, [], "no tile stands after the gutter");
    assert.equal(getComputedStyle(gutter).flexShrink, "0");
  }
  assert.equal(container.querySelector('.luke-skeleton[data-shape="circle"]'), null);
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
