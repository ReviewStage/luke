/**
 * visually-hidden.tsx -- words read by assistive tech and drawn nowhere.
 *
 * A control says its state in a glyph, a ring, or a colour; these are the
 * words behind it that a screen reader speaks. The element is chosen by what
 * the words are (a `legend` names a fieldset, a `p` or a `span` with a live
 * `role` announces a change), and the words stay in the page, so a copy or a
 * find still reaches them.
 */

import type { HTMLAttributes, ReactNode } from "react";

/** The elements hidden words may stand in. */
export const VISUALLY_HIDDEN_ELEMENT = {
  SPAN: "span",
  P: "p",
  H2: "h2",
  LEGEND: "legend",
} as const;

export type VisuallyHiddenElement =
  (typeof VISUALLY_HIDDEN_ELEMENT)[keyof typeof VISUALLY_HIDDEN_ELEMENT];

/** `children` spoken and not drawn, in `as`, a span unless asked. */
export function VisuallyHidden({
  as: Element = VISUALLY_HIDDEN_ELEMENT.SPAN,
  children,
  ...attributes
}: {
  as?: VisuallyHiddenElement;
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, "children" | "className">): React.JSX.Element {
  return (
    <Element {...attributes} className="luke-visually-hidden">
      {children}
    </Element>
  );
}
