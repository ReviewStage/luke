import type { ComponentProps } from "react";
import { cn } from "../cn.js";

/**
 * skeleton.tsx -- shadcn/ui's skeleton (style `base-nova`), vendored and drawn as Luke's loading block.
 *
 * The component is shadcn's own source, kept as close to it as the window
 * allows, so a later `shadcn add skeleton` reads as a small diff. Its local
 * changes: it is a `span` rather than a `div`, because a block stands in a
 * line of words, a heading's or a paragraph's, as well as in a box, drawn
 * as a block no wider than its line; its ground is the strong fill
 * rather than `muted`, the hover's wash, which reads as no block on a card;
 * its corner is the one its shape picks (`@luke/ui`'s `Skeleton`,
 * `components/skeleton/`) rather than `rounded-md`; and it breathes on
 * Luke's own opacity loop, the `luke-skeleton` keyframes held still by
 * `--luke-loop-motion` (`components/skeleton/skeleton.css`), rather than on
 * `animate-pulse`, whose loop runs on through reduced motion and a capture
 * run. It is named `SkeletonBlock` rather than `Skeleton`, because the
 * root lint rule `anti-slop/skeleton-through-components` holds a component
 * named `*Skeleton` to classes naming themselves a skeleton's, and this is
 * the one element every skeleton's block is drawn with.
 */

function SkeletonBlock({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="skeleton"
      className={cn("block max-w-full bg-secondary", className)}
      {...props}
    />
  );
}

export { SkeletonBlock };
