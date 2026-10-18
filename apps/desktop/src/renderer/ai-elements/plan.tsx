import {
  Fold,
  FoldBody,
  type FoldBodyProps,
  type FoldProps,
  FoldSummary,
  type FoldSummaryProps,
} from "@luke/panel/ai-elements/fold";
import { DisclosureChevron } from "@luke/ui";
import type { ReactNode } from "react";

/** How an opened card sets what it holds: as running words, or as blocks stacked a group's gap apart. */
export const PLAN_BODY_LAYOUT = {
  FLOW: "flow",
  STACK: "stack",
} as const;

type PlanBodyLayout = (typeof PLAN_BODY_LAYOUT)[keyof typeof PLAN_BODY_LAYOUT];

/**
 * plan.tsx -- AI Elements' Plan: a plan as a card across the column, its title on the header and the plan itself under it once opened.
 *
 * After the AI Elements registry (https://elements.ai-sdk.dev), restyled
 * to Luke's tokens and folded on `fold.tsx` rather than the registry's
 * card over a collapsible: the header is the one line a closed card shows
 * and is what opens it, so the registry's separate trigger button is not
 * here. Neither is its streaming title, because the plan a coding agent is
 * handed is finished before the agent starts. Closed by default, as
 * docs/TASKS.md's rule for an agent's transcript asks: the plan is
 * there to be read, never in the way of the agent's own words. Its look is
 * tasks.css's `.plan-card` rules.
 */

export type TaskProps = Omit<FoldProps, "className">;

export function Plan({ children, ...props }: TaskProps): ReactNode {
  return (
    <Fold className="plan-card" {...props}>
      {children}
    </Fold>
  );
}

export type TaskHeaderProps = Omit<FoldSummaryProps, "className">;

/** The one line a closed card shows, which opens and closes it: the chevron, then whatever names the plan. */
export function PlanHeader({ children, ...props }: TaskHeaderProps): ReactNode {
  return (
    <FoldSummary className="plan-card-head" {...props}>
      <DisclosureChevron />
      {children}
    </FoldSummary>
  );
}

/** The seat a header's icon stands in, before the title, whatever icon the caller hands it. */
export function PlanIcon({ children }: { children: ReactNode }): ReactNode {
  return (
    <span className="plan-card-icon" aria-hidden="true">
      {children}
    </span>
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
    <span className="plan-card-title">
      {label === undefined ? null : <span className="plan-card-label">{label} · </span>}
      <span className="plan-card-name">{children}</span>
    </span>
  );
}

export type TaskContentProps = Omit<FoldBodyProps, "className"> & {
  layout?: PlanBodyLayout;
};

/** The plan itself, drawn only once the card is opened. */
export function PlanContent({
  layout = PLAN_BODY_LAYOUT.FLOW,
  children,
  ...props
}: TaskContentProps): ReactNode {
  return (
    <FoldBody className="plan-card-body" data-layout={layout} {...props}>
      {children}
    </FoldBody>
  );
}
