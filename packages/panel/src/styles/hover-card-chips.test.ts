// @vitest-environment jsdom

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeAll, test } from "vitest";

/**
 * hover-card-chips.test.ts -- nothing on a hover card runs past its edge: a
 * chip naming a long task, as an Inbox row's card leads with, is never wider
 * than the card and shrinks with its mark kept whole, and a choice's option
 * or a to-do's step with a long unbroken word wraps rather than runs on.
 * jsdom lays nothing out, so the rules that hold them in are read.
 */

beforeAll(() => {
  const sheet = document.createElement("style");
  sheet.textContent = readFileSync(`${__dirname}/desktop.css`, "utf8");
  document.head.append(sheet);
});

afterEach(() => {
  document.body.replaceChildren();
});

function element(tag: string, className: string, parent: Element): HTMLElement {
  const made = parent.appendChild(document.createElement(tag));
  made.className = className;
  return made;
}

test("a card's task chip is held to the card's width, its words shrinking and its mark kept whole", () => {
  const standing = element("div", "task-card-standing", document.body);
  const chip = element("span", "task-card-chip", standing);
  const mark = element("span", "luke-task-mark", chip);
  const words = element("span", "luke-one-line", chip);
  const style = getComputedStyle(chip);
  assert.equal(style.maxWidth, "100%");
  assert.equal(style.minWidth, "0px");
  assert.equal(getComputedStyle(mark).flex.split(" ")[1], "0");
  assert.notEqual(getComputedStyle(words).flexShrink, "0");
  standing.dataset.line = "one";
  assert.equal(getComputedStyle(standing).flexWrap, "nowrap");
});

test("a card's option and step wrap a long unbroken word rather than run past the card", () => {
  const options = element("ul", "inbox-card-options", document.body);
  const option = element("span", "inbox-card-option", element("li", "", options));
  const steps = element("ul", "inbox-card-steps", document.body);
  const step = element("li", "", steps);
  assert.equal(getComputedStyle(option).overflowWrap, "anywhere");
  assert.equal(getComputedStyle(step).overflowWrap, "anywhere");
});
