import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "../cn.js";

const itemVariants = cva(
  "ui-settings-row-body box-border flex min-w-0 flex-col justify-center gap-ui-4",
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
      className={cn("ui-settings-row-leading flex flex-none items-center", className)}
      {...props}
    />
  );
}

function ItemContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="item-content"
      className={cn(
        "ui-settings-row-copy flex min-w-0 grow basis-0 flex-col gap-ui-2 wrap-anywhere",
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
      className={cn("ui-settings-row-title flex min-w-0 items-center", className)}
      {...props}
    />
  );
}

function ItemDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="item-description"
      className={cn(
        "ui-settings-row-description m-0 font-sans text-caption font-caption text-muted-foreground wrap-anywhere",
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
        "ui-settings-row-controls flex min-w-0 flex-initial flex-wrap items-center justify-end gap-control-gap empty:hidden",
        className,
      )}
      {...props}
    />
  );
}

export { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle };
