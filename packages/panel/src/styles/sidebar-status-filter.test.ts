// @vitest-environment jsdom

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeAll, test } from "vitest";

beforeAll(() => {
  const sheet = document.createElement("style");
  sheet.textContent = readFileSync(`${__dirname}/desktop.css`, "utf8");
  document.head.append(sheet);
});

afterEach(() => {
  document.body.replaceChildren();
});

/** The Tasks head with its status filter, neither hovered nor holding focus. */
function tasksHead(): HTMLElement {
  const head = document.body.appendChild(document.createElement("div"));
  head.className = "sidebar-section-head";
  const filter = head.appendChild(document.createElement("span"));
  filter.className = "sidebar-status-filter";
  filter.appendChild(document.createElement("button"));
  return filter;
}

test("the Tasks head's status filter stands while the sidebar is neither hovered nor focused", () => {
  const filter = tasksHead();
  const style = getComputedStyle(filter);
  assert.notEqual(style.opacity, "0");
  assert.notEqual(style.visibility, "hidden");
  assert.notEqual(style.display, "none");
});
