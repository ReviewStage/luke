import type { ReactNode, Ref } from "react";

/**
 * card.tsx -- a surface that frames one group of content on a page: its edge, its corner, its ground, and the room inside it.
 *
 * The card owns the frame and nothing it holds: the words, the plot, or the
 * table inside are the caller's, arranged with a Stack or an Inline. The room
 * inside is a finite choice, from flush, where a table or a group of cells
 * fills the card to its edge and the card clips them at its corner, to the
 * regular inset a chart stands in. A card is the containing block of what is
 * hung on it, so a chart's own tooltip is placed against the card rather than
 * against the page.
 */

/** The room between a card's edge and what it holds, by what it holds. */
export const CARD_PADDING = {
  /** Nothing: a table or a group of cells fills the card, clipped at its corner. */
  FLUSH: "flush",
  /** A one-line band, a notice with its action: a short block inset. */
  SNUG: "snug",
  /** A figure under its label: a step less block inset than a regular card. */
  COMPACT: "compact",
  /** A chart, a preview, or an empty line: the card's whole inset. */
  REGULAR: "regular",
} as const;

export type CardPadding = (typeof CARD_PADDING)[keyof typeof CARD_PADDING];

/** `children` framed by a card, `padding` in from its edge. */
export function Card({
  padding = CARD_PADDING.REGULAR,
  title,
  ref,
  children,
}: {
  padding?: CardPadding;
  /** The hint a pointer resting anywhere on the card is shown. */
  title?: string | undefined;
  /** The card's element, for what measures against it. */
  ref?: Ref<HTMLDivElement> | undefined;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div ref={ref} className="luke-card" data-padding={padding} title={title}>
      {children}
    </div>
  );
}
