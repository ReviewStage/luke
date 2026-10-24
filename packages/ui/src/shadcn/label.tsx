import type * as React from "react";
import { cn } from "../cn.js";

/**
 * label.tsx -- shadcn/ui's label (style `base-nova`), vendored and drawn in Luke's label role.
 *
 * The component is shadcn's own source, kept as close to it as the window
 * allows, so a later `shadcn add label` reads as a small diff. Its classes
 * are Luke's label rather than shadcn's: the label role's type in the text
 * ink, at medium weight, breaking anywhere a long word must, and inline as
 * a label stands, so its words stay selectable and its line keeps the
 * baseline a count beside it sits on. A label in a stepped-back form takes
 * the muted ink, as the stepped-back form's other words do. `FieldLabel`
 * (`field.tsx`) is what a field draws; this is its inside.
 */

export function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: a label's words and its control's id reach it through its props.
    <label
      data-slot="label"
      className={cn(
        "font-body text-label font-medium text-foreground wrap-anywhere in-[.luke-stepped-back]:text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}
