import { type ReactNode, useId } from "react";

/**
 * banner.tsx -- the one strip every notice about a plan is drawn as: a glyph, its words, and the presses that answer it, which drop beneath the words where the strip is narrow.
 *
 * A plan's notices come in three looks: the slim line across the plan's
 * column (a stranded repository's, `plan-banner.tsx`), the card over a
 * document (an archived plan's, the plan template's), and the row in an
 * agent's composer's place (an archived plan's agent). They share one
 * layout, so they give way alike: each strip is a named container
 * (`banner` in `desktop.css`), and below its narrow width the presses leave
 * the words' line for a line of their own, each as wide as the strip
 * allows, so a word is never squeezed a letter to a line and a press never
 * stands on the words. A strip measures itself rather than the window,
 * because the same strip stands in a 280px column beside a wide side panel
 * and in a full window alike. A strip is named by its own words, never an
 * attribute, because the session recording masks text and nothing else.
 */

/** How a strip looks; its layout is the same for all three. */
export const BANNER_LOOK = {
  /** One slim line on a faint attention tint, across the plan's column. */
  LINE: "line",
  /** A card on the document's reading width. */
  CARD: "card",
  /** A quiet row in an agent's composer's place. */
  COMPOSER: "composer",
} as const;

type BannerLook = (typeof BANNER_LOOK)[keyof typeof BANNER_LOOK];

/** The class each look wears beside the shared `banner`. */
const LOOK_CLASS = {
  [BANNER_LOOK.LINE]: "plan-banner",
  [BANNER_LOOK.CARD]: "document-banner",
  [BANNER_LOOK.COMPOSER]: "agent-composer archived-composer",
} as const satisfies Record<BannerLook, string>;

/** A strip: its look, its glyph, its words, which name it to a reader, and the presses that answer it, if any. */
export function Banner({
  look,
  glyph,
  actions,
  className,
  anchor,
  children,
}: {
  look: BannerLook;
  glyph: ReactNode;
  /** The presses, in reading order; the last is the strip's primary one. */
  actions?: ReactNode;
  /** A class of the strip's own place, beside its look's. */
  className?: string;
  /** Attributes that make the strip somewhere a settings search lands. */
  anchor?: Readonly<Record<string, string>>;
  children: ReactNode;
}): React.JSX.Element {
  const wordsId = useId();
  const classes = ["banner", LOOK_CLASS[look], className].filter(Boolean).join(" ");
  return (
    <section className={classes} aria-labelledby={wordsId} {...anchor}>
      <div className="banner-row">
        {glyph}
        <div id={wordsId} className="banner-words">
          {children}
        </div>
        {actions === undefined ? null : <div className="banner-actions">{actions}</div>}
      </div>
    </section>
  );
}
