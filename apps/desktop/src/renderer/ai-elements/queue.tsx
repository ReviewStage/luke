import type { ComponentProps, ReactNode } from "react";
import { cn } from "./utils";

/**
 * queue.tsx -- AI Elements' Queue: the messages waiting their turn, stacked as compact rows.
 *
 * Copied from the AI Elements registry (https://elements.ai-sdk.dev) and
 * restyled to Luke's tokens: one quiet card on the panel's raised surface,
 * each line a row with a hollow dot before its words and the words kept to
 * one line. The registry's collapsible sections, attachments, images, and
 * per-row actions are not here, because nothing draws them yet; each
 * arrives with the surface that first does. The list scrolls past a
 * bounded height on its own overflow rather than the registry's
 * ScrollArea, which is a scrollbar of its own this window does not draw.
 */

export type QueueItemProps = ComponentProps<"li">;

export function QueueItem({ className, ...props }: QueueItemProps): ReactNode {
  return (
    <li
      className={cn(
        "group flex items-center gap-2 rounded-md px-2 py-1 text-[12.5px] transition-colors hover:bg-secondary",
        className,
      )}
      {...props}
    />
  );
}

export type QueueItemIndicatorProps = ComponentProps<"span">;

/** The hollow dot before a line that is still waiting. */
export function QueueItemIndicator({ className, ...props }: QueueItemIndicatorProps): ReactNode {
  return (
    <span
      className={cn(
        "inline-block size-2 shrink-0 rounded-full border border-muted-foreground/60",
        className,
      )}
      aria-hidden="true"
      {...props}
    />
  );
}

export type QueueItemContentProps = ComponentProps<"span">;

export function QueueItemContent({ className, ...props }: QueueItemContentProps): ReactNode {
  return (
    <span className={cn("min-w-0 grow truncate text-muted-foreground", className)} {...props} />
  );
}

export type QueueListProps = ComponentProps<"ul">;

/** The rows, newest last, scrolling past a bounded height. */
export function QueueList({ className, ...props }: QueueListProps): ReactNode {
  return (
    <ul
      className={cn("m-0 flex max-h-40 list-none flex-col overflow-y-auto p-0", className)}
      {...props}
    />
  );
}

export type QueueProps = ComponentProps<"div">;

export function Queue({ className, ...props }: QueueProps): ReactNode {
  return (
    <div
      className={cn("flex flex-col rounded-xl border border-border bg-muted p-1", className)}
      {...props}
    />
  );
}
