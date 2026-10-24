/**
 * icon-size.ts -- the seats an icon stands in.
 *
 * Three seats and one for empty states: 12 beside a caption's words, 16 in a
 * button, a tab, a chip, and a menu row, 20 as a row's or a card's lead mark,
 * and 40 over an empty state's words. An icon is drawn at a seat and never at
 * a size of its own; the pixels are `--luke-icon-*` in `tokens/scale.css`, so
 * this table names the seats and the stylesheet sizes them.
 */

export const ICON_SIZE = {
  SMALL: "small",
  MEDIUM: "medium",
  LARGE: "large",
  EMPTY: "empty",
} as const;

export type IconSize = (typeof ICON_SIZE)[keyof typeof ICON_SIZE];

/** The stroke every icon is drawn at in its 24 box, Lucide's own two and a step finer. */
export const ICON_STROKE_WIDTH = 1.9;
