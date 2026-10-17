import { cn } from "@luke/ui";
import type { ReactNode } from "react";
import {
  Fold,
  FoldBody,
  type FoldBodyProps,
  FoldChevron,
  type FoldProps,
  FoldSummary,
  type FoldSummaryProps,
} from "./fold";

/**
 * task.tsx -- AI Elements' Plan: a plan as a card across the column, its title on the header and the plan itself under it once opened.
 *
 * After the AI Elements registry (https://elements.ai-sdk.dev), restyled
 * to Luke's tokens and folded on `fold.tsx` rather than the registry's
 * card over a collapsible: the header is the one line a closed card shows
 * and is what opens it, so the registry's separate trigger button is not
 * here. Neither is its streaming title, because the plan a coding agent is
 * handed is finished before the agent starts. Closed by default, as
 * docs/TASKS.md's rule for an agent's transcript asks: the plan is
 * there to be read, never in the way of the agent's own words. The card
 * clips what it holds to its rounded corners, so the header's hover fill
 * follows the card's radius, and what is in it rings inside itself
 * (base.css's inset), on a header rounded as the card is.
 */

export type TaskProps = FoldProps;

export function Plan({ className, children, ...props }: TaskProps): ReactNode {
  return (
    <Fold
      className={cn(
        "overflow-clip rounded-lg border border-border bg-muted text-[12.5px] [--focus-ring-offset:var(--focus-ring-inset)]",
        className,
      )}
      {...props}
    >
      {children}
    </Fold>
  );
}

export type TaskHeaderProps = FoldSummaryProps;

/** The one line a closed card shows, which opens and closes it: the chevron, then whatever names the plan. */
export function PlanHeader({ className, children, ...props }: TaskHeaderProps): ReactNode {
  return (
    <FoldSummary
      className={cn(
        "flex h-8 items-center gap-2 rounded-[inherit] px-3 transition-colors hover:bg-secondary [[open]>&]:rounded-b-none",
        className,
      )}
      {...props}
    >
      <FoldChevron />
      {children}
    </FoldSummary>
  );
}

export type TaskTitleProps = {
  /** The word before the title, drawn quieter: what kind of thing the card holds. */
  label?: string;
  children: string;
};

/** The plan's title on the header, cut to the line, behind its label where it has one. */
export function PlanTitle({ label, children }: TaskTitleProps): ReactNode {
  return (
    <span className="min-w-0 flex-1 truncate">
      {label === undefined ? null : <span className="text-muted-foreground">{label} · </span>}
      <span className="font-medium">{children}</span>
    </span>
  );
}

export type TaskContentProps = FoldBodyProps;

/** The plan itself, drawn only once the card is opened. */
export function PlanContent({ className, children, ...props }: TaskContentProps): ReactNode {
  return (
    <FoldBody
      className={cn("border-t border-border px-3 py-2 text-[13px] leading-normal", className)}
      {...props}
    >
      {children}
    </FoldBody>
  );
}
