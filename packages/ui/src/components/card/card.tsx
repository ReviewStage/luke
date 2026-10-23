import { createElement, type HTMLAttributes, type ReactNode, type Ref } from "react";

/**
 * card.tsx -- a surface that frames one group of content on a page: its edge, its corner, its ground, and the room inside it.
 *
 * The card owns the frame and nothing it holds: the words, the plot, or the
 * table inside are the caller's, arranged with a Stack or an Inline. The room
 * inside is a finite choice, from flush, where a table or a group of cells
 * fills the card to its edge and the card clips them at its corner, to the
 * regular inset a chart stands in. A card is the containing block of what is
 * hung on it, so a chart's own tooltip is placed against the card rather than
 * against the page. Its ground is a finite choice too (`CARD_LOOK`), as is its
 * corner (`CARD_CORNER`): a page's card, or a control's tighter one, as a card
 * set among a thread's lines or a transcript's is. It is the element its place
 * reads it as (`CARD_ELEMENT`), and keeps its owner's class only to be named
 * and placed by it, never to be drawn.
 */

/** The room between a card's edge and what it holds, by what it holds. */
export const CARD_PADDING = {
  /** Nothing: a table or a group of cells fills the card, clipped at its corner. */
  FLUSH: "flush",
  /** Nothing, and nothing clipped: what it holds lays out its own room, as a card set among lines does, whose field opens its menus past the card's edge. */
  NONE: "none",
  /** A one-line band, a notice with its action: a short block inset. */
  SNUG: "snug",
  /** A figure under its label: a step less block inset than a regular card. */
  COMPACT: "compact",
  /** A chart, a preview, or an empty line: the card's whole inset. */
  REGULAR: "regular",
} as const;

export type CardPadding = (typeof CARD_PADDING)[keyof typeof CARD_PADDING];

/**
 * How a card stands on its page: on the page's surface; raised on an opaque
 * ground in a strong edge and a smaller corner, as a card set inside a
 * thread's words is; tinted with the hover's wash, as what a transcript
 * folds open is; on the code's own ground, as a file's lines are; or its edge
 * alone, on whatever ground it stands on.
 */
export const CARD_LOOK = {
  SURFACE: "surface",
  RAISED: "raised",
  TINT: "tint",
  CODE: "code",
  OUTLINE: "outline",
} as const;

export type CardLook = (typeof CARD_LOOK)[keyof typeof CARD_LOOK];

/** A card's corner: a page's card's, or a control's, for a card set among lines rather than on a page. Note that a raised card always wears the control's. */
export const CARD_CORNER = {
  CARD: "card",
  CONTROL: "control",
} as const;

export type CardCorner = (typeof CARD_CORNER)[keyof typeof CARD_CORNER];

/** The elements a card may be, by what its place reads it as; a span stands in running words, as a picture's frame stands in a paragraph. */
export const CARD_ELEMENT = {
  DIV: "div",
  ARTICLE: "article",
  FIGURE: "figure",
  LI: "li",
  SPAN: "span",
} as const;

export type CardElement = (typeof CARD_ELEMENT)[keyof typeof CARD_ELEMENT];

/** `children` framed by a card, `padding` in from its edge. */
export function Card({
  as: Element = CARD_ELEMENT.DIV,
  look = CARD_LOOK.SURFACE,
  corner = CARD_CORNER.CARD,
  padding = CARD_PADDING.REGULAR,
  dashed = false,
  className,
  ref,
  children,
  ...rest
}: Omit<HTMLAttributes<HTMLElement>, "className" | "children"> & {
  as?: CardElement;
  look?: CardLook;
  corner?: CardCorner;
  padding?: CardPadding;
  /** Whether its edge is dashed, as the frame of what is missing is. */
  dashed?: boolean | undefined;
  /** The owner's own class, which names and places it and sets nothing of its frame. */
  className?: string | undefined;
  /** The card's element, for what measures against it. */
  ref?: Ref<HTMLElement> | undefined;
  children: ReactNode;
}): React.JSX.Element {
  // Note that the element is made rather than written, because a ref typed
  // for any of them is no ref for their union.
  return createElement(
    Element,
    {
      ...rest,
      ref,
      className: className === undefined ? "luke-card" : `luke-card ${className}`,
      "data-look": look,
      "data-corner": corner,
      "data-padding": padding,
      "data-dashed": dashed ? "true" : undefined,
    },
    children,
  );
}

/** A card's head: a line of muted caption words, a kind and where it stands, wrapping where the room runs out. */
export function CardHead({ children }: { children: ReactNode }): React.JSX.Element {
  return <div className="luke-card-head">{children}</div>;
}
