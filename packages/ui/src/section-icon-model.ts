/**
 * section-icon-model.ts -- what a sidebar section's icon picker offers and finds: every Lucide glyph by its kebab-case name, every emoji by category, and the words a search finds each by.
 *
 * A glyph travels by its kebab-case name (`@luke/features/task-section-wire`)
 * and is drawn from Lucide's `icons` map, whose keys are the same name in
 * PascalCase, so the two spellings are turned into each other here and
 * nowhere else. Note that the name a glyph is stored under is the one
 * `glyphName` spells from its PascalCase key, so drawing it again always
 * finds it, even where Lucide's own file name splits a number apart. The
 * glyphs a section could wear before the picker offered them all keep
 * their names, `flask` among them, which Lucide calls `flask-conical`.
 *
 * Lucide ships no tags, so a glyph is found by the words of its name. An
 * emoji is found by its Unicode name, and one newer than macOS draws is
 * left out. Every function is pure over the data it is handed, so the
 * picker loads that data when it opens rather than with the window.
 */

import { TASK_SECTION_GLYPH } from "@luke/features/task-section-wire";
import { matchesTokens, searchTokens } from "./search-tokens.js";

/** The newest emoji version offered: one newer is not yet drawn by every macOS a Mac may run. */
const NEWEST_EMOJI_VERSION = 15.1;

/** The glyphs whose stored name is not Lucide's own, and the Lucide icon each is drawn as. */
const RENAMED_GLYPH = new Map<string, string>([[TASK_SECTION_GLYPH.FLASK, "flask-conical"]]);

/** The glyphs offered first while nothing is searched, as Lucide names them. */
const SUGGESTED_GLYPHS = Object.values(TASK_SECTION_GLYPH).map(
  (glyph) => RENAMED_GLYPH.get(glyph) ?? glyph,
);

/** One glyph the picker offers: its name on the wire, what it is called, and the words it is found by. */
export interface GlyphChoice {
  readonly glyph: string;
  readonly label: string;
  readonly words: readonly string[];
}

/** One emoji the picker offers, and its Unicode name, which it is found by. */
interface EmojiChoice {
  readonly emoji: string;
  readonly name: string;
}

/** One category of emoji, in Unicode's order. */
export interface EmojiGroup {
  readonly name: string;
  readonly emojis: readonly EmojiChoice[];
}

/** An emoji as `unicode-emoji-json`'s `data-by-group.json` lists it, of which only these keys are read. */
interface UnicodeEmoji {
  readonly emoji: string;
  readonly name: string;
  readonly emoji_version: string;
}

/** A category as `unicode-emoji-json`'s `data-by-group.json` lists it. */
export interface UnicodeEmojiGroup {
  readonly name: string;
  readonly emojis: readonly UnicodeEmoji[];
}

/**
 * A glyph's kebab-case name, as the wire carries it, from its PascalCase key
 * in Lucide's `icons`: its words, lower-cased, each begun by a capital, so
 * that capitalizing each again spells the key back (`Grid2x2` is one word).
 */
export function glyphName(pascal: string): string {
  return (pascal.match(/[A-Z][^A-Z]*|^[^A-Z]+/g) ?? []).map((word) => word.toLowerCase()).join("-");
}

/** The key Lucide's `icons` draws a glyph's name under, the inverse of `glyphName`: `arrow-down01` as `ArrowDown01`. */
export function glyphKey(glyph: string): string {
  const drawn = RENAMED_GLYPH.get(glyph) ?? glyph;
  return drawn
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
}

/** What a glyph is called where it is named, its words in sentence case: `flask-conical` as "Flask conical". */
export function glyphLabel(glyph: string): string {
  const words = glyph.split("-").join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Every glyph by its key in Lucide's `icons`, found by its name, the suggested ones first and the rest alphabetical. */
export function glyphChoices(keys: readonly string[]): GlyphChoice[] {
  const choices = keys.map((key): GlyphChoice => {
    const glyph = glyphName(key);
    return { glyph, label: glyphLabel(glyph), words: [glyph.split("-").join(" ")] };
  });
  const rank = (choice: GlyphChoice) => {
    const at = SUGGESTED_GLYPHS.indexOf(choice.glyph);
    return at === -1 ? SUGGESTED_GLYPHS.length : at;
  };
  return choices.sort((a, b) => rank(a) - rank(b) || a.glyph.localeCompare(b.glyph));
}

/** The glyphs a query finds, every one for a blank query. */
export function findGlyphs(choices: readonly GlyphChoice[], query: string): readonly GlyphChoice[] {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return choices;
  return choices.filter((choice) => matchesTokens(choice.words, tokens));
}

/** Every emoji every Mac draws, by category in Unicode's order, from `unicode-emoji-json`'s groups. */
export function emojiGroups(groups: readonly UnicodeEmojiGroup[]): EmojiGroup[] {
  return groups
    .map((group) => ({
      name: group.name,
      emojis: group.emojis
        .filter((one) => Number(one.emoji_version) <= NEWEST_EMOJI_VERSION)
        .map((one) => ({ emoji: one.emoji, name: one.name })),
    }))
    .filter((group) => group.emojis.length > 0);
}

/** The emoji a query finds, each category keeping only what it found and none left empty; every one for a blank query. */
export function findEmoji(groups: readonly EmojiGroup[], query: string): readonly EmojiGroup[] {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return groups;
  return groups
    .map((group) => ({
      name: group.name,
      emojis: group.emojis.filter((one) => matchesTokens([one.name], tokens)),
    }))
    .filter((group) => group.emojis.length > 0);
}
