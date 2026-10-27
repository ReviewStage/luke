import { createElement, type HTMLAttributes, type Ref } from "react";
import { cn } from "../cn.js";

/**
 * card.tsx -- shadcn/ui's card (style `base-nova`), vendored and drawn as Luke's card frame.
 *
 * The component is shadcn's own source, kept as close to it as the window
 * allows, so a later `shadcn add card` reads as a small diff. Its local
 * changes: it is made as whichever element its place reads it as (`as`),
 * since a card stands as a list's item, a figure, or a span in running
 * words as well as a `div`; it is a positioned block, the containing block
 * of what is hung on it, rather than a flex column with a gap of its own,
 * because what it holds sets itself; it has no `size` prop, no type or ink
 * of its own, and no ring, since its edge is a border in the hairline ink,
 * which a dragged row's ring recolours; and its ground, corner, and inset
 * are the ones `@luke/ui`'s `Card` (`components/card/`) picks for each look,
 * corner, and padding, rather than `bg-card`, `rounded-xl`, and a spacing
 * of its own. Its `CardHeader`, `CardTitle`, `CardDescription`,
 * `CardAction`, `CardContent`, and `CardFooter` are dropped, because
 * nothing draws them: a card's content is its caller's, and its one head is
 * `@luke/ui`'s `CardHead`.
 */

/** The elements a card may be made as. */
type CardElement = "div" | "article" | "figure" | "li" | "section" | "span";

function Card({
  as = "div",
  className,
  ...props
}: HTMLAttributes<HTMLElement> & {
  as?: CardElement | undefined;
  ref?: Ref<HTMLElement> | undefined;
}) {
  return createElement(as, {
    "data-slot": "card",
    className: cn("relative block border", className),
    ...props,
  });
}

export { Card };
