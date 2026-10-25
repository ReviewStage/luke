import { Input as InputPrimitive } from "@base-ui/react/input";
import type * as React from "react";
import { cn } from "../cn.js";

/**
 * input.tsx -- shadcn/ui's input (style `base-nova`, on Base UI), vendored and drawn as Luke's text field.
 *
 * The component is shadcn's own source, kept as close to it as the window
 * allows, so a later `shadcn add input` reads as a small diff. Its classes
 * are Luke's field rather than shadcn's: a control's height, inset, and
 * corner, the field's ground inside the strong hairline, the body's type,
 * a placeholder in the muted ink, the focus ground, the danger edge and one
 * shake while invalid, and the disabled field's arrow and the one fade
 * every control wears while it cannot be used (`opacity-disabled`). None of
 * shadcn's outline or ring utilities, because the window's own focus ring
 * (`@luke/panel`'s base.css) draws the keyboard's ring and a utility would
 * outrank it (`shadcn-focus.test.ts`); no `file:` utilities, as no field
 * here takes a file; and no `dark:` grounds, as the palette's roles carry
 * both themes. `INPUT_CONTROL` is the control's own size and ground,
 * exported so a field drawn at another size (`components/text-field`)
 * replaces it whole, and `INPUT_FIELD` what every field shares, exported
 * with it so a field that is its own `<input>` (the combobox's, whose keys
 * and value its engine holds) wears the same classes. `@luke/ui`'s `TextField`, `SearchField`, and
 * `InlineEdit` are what an app draws; this is their inside.
 */

/** A control's size, edge, and ground, which a field at another size replaces. */
export const INPUT_CONTROL =
  "h-control rounded-control border border-border-strong bg-field px-control-inset focus:bg-field-focus";

/** What every field shares: its box, its type, its placeholder, and its invalid and disabled states. */
export const INPUT_FIELD =
  "m-0 box-border block w-full min-w-0 font-body text-body font-text text-foreground transition-[border-color,background-color] duration-(--luke-duration-hover) ease-plain placeholder:text-muted-foreground aria-invalid:animate-field-shake aria-invalid:border-destructive disabled:cursor-default disabled:opacity-disabled";

export function ShadcnInput({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(INPUT_FIELD, INPUT_CONTROL, className)}
      {...props}
    />
  );
}
