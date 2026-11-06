import {
  TASK_SECTION_GLYPH,
  TASK_SECTION_ICON_KIND,
  type TaskSectionIcon,
} from "@repo/features/task-section-wire";
import { matchesTokens, searchTokens } from "./search-tokens.js";

const NEWEST_EMOJI_VERSION = 15.1;

const RENAMED_GLYPH = new Map<string, string>([[TASK_SECTION_GLYPH.FLASK, "flask-conical"]]);

const SUGGESTED_GLYPHS = Object.values(TASK_SECTION_GLYPH).map(
  (glyph) => RENAMED_GLYPH.get(glyph) ?? glyph,
);

export interface GlyphChoice {
  readonly glyph: string;
  readonly label: string;
  readonly words: readonly string[];
}

interface EmojiChoice {
  readonly emoji: string;
  readonly name: string;
}

export interface EmojiGroup {
  readonly name: string;
  readonly emojis: readonly EmojiChoice[];
}

interface UnicodeEmoji {
  readonly emoji: string;
  readonly name: string;
  readonly emoji_version: string;
}

export interface UnicodeEmojiGroup {
  readonly name: string;
  readonly emojis: readonly UnicodeEmoji[];
}

export function glyphName(pascal: string): string {
  return (pascal.match(/[A-Z][^A-Z]*|^[^A-Z]+/g) ?? []).map((word) => word.toLowerCase()).join("-");
}

export function glyphKey(glyph: string): string {
  const drawn = RENAMED_GLYPH.get(glyph) ?? glyph;
  return drawn
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
}

export function glyphLabel(glyph: string): string {
  const words = glyph.split("-").join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function isSuggestedGlyph(glyph: string): boolean {
  return SUGGESTED_GLYPHS.includes(glyph);
}

function sameIcon(a: TaskSectionIcon, b: TaskSectionIcon): boolean {
  if (a.kind === TASK_SECTION_ICON_KIND.EMOJI) {
    return b.kind === TASK_SECTION_ICON_KIND.EMOJI && a.emoji === b.emoji;
  }
  return b.kind === TASK_SECTION_ICON_KIND.GLYPH && glyphKey(a.glyph) === glyphKey(b.glyph);
}

export function recentIcons(
  recent: readonly TaskSectionIcon[],
  chosen: TaskSectionIcon,
  most: number,
): TaskSectionIcon[] {
  return [chosen, ...recent.filter((one) => !sameIcon(one, chosen))].slice(0, most);
}

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

export function findGlyphs(choices: readonly GlyphChoice[], query: string): readonly GlyphChoice[] {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return choices;
  return choices.filter((choice) => matchesTokens(choice.words, tokens));
}

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
