import { expect, test } from "vitest";
import { type MenuLine, menuCut } from "./menu-cut.js";

/**
 * menu-cut.test.ts -- a menu too tall for its room is cut through a line of
 * words, so its fade lies over words that go on below. The lines are a task
 * row's menu as a 760×520 window lays it out: rows 32px tall, rules between
 * groups, and a footer of two caption lines under the last rule.
 */

/** A row of words from `top`, 32px tall. */
function row(top: number): MenuLine {
  return { top, bottom: top + 32, words: true };
}

/** A rule between groups at `top`. */
function rule(top: number): MenuLine {
  return { top, bottom: top + 1, words: false };
}

// Copy plan … Permanently delete, then the "Created by / Last edited" footer.
const TASK_MENU: readonly MenuLine[] = [
  row(0),
  row(32),
  row(64),
  row(96),
  row(128),
  rule(164),
  row(169),
  row(201),
  row(233),
  row(265),
  rule(301),
  row(306),
  row(338),
  row(370),
  rule(406),
  row(411),
  rule(447),
  row(452),
  rule(488),
  { top: 493, bottom: 535, words: true },
];
const FADE = 24;

test("a room that ends over the gap above a footer cuts through the middle of the last row whose middle it reaches", () => {
  // The room ends 1px into the footer, so the fade would lie over the rule and gap above it.
  expect(menuCut(TASK_MENU, 535, 494, FADE)).toBe(468);
});

test("a room that already ends half a fade into a row's words leaves the rows as tall as the room", () => {
  expect(menuCut(TASK_MENU, 535, 470, FADE)).toBeUndefined();
});

test("rows that fit their room are not cut", () => {
  expect(menuCut(TASK_MENU, 535, 535, FADE)).toBeUndefined();
});
