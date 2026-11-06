import { Input as InputPrimitive } from "@base-ui/react/input";
import type * as React from "react";
import { cn } from "../cn.js";

export const INPUT_CONTROL =
  "h-control rounded-control border border-border-strong bg-field px-control-inset focus:bg-field-focus";

export const INPUT_FIELD =
  "m-0 box-border block w-full min-w-0 font-body text-body font-text text-foreground transition-[border-color,background-color] duration-(--ui-duration-hover) ease-plain placeholder:text-muted-foreground aria-invalid:animate-field-shake aria-invalid:border-destructive disabled:cursor-default disabled:opacity-disabled";

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
