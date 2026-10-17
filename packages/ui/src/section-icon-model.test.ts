import assert from "node:assert/strict";
import { TASK_SECTION_GLYPH } from "@luke/features/task-section-wire";
import { describe, it } from "vitest";
import {
  emojiGroups,
  findEmoji,
  findGlyphs,
  glyphChoices,
  glyphKey,
  glyphName,
} from "./section-icon-model.js";

/**
 * What the section icon picker offers and finds, over a synthetic slice of
 * Lucide's icons and of `unicode-emoji-json`'s groups: a glyph found by
 * the words of its name, drawn again from
 * the name it is stored under, the suggested glyphs first, and the emoji a
 * Mac draws, by category, found by name.
 */

/** Keys of Lucide's `icons`, a few of them. */
const ICONS = ["ArrowDownWideNarrow", "Grid2x2", "Rocket", "FlaskConical", "Accessibility"];

const GROUPS = [
  {
    name: "Travel & Places",
    emojis: [
      { emoji: "🚀", name: "rocket", emoji_version: "0.6" },
      { emoji: "🛻", name: "pickup truck", emoji_version: "13.0" },
    ],
  },
  {
    name: "Smileys & Emotion",
    emojis: [
      { emoji: "😀", name: "grinning face", emoji_version: "1.0" },
      { emoji: "🫩", name: "face with bags under eyes", emoji_version: "16.0" },
    ],
  },
  { name: "Newest", emojis: [{ emoji: "🫆", name: "fingerprint", emoji_version: "16.0" }] },
];

describe("glyph names", () => {
  it("draws every glyph again from the name it is stored under", () => {
    for (const key of ICONS) assert.equal(glyphKey(glyphName(key)), key);
    assert.equal(glyphName("Grid2x2"), "grid2x2");
  });

  it("draws the flask a section wore before as Lucide's flask-conical", () => {
    assert.equal(glyphKey(TASK_SECTION_GLYPH.FLASK), "FlaskConical");
  });
});

describe("glyphChoices", () => {
  const choices = glyphChoices(ICONS);

  it("offers the suggested glyphs first, in their order, then the rest alphabetically", () => {
    assert.deepEqual(
      choices.map((choice) => choice.glyph),
      ["rocket", "flask-conical", "accessibility", "arrow-down-wide-narrow", "grid2x2"],
    );
  });

  it("finds a glyph by every word of its name, and every one for a blank search", () => {
    assert.deepEqual(
      findGlyphs(choices, "Narrow arrow").map((choice) => choice.label),
      ["Arrow down wide narrow"],
    );
    assert.equal(findGlyphs(choices, "  ").length, choices.length);
    assert.deepEqual(findGlyphs(choices, "zebra"), []);
  });
});

describe("emoji", () => {
  const groups = emojiGroups(GROUPS);

  it("leaves out an emoji newer than macOS draws, and a category left with none", () => {
    assert.deepEqual(
      groups.map((group) => [group.name, group.emojis.map((one) => one.emoji)]),
      [
        ["Travel & Places", ["🚀", "🛻"]],
        ["Smileys & Emotion", ["😀"]],
      ],
    );
  });

  it("finds an emoji by name, each category keeping only what it found", () => {
    assert.deepEqual(findEmoji(groups, "truck"), [
      { name: "Travel & Places", emojis: [{ emoji: "🛻", name: "pickup truck" }] },
    ]);
    assert.deepEqual(findEmoji(groups, "nothing like it"), []);
  });
});
