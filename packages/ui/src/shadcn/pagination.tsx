import type * as React from "react";
import { cn } from "../cn.js";

/**
 * pagination.tsx -- shadcn/ui's pagination (style `base-nova`), vendored in part: the row and its elision, drawn in Luke's caption figures.
 *
 * The parts kept are shadcn's own source, as close to it as the window
 * allows, so a later `shadcn add pagination` reads as a small diff. Only the
 * nav, its list, and its ellipsis are vendored; shadcn's `PaginationLink`,
 * `PaginationPrevious`, and `PaginationNext` are dropped, because they draw
 * through shadcn's `button.tsx`, and a step here is a plain link to its
 * page's address, drawn by `@luke/ui`'s `Pagination`
 * (`components/pagination/pagination.tsx`) in `PAGINATION_ITEM`'s classes.
 * Its local changes:
 *
 * - `Pagination` is the list too: shadcn's `PaginationContent` (`<ul>`) and
 *   `PaginationItem` (`<li>`) are folded into the nav, which holds its steps
 *   and numbers as children of its own, as the row always has, so a reader
 *   meets each item as a link or a figure rather than a list item. Its
 *   `role="navigation"` and English `aria-label` are dropped, because a
 *   `<nav>` is the landmark already and its caller names it.
 * - The row is Luke's: its items a small step apart, and without numbers
 *   (no `data-numbered`) its two steps at either end of the row, rather
 *   than shadcn's centred row.
 * - `PaginationEllipsis` draws the "…" the caller hands it, read as it is,
 *   dimmed (`data-idle`), rather than lucide's glyph hidden beside a
 *   "More pages" for readers, because no icon library rides in `@luke/ui`
 *   and the elision says itself.
 * - `PAGINATION_ITEM` is every item's box: as tall as the caption's line and
 *   its inset either side, and at least as wide, with an edge whether or not
 *   it draws one, so the held page's ruled box takes no more room than a
 *   link; lit under the pointer (a link's alone), the current page held in a
 *   ruled box, and an item with nowhere to go dimmed. Its hover is
 *   `[a&:hover]` rather than `hover:`, because Tailwind's `hover:` asks for
 *   a pointer that hovers, and a link lights under a tap too, as it always
 *   has. It never goes through `cn`, because no caller's class settles
 *   against it.
 */

/** Every item's box: a step, a page's number, the current page, or an elision. */
export const PAGINATION_ITEM =
  "luke-pagination-item box-border inline-flex h-pagination-item min-w-pagination-item items-center justify-center rounded-control border border-transparent px-pagination-item-inset font-mono text-caption text-muted-foreground no-underline whitespace-nowrap transition-[background-color,color] duration-(--luke-duration-hover) ease-plain [a&:hover]:bg-muted [a&:hover]:text-foreground aria-[current=page]:border-border aria-[current=page]:bg-muted aria-[current=page]:font-emphasis aria-[current=page]:text-foreground data-[idle=true]:opacity-disabled";

function Pagination({ className, ...props }: React.ComponentProps<"nav">) {
  return (
    <nav
      data-slot="pagination"
      className={cn(
        "luke-pagination flex items-center gap-pagination-gap not-data-[numbered=true]:justify-between not-data-[numbered=true]:gap-pagination-steps-gap",
        className,
      )}
      {...props}
    />
  );
}

function PaginationEllipsis({ ...props }: React.ComponentProps<"span">) {
  return (
    <span data-slot="pagination-ellipsis" data-idle="true" className={PAGINATION_ITEM} {...props} />
  );
}

export { Pagination, PaginationEllipsis };
