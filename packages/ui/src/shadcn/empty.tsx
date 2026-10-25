import type * as React from "react";
import { cn } from "../cn.js";

/**
 * empty.tsx -- shadcn/ui's empty (style `base-nova`), vendored and drawn as Luke's empty state: the place's glyph, its heading and line, and the way on, centred in the room the place leaves.
 *
 * The component is shadcn's own source, kept as close to it as the window
 * allows, so a later `shadcn add empty` reads as a small diff. Its local
 * changes:
 *
 * - `Empty` is the centred block alone, at Luke's measure
 *   (`max-w-empty-state`), inset, and gap, with no width, flex share,
 *   dashed edge, corner, or `text-balance` of its own, because the room it
 *   stands in, which shares its space above and below two to three, is
 *   `@luke/ui`'s `EmptyState` (`components/empty-state/`), and its words
 *   wrap as a paragraph's do.
 * - `EmptyHeader` is the heading and the line together, at the item gap
 *   between them, with no measure of its own, since the block's is the
 *   measure; and `EmptyMedia`'s one look is Luke's glyph, large and fainter
 *   than the muted ink, its stroke thinned (no `variant`, and no `mb-2`,
 *   since the block's gap stands between it and the words).
 * - `EmptyTitle`, `EmptyDescription`, and `EmptyContent` are dropped,
 *   because the heading and the line are `@luke/ui`'s `Text` in their roles,
 *   and the ways on stand in the block itself, a gap under the words.
 * - Each part keeps the `luke-empty-state-*` class it wore before the move,
 *   which other sheets and tests find it by.
 */

function Empty({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty"
      className={cn(
        "luke-empty-state-body m-auto box-border flex max-w-empty-state flex-col items-center gap-luke-12 p-luke-24 text-center",
        className,
      )}
      {...props}
    />
  );
}

function EmptyHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-header"
      className={cn("luke-empty-state-words flex flex-col gap-luke-4", className)}
      {...props}
    />
  );
}

function EmptyMedia({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="empty-icon"
      className={cn(
        "luke-empty-state-icon flex text-muted-foreground opacity-60 [&_svg]:size-luke-40 [&_svg]:stroke-[1.4]",
        className,
      )}
      {...props}
    />
  );
}

export { Empty, EmptyHeader, EmptyMedia };
