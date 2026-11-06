import type * as React from "react";
import { cn } from "../cn.js";

function Empty({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty"
      className={cn(
        "ui-empty-state-body m-auto box-border flex max-w-empty-state flex-col items-center gap-ui-12 p-ui-24 text-center",
        className,
      )}
      {...props}
    />
  );
}

function EmptyHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-header"
      className={cn("ui-empty-state-words flex flex-col gap-ui-4", className)}
      {...props}
    />
  );
}

function EmptyMedia({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="empty-icon"
      className={cn(
        "ui-empty-state-icon flex text-muted-foreground opacity-60 [&_svg]:size-ui-40 [&_svg]:stroke-[1.4]",
        className,
      )}
      {...props}
    />
  );
}

export { Empty, EmptyHeader, EmptyMedia };
