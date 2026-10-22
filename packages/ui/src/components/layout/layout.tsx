import { createElement, type HTMLAttributes, type ReactNode, type Ref } from "react";

/**
 * layout.tsx -- the two arrangements every container is built from: a Stack sets what it holds one under another, an Inline one beside another.
 *
 * The room between items is a named role, never a length picked at a call
 * site, so an Inline of controls is the profile's control gap apart and a
 * Stack of fields its field gap, and both move together when a profile does.
 * Where an Inline runs out of room it wraps, unless told to hold its line;
 * either way an item may shrink, so a long label gives way before the row
 * overflows its container.
 *
 * A Fill is a region rather than an arrangement of items: it takes the room
 * its own column leaves and lays what it holds one under another, or beside
 * (`FILL_FLOW.ROW`), as a page fills its pane and a pane's body fills it.
 * It may clip what stands past its edges, with `clip` rather than `hidden`,
 * so a pane sliding through it never scrolls it. Its owner places it and
 * names it by its own class, never restyling the fill itself.
 */

/** The room between items, by what they are: from none, through a glyph and its words, to two sections. */
export const GAP = {
  NONE: "none",
  TIGHT: "tight",
  ICON: "icon",
  CONTROL: "control",
  FIELD: "field",
  SECTION: "section",
  LOOSE: "loose",
} as const;

export type Gap = (typeof GAP)[keyof typeof GAP];

/** Where items stand across the arrangement: at its start, its centre, its end, on one baseline, or filling it. */
export const ALIGN = {
  START: "start",
  CENTER: "center",
  END: "end",
  BASELINE: "baseline",
  STRETCH: "stretch",
} as const;

export type Align = (typeof ALIGN)[keyof typeof ALIGN];

/** Where items stand along the arrangement: packed at its start, centre, or end, or spread to both ends. */
export const JUSTIFY = {
  START: "start",
  CENTER: "center",
  END: "end",
  BETWEEN: "between",
} as const;

export type Justify = (typeof JUSTIFY)[keyof typeof JUSTIFY];

/** The elements an arrangement may be, by what it groups. */
export const LAYOUT_ELEMENT = {
  DIV: "div",
  SECTION: "section",
  UL: "ul",
  OL: "ol",
  LI: "li",
} as const;

export type LayoutElement = (typeof LAYOUT_ELEMENT)[keyof typeof LAYOUT_ELEMENT];

/**
 * The role a list keeps once its markers are gone: Safari's VoiceOver stops
 * reading a list styled without them as a list unless it says so.
 */
function listRole(element: LayoutElement): "list" | undefined {
  return element === LAYOUT_ELEMENT.UL || element === LAYOUT_ELEMENT.OL ? "list" : undefined;
}

interface LayoutProps {
  gap?: Gap;
  align?: Align;
  justify?: Justify;
  as?: LayoutElement;
  /** The id a region is named by, or names another with. */
  id?: string | undefined;
  /** The name of a list or a region, where nothing visible names it. */
  "aria-label"?: string | undefined;
  "aria-labelledby"?: string | undefined;
  children: ReactNode;
}

/** What it holds, one under another, `gap` apart, each as wide as the Stack unless aligned otherwise. */
export function Stack({
  gap = GAP.FIELD,
  align = ALIGN.STRETCH,
  justify = JUSTIFY.START,
  as: Element = LAYOUT_ELEMENT.DIV,
  children,
  ...named
}: LayoutProps): React.JSX.Element {
  return (
    <Element
      className="luke-stack"
      role={listRole(Element)}
      data-gap={gap}
      data-align={align}
      data-justify={justify}
      {...named}
    >
      {children}
    </Element>
  );
}

/** What it holds, one beside another, `gap` apart, wrapping onto a new line where the room runs out unless `wrap` is off. */
export function Inline({
  gap = GAP.CONTROL,
  align = ALIGN.CENTER,
  justify = JUSTIFY.START,
  wrap = true,
  as: Element = LAYOUT_ELEMENT.DIV,
  children,
  ...named
}: LayoutProps & { wrap?: boolean }): React.JSX.Element {
  return (
    <Element
      className="luke-inline"
      role={listRole(Element)}
      data-gap={gap}
      data-align={align}
      data-justify={justify}
      data-wrap={wrap}
      {...named}
    >
      {children}
    </Element>
  );
}

/** Which way a Fill lays what it holds: one under another, or one beside another. */
export const FILL_FLOW = {
  COLUMN: "column",
  ROW: "row",
} as const;

export type FillFlow = (typeof FILL_FLOW)[keyof typeof FILL_FLOW];

/** The elements a Fill may be, by the region it is. */
export const FILL_ELEMENT = {
  DIV: "div",
  SECTION: "section",
  ARTICLE: "article",
} as const;

export type FillElement = (typeof FILL_ELEMENT)[keyof typeof FILL_ELEMENT];

/** A region taking the room its column leaves, laying what it holds in `flow`, clipping past its edges where `clip`. */
export function Fill({
  as: Element = FILL_ELEMENT.DIV,
  flow = FILL_FLOW.COLUMN,
  clip = false,
  className,
  ref,
  children,
  ...rest
}: Omit<HTMLAttributes<HTMLElement>, "className"> & {
  as?: FillElement;
  flow?: FillFlow;
  /** Whether what stands past its edges is cut off there, as a pane sliding through it is. */
  clip?: boolean;
  /** The owner's own class, which names and places it and sets nothing of its fill. */
  className?: string | undefined;
  ref?: Ref<HTMLElement> | undefined;
  children?: ReactNode;
}): React.JSX.Element {
  // Note that the element is made rather than written, because a ref typed
  // for any of the three is no ref for their union.
  return createElement(
    Element,
    {
      ...rest,
      ref,
      className: className === undefined ? "luke-fill" : `luke-fill ${className}`,
      "data-flow": flow,
      "data-clip": clip ? "true" : undefined,
    },
    children,
  );
}
