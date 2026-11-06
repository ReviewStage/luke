import type * as React from "react";
import { cn } from "../cn.js";

function ScrollArea({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="scroll-area" className={cn("box-border min-h-0 min-w-0", className)} {...props}>
      {children}
    </div>
  );
}

export { ScrollArea };
