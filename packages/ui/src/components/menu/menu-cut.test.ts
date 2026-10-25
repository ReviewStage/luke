import { expect, test } from "vitest";
import { MENU_LINE, type MenuLine, menuCut } from "./menu-cut.js";

/**
 * menu-cut.test.ts -- a menu too tall for its room is cut through a line of
 * words where items go on past it, so its fade lies over words that go on
 * below, and keeps its whole room where every item fits. The lines are a
 * task row's menu as a 760×520 window lays it out: rows 32px tall, rules
 * between groups, and a footer of two caption lines under the last rule.
 */

/** An item from `top`, 32px tall. */
function row(top: number): MenuLine {
  return { top, bottom: top + 32, kind: MENU_LINE.ITEM };
}

/** A rule between groups at `top`. */
function rule(top: number): MenuLine {
  return { top, bottom: top + 1, kind: MENU_LINE.RULE };
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
  { top: 493, bottom: 535, kind: MENU_LINE.NOTE },
];
const FADE = 24;

test("a room that ends over a rule with items past it cuts through the middle of the last row whose middle it reaches", () => {
  // The room ends between the rule over Permanently delete and its row, so the fade would lie over the gap.
  expect(menuCut(TASK_MENU, 535, 450, FADE)).toBe(427);
});

test("a room that holds every item whole, only the footer past it, leaves the rows as tall as the room", () => {
  // The 760×520 window's room ends 1px into the footer, under Permanently delete and its rule.
  expect(menuCut(TASK_MENU, 535, 494, FADE)).toBeUndefined();
});

test("a room that already ends half a fade into a row's words leaves the rows as tall as the room", () => {
  expect(menuCut(TASK_MENU, 535, 470, FADE)).toBeUndefined();
});

test("rows that fit their room are not cut", () => {
  expect(menuCut(TASK_MENU, 535, 535, FADE)).toBeUndefined();
});
