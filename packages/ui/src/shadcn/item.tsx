import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "../cn.js";

/**
 * item.tsx -- shadcn/ui's item (style `base-nova`, on Base UI), vendored and drawn as Luke's settings row: a mark, its words, and the controls that set it.
 *
 * The component is shadcn's own source, kept as close to it as the window
 * allows, so a later `shadcn add item` reads as a small diff. Its local
 * changes:
 *
 * - `Item` is the row's padded box, a column rather than shadcn's wrapping
 *   row, because what stands under a row's line (what it grows below and
 *   the error of its last write) stands on lines of its own; the line of
 *   the mark (`ItemMedia`), the words (`ItemContent`), and the controls
 *   (`ItemActions`) is the caller's, which holds the mark and the words
 *   together where the controls drop below them.
 * - Its `size` is Luke's row density (`card`, `compact`, `list`) rather than
 *   `default`, `sm`, and `xs`: a card's padding and least height, a bare
 *   row's at a menu row's height, and a reference list's tighter ones, each
 *   a `--luke-settings-row-*` role. Its `variant` is dropped, because a
 *   row's edge, corner, ground, and the rules between rows are its
 *   section's card's, never the row's own.
 * - None of shadcn's corner, border, `text-sm`, transition, focus ring, or
 *   `[a]:hover` utilities, since a row takes no focus and no press of its
 *   own; the window draws the one focus ring (`shadcn-focus.test.ts`).
 * - `ItemMedia` is centred beside the words whether or not they are
 *   described, with none of shadcn's `icon` and `image` variants: the
 *   mark's box is `@luke/ui`'s `SettingsRowMark`.
 * - `ItemContent`, `ItemTitle`, and `ItemDescription` are drawn in Luke's
 *   label and caption roles with no line clamp: a long name or word breaks
 *   rather than being cut, and `ItemTitle` stands only where the label
 *   carries an adornment, the two wrapping between each other.
 *   `ItemActions` ends the line and wraps its controls, and stands nowhere
 *   while it holds none.
 * - `ItemGroup`, `ItemSeparator`, `ItemHeader`, and `ItemFooter` are
 *   dropped, because nothing draws them: a section's card holds and rules
 *   its rows (`components/settings-section/`).
 * - Each part keeps the `luke-settings-row-*` class it wore before the move,
 *   which the row's sheet (`components/settings-row/settings-row.css`)
 *   selects for what a utility cannot say: the narrow container's rules, a
 *   finger's whole-row press, and the properties those rules undo.
 *
 * `@luke/ui`'s `SettingsRow` (`components/settings-row/settings-row.tsx`) is
 * what an app draws; this is its inside.
 */

const itemVariants = cva(
  "luke-settings-row-body box-border flex min-w-0 flex-col justify-center gap-luke-4",
  {
    variants: {
      size: {
        card: "min-h-settings-row px-settings-row-inline py-settings-row-block",
        compact:
          "min-h-settings-row-compact px-settings-row-compact-inline py-settings-row-compact-block",
        list: "min-h-settings-row-list px-settings-row-inline py-settings-row-list-block",
      },
    },
    defaultVariants: {
      size: "card",
    },
  },
);

function Item({
  className,
  size = "card",
  render,
  ...props
}: useRender.ComponentProps<"div"> & VariantProps<typeof itemVariants>) {
  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(
      {
        className: cn(itemVariants({ size, className })),
      },
      props,
    ),
    render,
    state: {
      slot: "item",
    },
  });
}

function ItemMedia({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="item-media"
      className={cn("luke-settings-row-leading flex flex-none items-center", className)}
      {...props}
    />
  );
}

function ItemContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="item-content"
      className={cn(
        "luke-settings-row-copy flex min-w-0 grow basis-0 flex-col gap-luke-2 wrap-anywhere",
        className,
      )}
      {...props}
    />
  );
}

function ItemTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="item-title"
      className={cn("luke-settings-row-title flex min-w-0 items-center", className)}
      {...props}
    />
  );
}

function ItemDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="item-description"
      className={cn(
        "luke-settings-row-description m-0 font-sans text-caption font-caption text-muted-foreground wrap-anywhere",
        className,
      )}
      {...props}
    />
  );
}

function ItemActions({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="item-actions"
      className={cn(
        "luke-settings-row-controls flex min-w-0 flex-initial flex-wrap items-center justify-end gap-control-gap empty:hidden",
        className,
      )}
      {...props}
    />
  );
}

export { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle };
