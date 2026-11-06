import {
  createElement,
  type HTMLAttributes,
  type PointerEventHandler,
  type ReactNode,
  type Ref,
  type SyntheticEvent,
} from "react";
import { cn } from "../../cn.js";
import { motionRows } from "../list-motion/list-motion.js";

export const GAP = {
  NONE: "none",
  ROW: "row",
  TIGHT: "tight",
  ITEM: "item",
  ICON: "icon",
  CONTROL: "control",
  FIELD: "field",
  BLOCK: "block",
  SECTION: "section",
  PAGE: "page",
} as const;

export type Gap = (typeof GAP)[keyof typeof GAP];

export const ALIGN = {
  START: "start",
  CENTER: "center",
  END: "end",
  BASELINE: "baseline",
  STRETCH: "stretch",
} as const;

export type Align = (typeof ALIGN)[keyof typeof ALIGN];

export const JUSTIFY = {
  START: "start",
  END: "end",
  BETWEEN: "between",
} as const;

export type Justify = (typeof JUSTIFY)[keyof typeof JUSTIFY];

export const INSET = {
  NONE: "none",
  RING: "ring",
  COLUMN: "column",
  BLOCK: "block",
} as const;

export type Inset = (typeof INSET)[keyof typeof INSET];

export const LAYOUT_ELEMENT = {
  DIV: "div",
  UL: "ul",
  OL: "ol",
  FORM: "form",
} as const;

export type LayoutElement = (typeof LAYOUT_ELEMENT)[keyof typeof LAYOUT_ELEMENT];

const GAP_CLASS: Record<Gap, string> = {
  [GAP.NONE]: "gap-0",
  [GAP.ROW]: "gap-list-gap",
  [GAP.TIGHT]: "gap-tight-gap",
  [GAP.ITEM]: "gap-item-gap",
  [GAP.ICON]: "gap-icon-gap",
  [GAP.CONTROL]: "gap-control-gap",
  [GAP.FIELD]: "gap-field-gap",
  [GAP.BLOCK]: "gap-block-gap",
  [GAP.SECTION]: "gap-section-gap",
  [GAP.PAGE]: "gap-page-section-gap",
};

const ALIGN_CLASS: Record<Align, string> = {
  [ALIGN.START]: "items-start",
  [ALIGN.CENTER]: "items-center",
  [ALIGN.END]: "items-end",
  [ALIGN.BASELINE]: "items-baseline",
  [ALIGN.STRETCH]: "items-stretch",
};

const JUSTIFY_CLASS: Record<Justify, string> = {
  [JUSTIFY.START]: "justify-start",
  [JUSTIFY.END]: "justify-end",
  [JUSTIFY.BETWEEN]: "justify-between",
};

const INSET_CLASS: Record<Inset, string> = {
  [INSET.NONE]: "p-0",
  [INSET.RING]: "p-ring-reach",
  [INSET.COLUMN]: "p-list-inset",
  [INSET.BLOCK]: "px-list-inset py-row-inset",
};

const ARRANGEMENT_CLASS = "flex min-w-0 m-0 list-none [&[hidden]]:hidden";

function listRole(element: LayoutElement): "list" | undefined {
  return element === LAYOUT_ELEMENT.UL || element === LAYOUT_ELEMENT.OL ? "list" : undefined;
}

function browserUnchecked(element: LayoutElement): true | undefined {
  return element === LAYOUT_ELEMENT.FORM ? true : undefined;
}

interface LayoutProps {
  gap?: Gap;
  align?: Align;
  justify?: Justify;
  inset?: Inset;
  as?: LayoutElement;
  id?: string | undefined;
  "aria-label"?: string | undefined;
  "aria-labelledby"?: string | undefined;
  onSubmit?: (event: SyntheticEvent) => void;
  className?: string | undefined;
  moves?: boolean | undefined;
  onPointerDown?: PointerEventHandler<HTMLElement> | undefined;
  hidden?: boolean | undefined;
  ref?: Ref<HTMLElement> | undefined;
  children: ReactNode;
}

function layoutClass(
  own: string,
  gap: Gap,
  align: Align,
  justify: Justify,
  inset: Inset,
  owner: string | undefined,
): string {
  return cn(
    own,
    ARRANGEMENT_CLASS,
    GAP_CLASS[gap],
    ALIGN_CLASS[align],
    JUSTIFY_CLASS[justify],
    INSET_CLASS[inset],
    owner,
  );
}

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
  return createElement(
    Element,
    {
      ...named,
      className: layoutClass("ui-stack flex-col", gap, align, justify, inset, className),
      role: listRole(Element),
      noValidate: browserUnchecked(Element),
      ...(moves ? motionRows() : {}),
      "data-gap": gap,
      "data-align": align,
      "data-justify": justify,
      "data-inset": inset === INSET.NONE ? undefined : inset,
    },
    children,
  );
}

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
  grow?: boolean;
  growFirst?: boolean;
}): React.JSX.Element {
  return createElement(
    Element,
    {
      ...named,
      className: layoutClass(
        cn("ui-inline", wrap && "flex-wrap", grow && "grow shrink basis-field-least"),
        gap,
        align,
        justify,
        inset,
        className,
      ),
      role: listRole(Element),
      noValidate: browserUnchecked(Element),
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

export const FILL_FLOW = {
  COLUMN: "column",
  ROW: "row",
} as const;

export type FillFlow = (typeof FILL_FLOW)[keyof typeof FILL_FLOW];

export const FILL_ELEMENT = {
  DIV: "div",
  SECTION: "section",
  ARTICLE: "article",
} as const;

export type FillElement = (typeof FILL_ELEMENT)[keyof typeof FILL_ELEMENT];

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
  clip?: boolean;
  className?: string | undefined;
  ref?: Ref<HTMLElement> | undefined;
  children?: ReactNode;
}): React.JSX.Element {
  return createElement(
    Element,
    {
      ...rest,
      ref,
      className: cn(
        "ui-fill flex min-h-0 min-w-0 flex-1",
        flow === FILL_FLOW.ROW ? "flex-row" : "flex-col",
        clip && "overflow-clip",
        className,
      ),
      "data-flow": flow,
      "data-clip": clip ? "true" : undefined,
    },
    children,
  );
}
