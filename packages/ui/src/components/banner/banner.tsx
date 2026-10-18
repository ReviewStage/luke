import { type ReactNode, useId } from "react";

/**
 * banner.tsx -- the one strip a notice about a place is drawn as: a glyph, its words, and the presses that answer it, which drop beneath the words where the strip is narrow.
 *
 * A notice comes in three looks: a slim strip across a column, its words held
 * to one line (a stranded repository's); a card over a document, its glyph
 * in a disc (an archived plan's, the plan template's); and a quiet row in the
 * frame its place draws around it (an archived agent's, in its composer's
 * place). Each is in one of a few tones, which tint the strip and the card.
 *
 * They share one layout, so they give way alike: each strip measures its own
 * width, and below a narrow one its presses leave the words' line for a line
 * of their own, each as wide as the line allows, so a word is never squeezed
 * a letter to a line and a press never stands on the words. It measures
 * itself rather than the window, because the same strip stands in a narrow
 * column beside a wide side panel and across a whole window alike. A strip
 * is named by its own words, never an attribute, because a session
 * recording masks text and nothing else.
 *
 * Where a banner stands, how wide it is and the room around it, is its
 * place's; the banner takes no class or style.
 */

/** How a banner looks; its layout is the same for all three. */
export const BANNER_LOOK = {
  /** One slim line across a column, its words held to one line while there is room. */
  STRIP: "strip",
  /** A card, its glyph in a disc. */
  CARD: "card",
  /** A quiet row, framed by its place. */
  ROW: "row",
} as const;

export type BannerLook = (typeof BANNER_LOOK)[keyof typeof BANNER_LOOK];

/** What a banner's tint says: nothing in particular, or that something needs the reader. */
export const BANNER_TONE = {
  NEUTRAL: "neutral",
  ATTENTION: "attention",
} as const;

export type BannerTone = (typeof BANNER_TONE)[keyof typeof BANNER_TONE];

/** A notice: its look and tone, its glyph, its words, which name it to a reader, and the presses that answer it, if any. */
export function Banner({
  look,
  tone = BANNER_TONE.NEUTRAL,
  glyph,
  actions,
  children,
}: {
  look: BannerLook;
  tone?: BannerTone;
  glyph: ReactNode;
  /** The presses, in reading order; the last is the banner's primary one. */
  actions?: ReactNode;
  children: ReactNode;
}): React.JSX.Element {
  const wordsId = useId();
  return (
    <section className="luke-banner" data-look={look} data-tone={tone} aria-labelledby={wordsId}>
      <div className="luke-banner-row">
        <span className="luke-banner-glyph" aria-hidden="true">
          {glyph}
        </span>
        <div id={wordsId} className="luke-banner-words">
          {children}
        </div>
        {actions === undefined ? null : <div className="luke-banner-actions">{actions}</div>}
      </div>
    </section>
  );
}
