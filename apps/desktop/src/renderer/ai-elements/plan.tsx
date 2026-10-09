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
import { cn } from "./utils";

/**
 * plan.tsx -- AI Elements' Plan: a plan as a card across the column, its title on the header and the plan itself under it once opened.
 *
 * After the AI Elements registry (https://elements.ai-sdk.dev), restyled
 * to Luke's tokens and folded on `fold.tsx` rather than the registry's
 * card over a collapsible: the header is the one line a closed card shows
 * and is what opens it, so the registry's separate trigger button is not
 * here. Neither is its streaming title, because the plan a coding agent is
 * handed is finished before the agent starts. Closed by default, as
 * docs/PLANNING.md's rule for an agent's transcript asks: the plan is
 * there to be read, never in the way of the agent's own words.
 */

export type PlanProps = FoldProps;

export function Plan({ className, children, ...props }: PlanProps): ReactNode {
  return (
    <Fold
      className={cn("rounded-lg border border-border bg-muted text-[12.5px]", className)}
      {...props}
    >
      {children}
    </Fold>
  );
}

export type PlanHeaderProps = FoldSummaryProps;

/** The one line a closed card shows, which opens and closes it: the chevron, then whatever names the plan. */
export function PlanHeader({ className, children, ...props }: PlanHeaderProps): ReactNode {
  return (
    <FoldSummary
      className={cn(
        "flex h-8 items-center gap-2 px-3 transition-colors hover:bg-secondary",
        className,
      )}
      {...props}
    >
      <FoldChevron />
      {children}
    </FoldSummary>
  );
}

export type PlanTitleProps = {
  /** The word before the title, drawn quieter: what kind of thing the card holds. */
  label?: string;
  children: string;
};

/** The plan's title on the header, cut to the line, behind its label where it has one. */
export function PlanTitle({ label, children }: PlanTitleProps): ReactNode {
  return (
    <span className="min-w-0 flex-1 truncate">
      {label === undefined ? null : <span className="text-muted-foreground">{label} · </span>}
      <span className="font-medium">{children}</span>
    </span>
  );
}

export type PlanContentProps = FoldBodyProps;

/** The plan itself, drawn only once the card is opened. */
export function PlanContent({ className, children, ...props }: PlanContentProps): ReactNode {
  return (
    <FoldBody
      className={cn("border-t border-border px-3 py-2 text-[13px] leading-normal", className)}
      {...props}
    >
      {children}
    </FoldBody>
  );
}
