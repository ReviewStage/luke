import type { ComponentProps, ReactNode } from "react";
import { cn } from "./utils";

/**
 * checkpoint.tsx -- AI Elements' Checkpoint: a quiet line across the conversation marking where one stretch of it ends and the next begins.
 *
 * After the AI Elements registry (https://elements.ai-sdk.dev), restyled
 * to Luke's tokens. The registry's checkpoint is a bookmark with a button
 * that restores the conversation to that point; here it is the divider
 * alone, its words at the left, a hairline running on from them, and
 * whatever the caller puts at the right, because what it marks in Luke is
 * the start of one call or one turn, which nothing restores to. The words
 * are the caller's: the call's day and time, and whether it stands now or
 * how far it got. It sticks to the top of the log as the lines under it
 * scroll, on the well's own ground so nothing shows through, which is why
 * a log that holds one has no top padding of its own.
 */

export type CheckpointProps = ComponentProps<"div"> & {
  /** What stands at the right, past the hairline. */
  trailing?: ReactNode;
};

export function Checkpoint({
  className,
  children,
  trailing,
  ...props
}: CheckpointProps): ReactNode {
  return (
    <div
      className={cn(
        "sticky top-0 z-[1] flex items-center gap-2 bg-well pt-3 pb-2 text-[11.5px] font-semibold text-muted-foreground",
        className,
      )}
      data-checkpoint=""
      {...props}
    >
      {children}
      <span className="h-px min-w-0 flex-1 bg-border" aria-hidden="true" />
      {trailing}
    </div>
  );
}
