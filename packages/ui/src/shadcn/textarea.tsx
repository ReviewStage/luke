import type * as React from "react";
import { cn } from "../cn.js";

/**
 * textarea.tsx -- shadcn/ui's textarea (style `base-nova`), vendored and drawn as Luke's many-line field.
 *
 * The component is shadcn's own source, kept as close to it as the window
 * allows, so a later `shadcn add textarea` reads as a small diff. Its classes
 * are Luke's field rather than shadcn's, the input's (`input.tsx`) with a
 * line's block inset and a handle to size it by height: block rather than
 * flex, and sized by its rows rather than `field-sizing-content`, which a
 * growing note asks for itself (`components/text-field`). None of shadcn's
 * outline or ring utilities, for the window's own ring
 * (`anti-slop/no-shadcn-focus-ring`), and no `dark:` grounds. `TEXTAREA_WELL` is the
 * field's well, exported so a text area bare in a card that is its well
 * replaces it whole.
 */

/** The field's edge, ground, inset, and handle, which a bare text area replaces. */
export const TEXTAREA_WELL =
  "rounded-control border border-border-strong bg-field px-control-inset py-luke-6 resize-y focus:bg-field-focus";

/** What every text area shares: its box, its type, its placeholder, and its invalid and disabled states. */
const TEXTAREA_FIELD =
  "m-0 box-border block h-auto w-full min-w-0 font-body text-body font-text text-foreground transition-[border-color,background-color] duration-(--luke-duration-hover) ease-plain placeholder:text-muted-foreground aria-invalid:animate-field-shake aria-invalid:border-destructive disabled:cursor-not-allowed disabled:opacity-disabled";

export function ShadcnTextarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(TEXTAREA_FIELD, TEXTAREA_WELL, className)}
      {...props}
    />
  );
}
