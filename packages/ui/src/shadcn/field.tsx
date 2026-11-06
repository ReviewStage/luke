import type * as React from "react";
import { cn } from "../cn.js";
import { Label } from "./label.js";

export function Field({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="field" className={cn("flex min-w-0 flex-col gap-ui-6", className)} {...props} />
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
        "m-0 font-body text-caption font-text text-muted-foreground wrap-anywhere",
        className,
      )}
      {...props}
    />
  );
}

export function FieldError({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="field-error"
      className={cn(
        "m-0 font-body text-caption font-text text-danger wrap-anywhere not-empty:animate-drop-in data-[leaving=true]:animate-leave empty:absolute",
        className,
      )}
      {...props}
    />
  );
}
