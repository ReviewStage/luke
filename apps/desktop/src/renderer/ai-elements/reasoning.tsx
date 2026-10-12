import { BrainIcon } from "lucide-react";
import type { ReactNode } from "react";
import {
  Fold,
  FoldBody,
  type FoldBodyProps,
  type FoldProps,
  FoldSummary,
  type FoldSummaryProps,
} from "./fold";
import { cn } from "./utils";

/**
 * reasoning.tsx -- AI Elements' Reasoning: a model's thinking, folded under one quiet line until the reader opens it.
 *
 * After the AI Elements registry (https://elements.ai-sdk.dev), restyled
 * to Luke's tokens and folded on `fold.tsx` rather than the registry's
 * collapsible. Closed by default, as docs/PLANNING.md's rule for an
 * agent's transcript asks: the reasoning is there to be read, never in
 * the way. The line leads with a brain in the 16px seat a call's icon
 * stands in, so it lines up with the calls around it, then says
 * "Thought" and no more, because the stored part carries the words alone
 * and no measure of how long they took.
 */

/** What the folded line says. */
const REASONING_LINE = "Thought";

export type ReasoningProps = FoldProps;

export function Reasoning({ className, children, ...props }: ReasoningProps): ReactNode {
  return (
    <Fold className={cn("text-[12.5px]", className)} {...props}>
      {children}
    </Fold>
  );
}

export type ReasoningTriggerProps = FoldSummaryProps;

/** The one line a folded reasoning shows. */
export function ReasoningTrigger({
  className,
  children = REASONING_LINE,
  ...props
}: ReasoningTriggerProps): ReactNode {
  return (
    <FoldSummary
      className={cn(
        "flex h-7 cursor-pointer items-center gap-2 rounded-md px-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground",
        className,
      )}
      {...props}
    >
      <BrainIcon className="size-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </FoldSummary>
  );
}

export type ReasoningContentProps = FoldBodyProps;

/** The thinking itself, drawn quieter than the reply it led to, only once opened, as plain words set in under the line's, as a call's body is. */
export function ReasoningContent({
  className,
  children,
  ...props
}: ReasoningContentProps): ReactNode {
  return (
    <FoldBody
      className={cn(
        "mt-1 ml-7 text-muted-foreground [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        className,
      )}
      {...props}
    >
      {children}
    </FoldBody>
  );
}
