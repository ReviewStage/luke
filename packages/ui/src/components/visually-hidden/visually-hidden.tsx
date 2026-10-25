/**
 * visually-hidden.tsx -- words read by assistive tech and drawn nowhere.
 *
 * A control says its state in a glyph, a ring, or a colour; these are the
 * words behind it that a screen reader speaks. The element is chosen by what
 * the words are (a `legend` names a fieldset, a `p` or a `span` with a live
 * `role` announces a change), and the words stay in the page, so a copy or a
 * find still reaches them.
 *
 * Words may also give way only while the room around them is narrow
 * (`under`): drawn as any words beside a glyph that says them again, and
 * read, but not drawn, once the nearest `luke-room` container (a card, a
 * header) is narrower than the step. The container names itself
 * `luke-room` beside its own name (`container: card luke-room / inline-size`).
 *
 * Words hidden outright wear `luke-visually-hidden`, whose rule
 * (`visually-hidden.css`) other components put on words of their own; words
 * given a step are hidden by Tailwind's `sr-only` under that container
 * width.
 */

import type { HTMLAttributes, ReactNode } from "react";

/** The elements hidden words may stand in. */
export const VISUALLY_HIDDEN_ELEMENT = {
  SPAN: "span",
  P: "p",
  LEGEND: "legend",
} as const;

export type VisuallyHiddenElement =
  (typeof VISUALLY_HIDDEN_ELEMENT)[keyof typeof VISUALLY_HIDDEN_ELEMENT];

/** How narrow a `luke-room` container must be before words given an `under` step are no longer drawn: a snug room, or a tight one. */
export const VISUALLY_HIDDEN_UNDER = {
  SNUG: "snug",
  TIGHT: "tight",
} as const;

export type VisuallyHiddenUnder =
  (typeof VISUALLY_HIDDEN_UNDER)[keyof typeof VISUALLY_HIDDEN_UNDER];

/** The container query each step hides its words under: a snug room, 520px, and a tight one, 440px, the lines `Badge` gives its words up at. */
const UNDER_CLASS = {
  [VISUALLY_HIDDEN_UNDER.SNUG]: "@max-[520px]/luke-room:sr-only",
  [VISUALLY_HIDDEN_UNDER.TIGHT]: "@max-[440px]/luke-room:sr-only",
} as const satisfies Record<VisuallyHiddenUnder, string>;

/** `children` spoken and not drawn, in `as`, a span unless asked. */
export function VisuallyHidden({
  as: Element = VISUALLY_HIDDEN_ELEMENT.SPAN,
  under,
  children,
  ...attributes
}: {
  as?: VisuallyHiddenElement;
  /** Draw the words until the room around them is narrower than this step, rather than never. */
  under?: VisuallyHiddenUnder | undefined;
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, "children" | "className">): React.JSX.Element {
  return (
    <Element
      {...attributes}
      className={
        under === undefined ? "luke-visually-hidden" : `luke-visually-hidden ${UNDER_CLASS[under]}`
      }
      data-under={under}
    >
      {children}
    </Element>
  );
}
