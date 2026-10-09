import type { ComponentProps, ReactNode } from "react";
import { cn } from "./utils";

/**
 * checkpoint.tsx -- AI Elements' Checkpoint: a quiet line across the conversation marking where one stretch of it ends and the next begins.
 *
 * After the AI Elements registry (https://elements.ai-sdk.dev), restyled
 * to Luke's tokens. The registry's checkpoint is a bookmark with a button
 * that restores the conversation to that point; here it is the divider
 * alone, its words at the left and a hairline running to the column's
 * edge, because what it marks in Luke is the start of one call, which
 * nothing restores to. The words are the caller's: the call's day and
 * time, and whether it stands now.
 */

export type CheckpointProps = ComponentProps<"div">;

export function Checkpoint({ className, children, ...props }: CheckpointProps): ReactNode {
  return (
    <div
      className={cn(
        "flex items-center gap-2 py-1 text-[11.5px] font-semibold text-muted-foreground",
        className,
      )}
      data-checkpoint=""
      {...props}
    >
      {children}
      <span className="h-px min-w-0 flex-1 bg-border" aria-hidden="true" />
    </div>
  );
}
