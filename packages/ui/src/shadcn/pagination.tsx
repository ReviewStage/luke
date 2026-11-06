import type * as React from "react";
import { cn } from "../cn.js";

export const PAGINATION_ITEM =
  "ui-pagination-item box-border inline-flex h-pagination-item min-w-pagination-item items-center justify-center rounded-control border border-transparent px-pagination-item-inset font-mono text-caption text-muted-foreground no-underline whitespace-nowrap transition-[background-color,color] duration-(--ui-duration-hover) ease-plain [@media(hover:hover)]:[a&:hover]:bg-muted [@media(hover:hover)]:[a&:hover]:text-foreground [a&:active]:bg-muted [a&:active]:text-foreground aria-[current=page]:border-border aria-[current=page]:bg-muted aria-[current=page]:font-emphasis aria-[current=page]:text-foreground data-[idle=true]:opacity-disabled";

function Pagination({ className, ...props }: React.ComponentProps<"nav">) {
  return (
    <nav
      data-slot="pagination"
      className={cn(
        "ui-pagination flex items-center gap-pagination-gap not-data-[numbered=true]:justify-between not-data-[numbered=true]:gap-pagination-steps-gap",
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
