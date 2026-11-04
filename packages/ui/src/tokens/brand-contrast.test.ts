import { BRAND_PALETTE } from "@repo/brand";
import { expect, test } from "vitest";

/**
 * brand-contrast.test.ts -- the brand's colors hold WCAG 2.2's contrast
 * minimums on the grounds they are drawn on: 4.5:1 for words (1.4.3), 3:1
 * for the keyboard's ring (1.4.11), in either theme. A change of brand is a
 * change of the one table `brand.css` is generated from, so this is what
 * says a new brand still reads before anyone sees it.
 */

type Theme = (typeof BRAND_PALETTE)[keyof typeof BRAND_PALETTE];

const WORDS = 4.5;
const NON_TEXT = 3;
const WHITE = "#ffffff";
/** How much of the links' ink the sidebar's current row is mixed from (`palettes.css`'s fill-current). */
const CURRENT_ROW_INK = 0.14;

/** A hex color's channels, 0 to 1. */
function channels(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) => channel / 255) as [
    number,
    number,
    number,
  ];
}

/** Relative luminance, as WCAG 2.2 defines it. */
function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) =>
    c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  ) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The contrast ratio of two colors, as WCAG 2.2 defines it. */
function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/** `color-mix(in srgb, ink share, ground)`: each channel mixed by the share. */
function mixed(ink: string, ground: string, share: number): string {
  const a = channels(ink);
  const b = channels(ground);
  const hex = a.map((c, i) =>
    Math.round((c * share + (b[i] ?? 0) * (1 - share)) * 255)
      .toString(16)
      .padStart(2, "0"),
  );
  return `#${hex.join("")}`;
}

/** Every ink the brand draws, each against a ground it is drawn on, and the ratio it owes there. */
function pairs(theme: Theme): [string, string, string, number][] {
  const current = mixed(theme.ACCENT_TEXT, theme.SIDEBAR, CURRENT_ROW_INK);
  return [
    ["text on the ground", theme.TEXT, theme.GROUND, WORDS],
    ["text on the sidebar", theme.TEXT, theme.SIDEBAR, WORDS],
    ["text on a raised surface", theme.TEXT, theme.OVERLAY, WORDS],
    ["body text on the ground", theme.TEXT_BODY, theme.GROUND, WORDS],
    ["quiet text on the ground", theme.TEXT_MUTED, theme.GROUND, WORDS],
    ["quiet text on a well", theme.TEXT_MUTED, theme.WELL, WORDS],
    ["quiet text on the sidebar's current row", theme.TEXT_MUTED, current, WORDS],
    ["the sidebar's words", theme.SIDEBAR_INK, theme.SIDEBAR, WORDS],
    ["a link on the ground", theme.ACCENT_TEXT, theme.GROUND, WORDS],
    ["a link on the sidebar's current row", theme.ACCENT_TEXT, current, WORDS],
    ["words on the accent", theme.ON_ACCENT, theme.ACCENT, WORDS],
    ["the keyboard's ring on the ground", theme.FOCUS_RING, theme.GROUND, NON_TEXT],
    ["danger's words on the ground", theme.DANGER_TEXT, theme.GROUND, WORDS],
    ["white on a destructive button", WHITE, theme.DANGER_FILL, WORDS],
    ["attention's words on the ground", theme.ATTENTION, theme.GROUND, WORDS],
    ["white on attention's fill", WHITE, theme.ATTENTION_FILL, WORDS],
    ["work under way on the ground", theme.WORKING, theme.GROUND, WORDS],
    ["a finished state on the ground", theme.COMPLETE, theme.GROUND, WORDS],
    ["a merged state on the ground", theme.MERGED, theme.GROUND, WORDS],
  ];
}

const CASES = Object.entries(BRAND_PALETTE).flatMap(([name, theme]) =>
  pairs(theme).map(([pair, ink, ground, owed]) => ({ name, pair, ink, ground, owed })),
);

test.each(CASES)("$name: $pair reads at $owed:1 or better", ({ ink, ground, owed }) => {
  expect(contrast(ink, ground)).toBeGreaterThanOrEqual(owed);
});
