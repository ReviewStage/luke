import type * as React from "react";
import { cn } from "../cn.js";
import { Label } from "./label.js";

/**
 * field.tsx -- shadcn/ui's field (style `base-nova`), vendored and drawn as Luke's form field.
 *
 * The parts are shadcn's own source, kept as close to it as the window
 * allows, so a later `shadcn add field` reads as a small diff. The local
 * changes: only the parts a `@luke/ui` component draws are kept (`Field`,
 * `FieldGroup`, `FieldLabel`, `FieldDescription`, `FieldError`); a field is
 * one orientation, its parts one under another, so `Field` takes no
 * `orientation` and draws no `role="group"`, which an unnamed field would
 * only add to a reader's tree; `FieldGroup` is no container query, whose
 * containment would let a group shrink past its fields; and `FieldError`
 * always stands, as a polite live region in place of `role="alert"`, empty
 * until it says something, because a reader announces a region filling more
 * surely than one arriving, and its words are what the caller says rather
 * than a list of validation errors. The classes are Luke's: the parts six
 * apart, the description in the muted caption, and the error in the danger
 * ink, dropping into its line as it arrives and giving back its gap while
 * empty. None of shadcn's ring utilities (`shadcn-focus.test.ts`).
 * `@luke/ui`'s `FormField` (`components/form-field`) is what an app draws;
 * this is its inside.
 */

export function Field({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="field"
      className={cn("flex min-w-0 flex-col gap-luke-6", className)}
      {...props}
    />
  );
}

export function FieldGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="field-group"
      className={cn("flex min-w-0 flex-col gap-field-gap", className)}
      {...props}
    />
  );
}

export function FieldLabel({ className, ...props }: React.ComponentProps<typeof Label>) {
  return <Label data-slot="field-label" className={className} {...props} />;
}

export function FieldDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="field-description"
      className={cn(
        "m-0 font-body text-caption font-normal text-muted-foreground wrap-anywhere",
        className,
      )}
      {...props}
    />
  );
}

export function FieldError({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      aria-live="polite"
      data-slot="field-error"
      className={cn(
        "m-0 font-body text-caption font-normal text-danger wrap-anywhere not-empty:animate-drop-in empty:-mt-luke-6",
        className,
      )}
      {...props}
    />
  );
}
