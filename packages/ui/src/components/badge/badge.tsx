import type { ReactNode } from "react";

/**
 * badge.tsx -- a short word saying where something stands, in the state palette: working, needing you, done, merged, failed, or nothing in particular.
 *
 * The words are the badge, and the colour says them again: a badge is never
 * a coloured dot alone, so a reader, a screenshot in grey, and an eye that
 * cannot tell the inks apart all read the same state. A glyph may stand
 * before the words where one says the state too. The ink is the tone's own
 * and the ground a tint of it, so the pair holds its contrast on either
 * theme's ground.
 *
 * A badge naming something a provider colours, a GitHub label, wears that
 * colour as a dot before its words (`swatch`) rather than on them, because a
 * provider lets its colour be anything, a dark one among them, which the
 * badge's words could not be read in. The colour is six hex digits, the
 * spelling GitHub and Linear answer; any other is drawn in the subtle ink.
 */

/** The one spelling of a provider's colour a swatch paints: six hex digits, with or without its `#`. */
const SWATCH_COLOUR = /^#?([0-9a-f]{6})$/iu;

/** What a badge says about where something stands. */
export const BADGE_TONE = {
  NEUTRAL: "neutral",
  WORKING: "working",
  ATTENTION: "attention",
  COMPLETE: "complete",
  MERGED: "merged",
  DANGER: "danger",
} as const;

export type BadgeTone = (typeof BADGE_TONE)[keyof typeof BADGE_TONE];

/** A state in `tone`, said by its words. */
export function Badge({
  tone = BADGE_TONE.NEUTRAL,
  icon,
  swatch,
  children,
}: {
  tone?: BadgeTone;
  /** A glyph before the words, saying the state again. */
  icon?: ReactNode;
  /** A provider's colour for what the badge names, drawn as a dot before its words; any colour but six hex digits is drawn subtle. */
  swatch?: string | undefined;
  /** The state's words, which the colour only repeats. */
  children: string;
}): React.JSX.Element {
  const colour = swatch === undefined ? undefined : SWATCH_COLOUR.exec(swatch)?.[1];
  return (
    <span className="luke-badge" data-tone={tone}>
      {swatch === undefined ? null : (
        <span
          className="luke-badge-swatch"
          aria-hidden="true"
          style={colour === undefined ? undefined : { background: `#${colour}` }}
        />
      )}
      {icon}
      <span className="luke-badge-words">{children}</span>
    </span>
  );
}
