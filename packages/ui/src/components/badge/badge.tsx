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
 */

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
  children,
}: {
  tone?: BadgeTone;
  /** A glyph before the words, saying the state again. */
  icon?: ReactNode;
  /** The state's words, which the colour only repeats. */
  children: string;
}): React.JSX.Element {
  return (
    <span className="luke-badge" data-tone={tone}>
      {icon}
      {children}
    </span>
  );
}
