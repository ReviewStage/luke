import type { HTMLAttributes, ReactNode, Ref } from "react";
import { Card as ShadcnCard } from "../../shadcn/card.js";

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
 * set among a thread's lines or a transcript's is. It may stand over the page
 * on a shadow (`CARD_SHADOW`). A card a whole-card press covers (`CardPress`)
 * answers the pointer resting on it (`CARD_HOVER`), with a wash or by lifting
 * off its ground, and holds that look while what it opened stands (`lit`); the
 * press's own reach draws the pressed fill over it. A card a dragged row is
 * carried over wears `CARD_DROP_TARGET` while it is, and is ringed and washed.
 * It is the element its place reads it as (`CARD_ELEMENT`), and keeps its
 * owner's class only to be named and placed by it, never to be drawn.
 *
 * It is drawn by shadcn/ui's card (`../../shadcn/card.tsx`) in Tailwind
 * utilities over the theme, each choice's ground, edge, corner, and inset
 * picked here, so where two choices touch one property (a raised card's
 * corner and a menu's, a raised card's room past its edge and a flush
 * card's clip) the one that wins is said once, in `frameClass`.
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
 * folds open is; on the code's own ground, as a file's lines are; its edge
 * alone, on whatever ground it stands on; or sunk in the page's well with no
 * edge to see, as a board's column holds its cards.
 */
export const CARD_LOOK = {
  SURFACE: "surface",
  RAISED: "raised",
  TINT: "tint",
  CODE: "code",
  OUTLINE: "outline",
  WELL: "well",
} as const;

export type CardLook = (typeof CARD_LOOK)[keyof typeof CARD_LOOK];

/** A card's corner: a page's card's; a control's, for a card set among lines rather than on a page; or a menu's, for a card that stands over the page as a menu does. Note that a raised card wears the control's unless it wears the menu's. */
export const CARD_CORNER = {
  CARD: "card",
  CONTROL: "control",
  MENU: "menu",
} as const;

export type CardCorner = (typeof CARD_CORNER)[keyof typeof CARD_CORNER];

/** The elements a card may be, by what its place reads it as; a span stands in running words, as a picture's frame stands in a paragraph. */
export const CARD_ELEMENT = {
  DIV: "div",
  ARTICLE: "article",
  FIGURE: "figure",
  LI: "li",
  SECTION: "section",
  SPAN: "span",
} as const;

export type CardElement = (typeof CARD_ELEMENT)[keyof typeof CARD_ELEMENT];

/** The shadow a card stands on: none; a hairline's lift off the well it stands in, as a board's card; or a menu's, standing over the page, as an open comment thread or a summary drawn over its rail. */
export const CARD_SHADOW = {
  NONE: "none",
  SOFT: "soft",
  MENU: "menu",
} as const;

export type CardShadow = (typeof CARD_SHADOW)[keyof typeof CARD_SHADOW];

/**
 * How a card a whole-card press covers answers the pointer resting on it:
 * not at all; with the hover's wash laid over its ground, as a comment
 * thread at rest; or lifting, its edge strengthened and its shadow deepened,
 * as a board's card rises off its column.
 */
export const CARD_HOVER = {
  NONE: "none",
  WASH: "wash",
  LIFT: "lift",
} as const;

export type CardHover = (typeof CARD_HOVER)[keyof typeof CARD_HOVER];

/** What a card a dragged row is carried over wears while it is, set by the drag on the element itself. */
export const CARD_DROP_TARGET = "data-drop-target";

/** Each padding's room inside the edge. */
const PADDING_CLASS: Record<CardPadding, string> = {
  [CARD_PADDING.FLUSH]: "p-0",
  [CARD_PADDING.NONE]: "p-0",
  [CARD_PADDING.SNUG]: "px-card py-card-snug",
  [CARD_PADDING.COMPACT]: "px-card py-card-compact",
  [CARD_PADDING.REGULAR]: "p-card",
};

/**
 * Each look's ground and edge. Note that a well's edge is there but unseen,
 * so ringed as a drop target the card keeps its size, the ring fading in as
 * a hover does, unless the card lifts, whose own transition says it.
 */
const LOOK_CLASS: Record<CardLook, string> = {
  [CARD_LOOK.SURFACE]: "bg-card-surface border-border",
  [CARD_LOOK.RAISED]: "bg-background border-border-strong",
  [CARD_LOOK.TINT]: "bg-muted border-border",
  [CARD_LOOK.CODE]: "bg-card-code border-border",
  [CARD_LOOK.OUTLINE]: "bg-transparent border-border",
  [CARD_LOOK.WELL]: "bg-well border-transparent",
};

/** The shadow a card stands on, by `CARD_SHADOW`. */
const SHADOW_CLASS: Record<CardShadow, string> = {
  [CARD_SHADOW.NONE]: "",
  [CARD_SHADOW.SOFT]: "shadow-card-soft",
  [CARD_SHADOW.MENU]: "shadow-menu",
};

/**
 * How a card answers the pointer resting on it, or holds that look while
 * `lit`. Note that the wash is laid over the card's own ground as an image,
 * so a card on an opaque ground stays opaque under it and one with none
 * takes the wash alone; a card that lifts strengthens its edge and deepens
 * its shadow, its edge left to a drop target's ring while it is one.
 */
const HOVER_CLASS: Record<CardHover, string> = {
  [CARD_HOVER.NONE]: "",
  [CARD_HOVER.WASH]:
    "[&:is(:hover,[data-lit=true])]:bg-[linear-gradient(var(--color-muted),var(--color-muted))]",
  [CARD_HOVER.LIFT]:
    "[&:is(:hover,[data-lit=true]):not([data-drop-target=true])]:border-border-strong [&:is(:hover,[data-lit=true])]:shadow-card-lift",
};

/** The card a dragged row is carried over, ringed and washed, so it reads as the one the row will land in. */
const DROP_TARGET_CLASS =
  "data-[drop-target=true]:border-card-drop data-[drop-target=true]:bg-[linear-gradient(var(--color-muted),var(--color-muted))]";

/** A card's corner: a menu's where asked, else a raised card's smaller one, else the corner asked for. */
function cornerClass(look: CardLook, corner: CardCorner): string {
  if (corner === CARD_CORNER.MENU) return "rounded-menu";
  if (look === CARD_LOOK.RAISED) return "rounded-card-raised";
  return corner === CARD_CORNER.CONTROL ? "rounded-control" : "rounded-card";
}

/**
 * What a card does with what stands past its edge. Note that a raised card
 * lets it stand there, because its fields open their suggestion menus over
 * its top and a clip would hide their rows; a flush card clips what it
 * holds, because content drawn to its edge would otherwise paint square
 * corners over the card's round ones, without becoming a scroller, so a
 * focus inside never scrolls it, and draws a ring inside a card that clips
 * inside its control, where the clip cannot cut it.
 */
function overflowClass(look: CardLook, padding: CardPadding): string {
  if (look === CARD_LOOK.RAISED) return "overflow-visible";
  if (padding !== CARD_PADDING.FLUSH) return "";
  return "overflow-clip [--luke-focus-ring-offset:var(--luke-focus-ring-inset)]";
}

/** The edge's fade, a well's alone, since a card that lifts rides its own (`card.css`). */
function transitionClass(look: CardLook, hover: CardHover): string {
  if (look !== CARD_LOOK.WELL || hover === CARD_HOVER.LIFT) return "";
  return "transition-[border-color] duration-(--luke-duration-hover) ease-plain";
}

/** Every class a card's frame wears for the choices made, its owner's last. */
function frameClass(
  look: CardLook,
  corner: CardCorner,
  padding: CardPadding,
  shadow: CardShadow,
  hover: CardHover,
  dashed: boolean,
  className: string | undefined,
): string {
  return [
    "luke-card",
    LOOK_CLASS[look],
    cornerClass(look, corner),
    PADDING_CLASS[padding],
    overflowClass(look, padding),
    dashed ? "border-dashed" : "",
    SHADOW_CLASS[shadow],
    HOVER_CLASS[hover],
    DROP_TARGET_CLASS,
    transitionClass(look, hover),
    className ?? "",
  ]
    .filter((part) => part !== "")
    .join(" ");
}

/** `children` framed by a card, `padding` in from its edge. */
export function Card({
  as: Element = CARD_ELEMENT.DIV,
  look = CARD_LOOK.SURFACE,
  corner = CARD_CORNER.CARD,
  padding = CARD_PADDING.REGULAR,
  shadow = CARD_SHADOW.NONE,
  hover = CARD_HOVER.NONE,
  lit = false,
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
  shadow?: CardShadow;
  /** How it answers the pointer resting on it, where a press covers it. */
  hover?: CardHover;
  /** Whether it holds its hover's look with no pointer on it, as while the menu it opened stands or its words are pointed at elsewhere. */
  lit?: boolean | undefined;
  /** Whether its edge is dashed, as the frame of what is missing is. */
  dashed?: boolean | undefined;
  /** The owner's own class, which names and places it and sets nothing of its frame. */
  className?: string | undefined;
  /** The card's element, for what measures against it. */
  ref?: Ref<HTMLElement> | undefined;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <ShadcnCard
      {...rest}
      as={Element}
      ref={ref}
      className={frameClass(look, corner, padding, shadow, hover, dashed, className)}
      data-look={look}
      data-corner={corner}
      data-padding={padding}
      data-shadow={shadow === CARD_SHADOW.NONE ? undefined : shadow}
      data-hover={hover === CARD_HOVER.NONE ? undefined : hover}
      data-lit={lit ? "true" : undefined}
      data-dashed={dashed ? "true" : undefined}
    >
      {children}
    </ShadcnCard>
  );
}

/** A card's head: a line of muted caption words, a kind and where it stands, wrapping where the room runs out. */
export function CardHead({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <div className="luke-card-head flex min-h-control min-w-0 flex-wrap items-center justify-between gap-x-card-head-gap gap-y-card-head-block px-card-head-inline py-card-head-block text-group font-group text-muted-foreground">
      {children}
    </div>
  );
}
