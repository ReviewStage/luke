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
} from "@repo/ui";
import type { ComponentProps, ComponentPropsWithoutRef, ReactNode } from "react";

export const PLAN_BODY_LAYOUT = {
  FLOW: "flow",
  STACK: "stack",
} as const;

type DescriptionBodyLayout = (typeof PLAN_BODY_LAYOUT)[keyof typeof PLAN_BODY_LAYOUT];

export type TaskProps = Omit<ComponentProps<typeof Disclosure>, "look">;

export function Plan({ children, ...props }: TaskProps): ReactNode {
  return (
    <Disclosure look={DISCLOSURE_LOOK.CARD} {...props}>
      {children}
    </Disclosure>
  );
}

export type TaskHeaderProps = Omit<ComponentProps<typeof DisclosureSummary>, "look"> & {
  folds?: boolean;
};

export function PlanHeader({ folds = true, children, ...props }: TaskHeaderProps): ReactNode {
  return (
    <DisclosureSummary look={DISCLOSURE_SUMMARY.HEAD} {...props}>
      {folds ? <DisclosureChevron /> : null}
      {children}
    </DisclosureSummary>
  );
}

export function PlanIcon({ children }: { children: ReactNode }): ReactNode {
  return <GlyphSlot>{children}</GlyphSlot>;
}

export type TaskTitleProps = {
  label?: string;
  previews?: boolean;
  children: string;
};

const TITLE_CLASS = "min-w-0 flex-1 overflow-hidden whitespace-nowrap";

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
      <span className="font-ui-medium">{children}</span>
    </OneLine>
  );
}

export type TaskContentProps = Omit<ComponentPropsWithoutRef<"div">, "className"> & {
  layout?: DescriptionBodyLayout;
};

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
