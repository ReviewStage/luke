// @vitest-environment jsdom

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeAll, test } from "vitest";

/**
 * hover-card-chips.test.ts -- nothing on a hover card runs past its edge: a
 * card's chip is never wider than the card, and an Inbox row's card keeps its
 * task's key whole and on one line with the task's chip, which gives way
 * instead. jsdom lays nothing out, so the rules that hold them in are read.
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

test("a card's chip is held to the card's width, and an Inbox card's key stays whole on one line with its task's chip", () => {
  const standing = element("div", "task-card-standing", document.body);
  const chip = element("span", "task-card-chip", standing);
  const key = element("span", "task-card-chip task-card-key", standing);
  assert.equal(getComputedStyle(chip).maxWidth, "100%");
  assert.equal(getComputedStyle(key).flexShrink, "0");
  assert.equal(getComputedStyle(standing).flexWrap, "wrap");
  standing.dataset.line = "one";
  assert.equal(getComputedStyle(standing).flexWrap, "nowrap");
});
