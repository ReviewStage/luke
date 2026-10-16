import type { ReactNode } from "react";

/**
 * layout.tsx -- the two arrangements every container is built from: a Stack sets what it holds one under another, an Inline one beside another.
 *
 * The room between items is a named role, never a length picked at a call
 * site, so an Inline of controls is the profile's control gap apart and a
 * Stack of fields its field gap, and both move together when a profile does.
 * Where an Inline runs out of room it wraps, unless told to hold its line;
 * either way an item may shrink, so a long label gives way before the row
 * overflows its container.
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
