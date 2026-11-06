import type * as React from "react";
import { cn } from "../cn.js";

export const TEXTAREA_WELL =
  "rounded-control border border-border-strong bg-field px-control-inset py-ui-6 resize-y focus:bg-field-focus";

const TEXTAREA_FIELD =
  "m-0 box-border block h-auto w-full min-w-0 font-body text-body font-text text-foreground transition-[border-color,background-color] duration-(--ui-duration-hover) ease-plain placeholder:text-muted-foreground aria-invalid:animate-field-shake aria-invalid:border-destructive disabled:cursor-default disabled:opacity-disabled";

export function ShadcnTextarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(TEXTAREA_FIELD, TEXTAREA_WELL, className)}
      {...props}
    />
  );
}
