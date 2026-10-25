import {
  DISCLOSURE_BODY,
  DISCLOSURE_LOOK,
  DISCLOSURE_SUMMARY,
  Disclosure,
  DisclosureBody,
  DisclosureChevron,
  DisclosureSummary,
  GlyphSlot,
  OneLine,
  useDisclosurePreviewShown,
} from "@luke/ui";
import type { ComponentProps, ComponentPropsWithoutRef, ReactNode } from "react";

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
 * to Luke's tokens and drawn as `@luke/ui`'s card fold rather than the
 * registry's card over a collapsible: the header is the one line a closed card shows
 * and is what opens it, so the registry's separate trigger button is not
 * here. Neither is its streaming title, because the plan a coding agent is
 * handed is finished before the agent starts. Closed by default, as
 * docs/TASKS.md's rule for an agent's transcript asks: the plan is
 * there to be read, never in the way of the agent's own words. Its title's
 * and body's look is tasks.css's `.plan-card-*` rules.
 */

export type TaskProps = Omit<ComponentProps<typeof Disclosure>, "look">;

export function Plan({ children, ...props }: TaskProps): ReactNode {
  return (
    <Disclosure look={DISCLOSURE_LOOK.CARD} {...props}>
      {children}
    </Disclosure>
  );
}

export type TaskHeaderProps = Omit<ComponentProps<typeof DisclosureSummary>, "look">;

/** The one line a closed card shows, which opens and closes it: the chevron, then whatever names the plan. */
export function PlanHeader({ children, ...props }: TaskHeaderProps): ReactNode {
  return (
    <DisclosureSummary look={DISCLOSURE_SUMMARY.HEAD} {...props}>
      <DisclosureChevron />
      {children}
    </DisclosureSummary>
  );
}

/** The seat a header's icon stands in, before the title, whatever icon the caller hands it. */
export function PlanIcon({ children }: { children: ReactNode }): ReactNode {
  return <GlyphSlot>{children}</GlyphSlot>;
}

export type TaskTitleProps = {
  /** The word before the title, drawn quieter: what kind of thing the card holds. */
  label?: string;
  /** Whether the title is the body's own first line, which gives way to the label alone while the body is drawn. */
  previews?: boolean;
  children: string;
};

/** The title's line, taking the head's room and cut to it. */
const TITLE_CLASS = "min-w-0 flex-1 overflow-hidden whitespace-nowrap";

/** The plan's title on the header, cut to the line, behind its label in the muted ink where it has one. */
export function PlanTitle({ label, previews = false, children }: TaskTitleProps): ReactNode {
  const previewed = useDisclosurePreviewShown(previews && label !== undefined);
  if (label !== undefined && !previewed) {
    return (
      <OneLine className={TITLE_CLASS} words={label}>
        <span className="text-muted-foreground">{label}</span>
      </OneLine>
    );
  }
  return (
    <OneLine
      className={TITLE_CLASS}
      words={label === undefined ? children : `${label} · ${children}`}
    >
      {label === undefined ? null : <span className="text-muted-foreground">{label} · </span>}
      <span className="font-luke-medium">{children}</span>
    </OneLine>
  );
}

export type TaskContentProps = Omit<ComponentPropsWithoutRef<"div">, "className"> & {
  layout?: PlanBodyLayout;
};

/** The plan itself, drawn only once the card is opened. */
export function PlanContent({
  layout = PLAN_BODY_LAYOUT.FLOW,
  children,
  ...props
}: TaskContentProps): ReactNode {
  return (
    <DisclosureBody inset={DISCLOSURE_BODY.CARD}>
      <div
        className="plan-card-body text-body data-[layout=stack]:flex data-[layout=stack]:flex-col data-[layout=stack]:gap-block-gap"
        data-layout={layout}
        {...props}
      >
        {children}
      </div>
    </DisclosureBody>
  );
}
