import {
  createElement,
  type HTMLAttributes,
  type PointerEventHandler,
  type ReactNode,
  type Ref,
  type SyntheticEvent,
} from "react";
import { motionRows } from "../list-motion/list-motion.js";

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
 * An arrangement that is a list (`as` a `ul` or `ol`) may move its rows as
 * they arrive, leave, and change places (`moves`, under a `ListMotion`), and
 * take the press that starts a drag of one of them (`onPointerDown`). The
 * room inside its edge is a named place too (`INSET`), for a list whose
 * rows stand in a scroller or a column rather than against its edge.
 *
 * A Fill is a region rather than an arrangement of items: it takes the room
 * its own column leaves and lays what it holds one under another, or beside
 * (`FILL_FLOW.ROW`), as a page fills its pane and a pane's body fills it.
 * It may clip what stands past its edges, with `clip` rather than `hidden`,
 * so a pane sliding through it never scrolls it. Its owner places it and
 * names it by its own class, never restyling the fill itself.
 */

/** The room between items, by what they are: from none, through a list's rows and a glyph and its words, to two sections. */
export const GAP = {
  NONE: "none",
  /** A list's rows, as a list of rows stands them (`--luke-list-gap`). */
  ROW: "row",
  TIGHT: "tight",
  /** A list's items that each stand as a box of their own: cards, threads, people. */
  ITEM: "item",
  ICON: "icon",
  CONTROL: "control",
  FIELD: "field",
  /** Blocks of words one under another, as comments in a thread stand. */
  BLOCK: "block",
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

/**
 * The room an arrangement keeps inside its own edge, by where it stands:
 * none; the keyboard ring's reach, so a row's ring is not cut by the
 * scroller the list stands in; a column's edge to the rows it holds; or a
 * block of items set in a card, a step less over and under than either side.
 */
export const INSET = {
  NONE: "none",
  RING: "ring",
  COLUMN: "column",
  BLOCK: "block",
} as const;

export type Inset = (typeof INSET)[keyof typeof INSET];

/** The elements an arrangement may be, by what it groups. */
export const LAYOUT_ELEMENT = {
  DIV: "div",
  SECTION: "section",
  UL: "ul",
  OL: "ol",
  LI: "li",
  FORM: "form",
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
  inset?: Inset;
  as?: LayoutElement;
  /** The id a region is named by, or names another with. */
  id?: string | undefined;
  /** The name of a list or a region, where nothing visible names it. */
  "aria-label"?: string | undefined;
  "aria-labelledby"?: string | undefined;
  /** What a submit does, on an Inline that is a `form`. */
  onSubmit?: (event: SyntheticEvent) => void;
  /** The owner's own class, which names it for what it holds and sets nothing of its arrangement. */
  className?: string | undefined;
  /** Whether a list's rows move as they arrive, leave, and change places, under a `ListMotion` (`motionRows`). */
  moves?: boolean | undefined;
  /** A press on a list, where a press on a row's handle starts a drag that reorders its rows. */
  onPointerDown?: PointerEventHandler<HTMLElement> | undefined;
  /** Whether it stands out of the layout and out of reach, as a list with nothing in it yet does. */
  hidden?: boolean | undefined;
  /** The element, for an owner that measures it or finds its rows; a `data-` attribute its owner's script reads it by passes through as it is. */
  ref?: Ref<HTMLElement> | undefined;
  children: ReactNode;
}

/** The class an arrangement wears, its owner's after its own. */
function layoutClass(own: string, owner: string | undefined): string {
  return owner === undefined ? own : `${own} ${owner}`;
}

/** What it holds, one under another, `gap` apart, each as wide as the Stack unless aligned otherwise. */
export function Stack({
  gap = GAP.FIELD,
  align = ALIGN.STRETCH,
  justify = JUSTIFY.START,
  inset = INSET.NONE,
  as: Element = LAYOUT_ELEMENT.DIV,
  className,
  moves = false,
  children,
  ...named
}: LayoutProps): React.JSX.Element {
  // Note that the element is made rather than written, because a ref typed
  // for any of the elements is no ref for their union.
  return createElement(
    Element,
    {
      ...named,
      className: layoutClass("luke-stack", className),
      role: listRole(Element),
      ...(moves ? motionRows() : {}),
      "data-gap": gap,
      "data-align": align,
      "data-justify": justify,
      "data-inset": inset === INSET.NONE ? undefined : inset,
    },
    children,
  );
}

/** What it holds, one beside another, `gap` apart, wrapping onto a new line where the room runs out unless `wrap` is off. */
export function Inline({
  gap = GAP.CONTROL,
  align = ALIGN.CENTER,
  justify = JUSTIFY.START,
  wrap = true,
  grow = false,
  growFirst = false,
  inset = INSET.NONE,
  as: Element = LAYOUT_ELEMENT.DIV,
  className,
  moves = false,
  children,
  ...named
}: LayoutProps & {
  wrap?: boolean;
  /** Whether it takes the room its line leaves, down to a field's least width, where it wraps. */
  grow?: boolean;
  /** Whether its first item takes the room the others leave, as a field does beside its presses. */
  growFirst?: boolean;
}): React.JSX.Element {
  // Note that the element is made rather than written, as a Stack's is.
  return createElement(
    Element,
    {
      ...named,
      className: layoutClass("luke-inline", className),
      role: listRole(Element),
      ...(moves ? motionRows() : {}),
      "data-gap": gap,
      "data-align": align,
      "data-justify": justify,
      "data-wrap": wrap,
      "data-grow": grow ? "" : undefined,
      "data-grow-first": growFirst ? "" : undefined,
      "data-inset": inset === INSET.NONE ? undefined : inset,
    },
    children,
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
