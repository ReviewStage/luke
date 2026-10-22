import assert from "node:assert/strict";
import { test } from "vitest";
import { CHOICE_ROLE, type ChoicePress, choiceKeyTarget, choiceTabStop } from "./choice-keys.js";

/**
 * choice-keys.test.ts -- in a row of options where you choose one, the
 * arrows step and wrap at either end, Home and End go to either end, ↑ and ↓
 * step a radio group alone, a key held with a modifier moves nothing, a
 * disabled option is stepped past, and the one tab stop stands on the
 * chosen option or the first while none is.
 */

const FOUR = [{}, {}, {}, {}];

function press(key: string, held: Partial<ChoicePress> = {}): ChoicePress {
  return { key, metaKey: false, altKey: false, ctrlKey: false, shiftKey: false, ...held };
}

test("the arrows step along the row and wrap at either end", () => {
  assert.equal(choiceKeyTarget(press("ArrowRight"), 1, FOUR, CHOICE_ROLE.TAB), 2);
  assert.equal(choiceKeyTarget(press("ArrowRight"), 3, FOUR, CHOICE_ROLE.TAB), 0);
  assert.equal(choiceKeyTarget(press("ArrowLeft"), 0, FOUR, CHOICE_ROLE.RADIO), 3);
});

test("Home and End go to either end", () => {
  assert.equal(choiceKeyTarget(press("Home"), 2, FOUR, CHOICE_ROLE.TAB), 0);
  assert.equal(choiceKeyTarget(press("End"), 1, FOUR, CHOICE_ROLE.RADIO), 3);
});

test("↑ and ↓ step a radio group and leave a tablist alone", () => {
  assert.equal(choiceKeyTarget(press("ArrowDown"), 3, FOUR, CHOICE_ROLE.RADIO), 0);
  assert.equal(choiceKeyTarget(press("ArrowUp"), 1, FOUR, CHOICE_ROLE.RADIO), 0);
  assert.equal(choiceKeyTarget(press("ArrowDown"), 1, FOUR, CHOICE_ROLE.TAB), undefined);
  assert.equal(choiceKeyTarget(press("ArrowUp"), 1, FOUR, CHOICE_ROLE.TAB), undefined);
});

test("a key held with ⌘, ⌥, ⌃, or ⇧ moves nothing", () => {
  for (const held of [{ metaKey: true }, { altKey: true }, { ctrlKey: true }, { shiftKey: true }]) {
    assert.equal(choiceKeyTarget(press("ArrowRight", held), 1, FOUR, CHOICE_ROLE.TAB), undefined);
    assert.equal(choiceKeyTarget(press("End", held), 1, FOUR, CHOICE_ROLE.RADIO), undefined);
  }
});

test("a key the row does not move by, or a row with no options, moves nothing", () => {
  assert.equal(choiceKeyTarget(press("a"), 1, FOUR, CHOICE_ROLE.RADIO), undefined);
  assert.equal(choiceKeyTarget(press("ArrowRight"), -1, [], CHOICE_ROLE.TAB), undefined);
  assert.equal(choiceKeyTarget(press("Home"), -1, [], CHOICE_ROLE.TAB), undefined);
});

test("a disabled option is stepped past, and a row of them moves nowhere", () => {
  const middle = [{}, { disabled: true }, {}, { disabled: true }];
  assert.equal(choiceKeyTarget(press("ArrowRight"), 0, middle, CHOICE_ROLE.TAB), 2);
  assert.equal(choiceKeyTarget(press("ArrowRight"), 2, middle, CHOICE_ROLE.TAB), 0);
  assert.equal(choiceKeyTarget(press("ArrowLeft"), 0, middle, CHOICE_ROLE.TAB), 2);
  assert.equal(choiceKeyTarget(press("End"), 0, middle, CHOICE_ROLE.TAB), 2);
  const none = [{ disabled: true }, { disabled: true }];
  assert.equal(choiceKeyTarget(press("ArrowRight"), 0, none, CHOICE_ROLE.RADIO), undefined);
  assert.equal(choiceKeyTarget(press("Home"), 0, none, CHOICE_ROLE.RADIO), undefined);
});

test("the tab stop stands on the chosen option, or the first that can be chosen while none is", () => {
  const options = [
    { value: "low", disabled: true },
    { value: "medium" },
    { value: "high" },
  ] as const;
  assert.equal(choiceTabStop(options, "high"), "high");
  assert.equal(choiceTabStop(options, undefined), "medium");
  assert.equal(choiceTabStop([], undefined), undefined);
});
