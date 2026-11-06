import type * as React from "react";
import { cn } from "../cn.js";

export function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: a label's words and its control's id reach it through its props.
    <label
      data-slot="label"
      className={cn(
        "font-body text-label font-label text-foreground wrap-anywhere in-[.ui-stepped-back]:text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}
