import type { ComponentProps, ReactNode } from "react";
import { cn } from "./utils";

/**
 * reasoning.tsx -- AI Elements' Reasoning: a model's thinking, folded under one line until the reader opens it.
 *
 * After the AI Elements registry (https://elements.ai-sdk.dev), restyled
 * to Luke's tokens. The registry folds on its own collapsible; here the
 * fold is the platform's own `details`, which the keyboard already opens
 * and closes and which needs no second library to animate. Closed by
 * default, as docs/PLANNING.md's rule for an agent's transcript asks: the
 * reasoning is there to be read, never in the way.
 */

export type ReasoningProps = ComponentProps<"details">;

export function Reasoning({ className, children, ...props }: ReasoningProps): ReactNode {
  return (
    <details className={cn("group/reasoning min-w-0 text-[12.5px]", className)} {...props}>
      {children}
    </details>
  );
}

export type ReasoningTriggerProps = ComponentProps<"summary">;

/** The one line a folded reasoning shows. */
export function ReasoningTrigger({
  className,
  children = "Reasoning",
  ...props
}: ReasoningTriggerProps): ReactNode {
  return (
    <summary
      className={cn(
        "cursor-default list-none rounded-md px-1 py-0.5 text-muted-foreground select-none transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden",
        className,
      )}
      {...props}
    >
      <span className="inline-block w-3 transition-transform group-open/reasoning:rotate-90">
        ▸
      </span>
      {children}
    </summary>
  );
}

export type ReasoningContentProps = ComponentProps<"div">;

/** The thinking itself, drawn quieter than the reply it led to. */
export function ReasoningContent({
  className,
  children,
  ...props
}: ReasoningContentProps): ReactNode {
  return (
    <div
      className={cn(
        "mt-1 border-l-2 border-border pl-3 text-muted-foreground [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
