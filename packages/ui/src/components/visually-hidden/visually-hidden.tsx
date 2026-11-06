import type { HTMLAttributes, ReactNode } from "react";

export const VISUALLY_HIDDEN_ELEMENT = {
  SPAN: "span",
  P: "p",
  LEGEND: "legend",
} as const;

export type VisuallyHiddenElement =
  (typeof VISUALLY_HIDDEN_ELEMENT)[keyof typeof VISUALLY_HIDDEN_ELEMENT];

export const VISUALLY_HIDDEN_UNDER = {
  SNUG: "snug",
  TIGHT: "tight",
} as const;

export type VisuallyHiddenUnder =
  (typeof VISUALLY_HIDDEN_UNDER)[keyof typeof VISUALLY_HIDDEN_UNDER];

const UNDER_CLASS = {
  [VISUALLY_HIDDEN_UNDER.SNUG]: "@max-[520px]/ui-room:sr-only",
  [VISUALLY_HIDDEN_UNDER.TIGHT]: "@max-[440px]/ui-room:sr-only",
} as const satisfies Record<VisuallyHiddenUnder, string>;

export function VisuallyHidden({
  as: Element = VISUALLY_HIDDEN_ELEMENT.SPAN,
  under,
  children,
  ...attributes
}: {
  as?: VisuallyHiddenElement;
  under?: VisuallyHiddenUnder | undefined;
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, "children" | "className">): React.JSX.Element {
  return (
    <Element
      {...attributes}
      className={
        under === undefined ? "ui-visually-hidden" : `ui-visually-hidden ${UNDER_CLASS[under]}`
      }
      data-under={under}
    >
      {children}
    </Element>
  );
}
