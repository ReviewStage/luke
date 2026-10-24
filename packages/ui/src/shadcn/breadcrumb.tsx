import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import type * as React from "react";
import { cn } from "../cn.js";

/**
 * breadcrumb.tsx -- shadcn/ui's breadcrumb (style `base-nova`, on Base UI), vendored and drawn in Luke's path.
 *
 * The component is shadcn's own source, kept as close to it as the window
 * allows, so a later `shadcn add breadcrumb` reads as a small diff. Its
 * local changes:
 *
 * - `Breadcrumb` takes its name from the caller alone, since a path names
 *   itself ("Path").
 * - `BreadcrumbList` keeps its crumbs on one row, unwrapped, with no gap,
 *   type, or ink of its own, because a bar's path narrows crumb by crumb
 *   rather than wrapping and its look names its own spacing and type.
 * - `BreadcrumbItem` sets no display: `breadcrumbs.css` draws an item as a
 *   flex row and hides it at the bar's widths it is not drawn at, which a
 *   utility would outrank; and it sets no gap, which the toolbar's heading
 *   alone takes.
 * - `BreadcrumbLink` is the crumb's quiet pill a press reaches, rendered as
 *   a native button by its caller: the pill's padding, radius, and muted ink,
 *   lit in the selected fill under the pointer and while what it opens
 *   stands open, and drawn in the text ink while it is the current page. Its
 *   hover is a plain `:hover`, as the pill's was, rather than Tailwind's
 *   hover-capable one.
 * - `BreadcrumbPage` is a crumb of words: it says it is the current page
 *   only where the caller says so, and takes no `role="link"` or
 *   `aria-disabled`, because a crumb of words is words; its weight is
 *   inherited; and its classes are joined, not merged, because
 *   tailwind-merge reads a type role (`text-dialog`) as an ink and would drop
 *   the words' own ink beside it.
 * - `BreadcrumbSeparator` is a `span` inside the crumb after it rather than
 *   an `li` of its own, so a crumb and its chevron come and go together and
 *   the list's items are its crumbs alone; its chevron is lucide's
 *   `chevron-right` drawn inline, the package taking no icon library.
 * - `BreadcrumbEllipsis` is left out: a path's "…" is a crumb of its own,
 *   a press naming the folders it stands for.
 *
 * `@luke/ui`'s `Breadcrumbs` (`components/breadcrumbs/breadcrumbs.tsx`) is
 * what an app draws; this is its inside.
 */

function Breadcrumb({ className, ...props }: React.ComponentProps<"nav">) {
  return <nav data-slot="breadcrumb" className={cn(className)} {...props} />;
}

function BreadcrumbList({ className, ...props }: React.ComponentProps<"ol">) {
  return (
    <ol
      data-slot="breadcrumb-list"
      className={cn("m-0 flex min-w-0 list-none items-center p-0", className)}
      {...props}
    />
  );
}

function BreadcrumbItem({ className, ...props }: React.ComponentProps<"li">) {
  return <li data-slot="breadcrumb-item" className={cn("items-center", className)} {...props} />;
}

function BreadcrumbLink({ className, render, ...props }: useRender.ComponentProps<"a">) {
  return useRender({
    defaultTagName: "a",
    props: mergeProps<"a">(
      {
        className: cn(
          "flex min-w-0 items-center gap-breadcrumb-gap rounded-breadcrumb border-0 bg-transparent px-breadcrumb-pill-inline py-breadcrumb-pill-block text-muted-foreground [font:inherit] transition-[background-color,color] duration-(--luke-duration-hover) ease-plain [&:hover]:bg-fill-selected [&:hover]:text-foreground aria-expanded:bg-fill-selected aria-expanded:text-foreground aria-[current=page]:text-foreground",
          className,
        ),
      },
      props,
    ),
    render,
    state: {
      slot: "breadcrumb-link",
    },
  });
}

function BreadcrumbPage({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="breadcrumb-page"
      className={className === undefined ? "text-foreground" : `text-foreground ${className}`}
      {...props}
    />
  );
}

function BreadcrumbSeparator({ children, className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="breadcrumb-separator"
      role="presentation"
      aria-hidden="true"
      className={cn("[&>svg]:size-3.5", className)}
      {...props}
    >
      {children ?? (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
      )}
    </span>
  );
}

export {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
};
