import assert from "node:assert/strict";
import test from "node:test";
import {
  boundedIntroductionTitles,
  INTRODUCTION_SEED_BOUNDS,
  introductionSeedItems,
} from "./introduction.js";
import { SEED_CONTENT_TYPE, SEED_ITEM_TYPE, SEED_ROLE } from "./seed.js";

test("the titles are cut to the count and each to its length, blanks dropped", () => {
  const titles = Array.from({ length: INTRODUCTION_SEED_BOUNDS.TITLES + 3 }, (_, index) =>
    index === 2 ? "   " : `Session ${index} ${"x".repeat(200)}`,
  );
  const bounded = boundedIntroductionTitles(titles);
  assert.equal(bounded.length, INTRODUCTION_SEED_BOUNDS.TITLES);
  for (const title of bounded) {
    assert.equal(title.length, INTRODUCTION_SEED_BOUNDS.TITLE_CHARS);
  }
  assert.deepEqual(boundedIntroductionTitles(["a\nb\tc", "  d  "]), ["a b c", "d"]);
});

test("the seed is one developer message carrying every bounded title, or nothing", () => {
  assert.deepEqual(introductionSeedItems([]), []);
  assert.deepEqual(introductionSeedItems(["", "  "]), []);
  const items = introductionSeedItems(["Fix the flaky test", "Nukualofa"]);
  assert.equal(items.length, 1);
  const [item] = items;
  assert.equal(item?.type, SEED_ITEM_TYPE);
  assert.equal(item?.role, SEED_ROLE.DEVELOPER);
  assert.equal(item?.content.length, 1);
  assert.equal(item?.content[0].type, SEED_CONTENT_TYPE.INPUT_TEXT);
  const lines = item?.content[0].text.split("\n") ?? [];
  assert.deepEqual(lines.slice(-2), ["Fix the flaky test", "Nukualofa"]);
});

test("the whole message stays under the voice service's admitted size", () => {
  const items = introductionSeedItems(
    Array.from({ length: 20 }, () => "y".repeat(INTRODUCTION_SEED_BOUNDS.TITLE_CHARS * 2)),
  );
  const text = items[0]?.content[0].text ?? "";
  assert.ok(
    text.length <=
      INTRODUCTION_SEED_BOUNDS.TITLES * (INTRODUCTION_SEED_BOUNDS.TITLE_CHARS + 1) + 256,
  );
});
