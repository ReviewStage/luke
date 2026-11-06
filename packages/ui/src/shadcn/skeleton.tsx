import type { ComponentProps } from "react";
import { cn } from "../cn.js";

function SkeletonBlock({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      data-slot="skeleton"
      className={cn("block max-w-full bg-secondary", className)}
      {...props}
    />
  );
}

export { SkeletonBlock };
