import assert from "node:assert/strict";
import { test } from "vitest";
import {
  boundedIntroductionName,
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

test("the name is the display name's first word, folded and cut, or nothing", () => {
  assert.equal(boundedIntroductionName("Ada Lovelace"), "Ada");
  assert.equal(boundedIntroductionName("  Ada\n Lovelace "), "Ada");
  assert.equal(boundedIntroductionName("Ada"), "Ada");
  assert.equal(boundedIntroductionName("   "), undefined);
  assert.equal(boundedIntroductionName(undefined), undefined);
  assert.equal(
    boundedIntroductionName("x".repeat(INTRODUCTION_SEED_BOUNDS.NAME_CHARS * 2))?.length,
    INTRODUCTION_SEED_BOUNDS.NAME_CHARS,
  );
});

test("the seed is one developer message carrying the name and every bounded title, or nothing", () => {
  assert.deepEqual(introductionSeedItems({ titles: [] }), []);
  assert.deepEqual(introductionSeedItems({ titles: ["", "  "], name: "  " }), []);
  const items = introductionSeedItems({
    titles: ["Fix the flaky test", "Nukualofa"],
    name: "Ada L",
  });
  assert.equal(items.length, 1);
  const [item] = items;
  assert.equal(item?.type, SEED_ITEM_TYPE);
  assert.equal(item?.role, SEED_ROLE.DEVELOPER);
  assert.equal(item?.content.length, 1);
  assert.equal(item?.content[0].type, SEED_CONTENT_TYPE.INPUT_TEXT);
  const blocks = item?.content[0].text.split("\n\n") ?? [];
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks[0]?.split("\n").slice(-1), ["Ada"]);
  assert.deepEqual(blocks[1]?.split("\n").slice(-2), ["Fix the flaky test", "Nukualofa"]);
});

test("a name alone, and titles alone, each make one message of one block", () => {
  const named = introductionSeedItems({ titles: [], name: "Ada" });
  assert.equal(named.length, 1);
  assert.equal(named[0]?.content[0].text.split("\n\n").length, 1);
  const titled = introductionSeedItems({ titles: ["Nukualofa"] });
  assert.equal(titled.length, 1);
  assert.equal(titled[0]?.content[0].text.split("\n\n").length, 1);
});

test("the whole message stays under the voice service's admitted size", () => {
  const items = introductionSeedItems({
    titles: Array.from({ length: 20 }, () => "y".repeat(INTRODUCTION_SEED_BOUNDS.TITLE_CHARS * 2)),
    name: "n".repeat(INTRODUCTION_SEED_BOUNDS.NAME_CHARS * 2),
  });
  const text = items[0]?.content[0].text ?? "";
  // The bounded values, plus the two marker sentences and the line breaks
  // between them, which is what the service's own admission has to hold.
  const markers = 320;
  assert.ok(
    text.length <=
      INTRODUCTION_SEED_BOUNDS.TITLES * (INTRODUCTION_SEED_BOUNDS.TITLE_CHARS + 1) +
        INTRODUCTION_SEED_BOUNDS.NAME_CHARS +
        markers,
  );
});
