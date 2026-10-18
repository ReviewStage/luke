import {
  cn,
  DisclosureScope,
  useDisclosureBodyDrawn,
  useDisclosureFold,
  useDisclosureState,
  useDisclosureSummaryClick,
} from "@luke/ui";
import { ChevronRightIcon } from "lucide-react";
import type { ComponentProps, MouseEvent, ReactNode } from "react";

/**
 * fold.tsx -- the transcript's own skins of `@luke/ui`'s Disclosure: a tool call's line, a reasoning block, a plan card, the to-do dock, each drawing its summary and body in classes of its own.
 *
 * The state, the motion, and the find's reveal are the package's
 * (`useDisclosureFold`); what is here is only where each part wears its
 * caller's classes. A fold that draws the quiet summary row is
 * `Disclosure` itself, not this.
 */

/** Note that the element's own `open` is not a prop: the state is this component's, and a fold meant to start open says `defaultOpen`. */
export type FoldProps = Omit<ComponentProps<"details">, "open"> & {
  defaultOpen?: boolean;
};

export function Fold({
  className,
  children,
  defaultOpen = false,
  onToggle,
  ...props
}: FoldProps): ReactNode {
  const { state, details } = useDisclosureFold(defaultOpen);
  return (
    <DisclosureScope state={state}>
      <details
        {...details}
        className={cn("group/fold min-w-0", className)}
        onToggle={(event) => {
          details.onToggle(event);
          onToggle?.(event);
        }}
        {...props}
      >
        {children}
      </details>
    </DisclosureScope>
  );
}

export type FoldSummaryProps = ComponentProps<"summary">;

/** The one line a closed fold shows, which opens and closes it. */
export function FoldSummary({
  className,
  children,
  onClick,
  ...props
}: FoldSummaryProps): ReactNode {
  const { open } = useDisclosureState();
  const toggle = useDisclosureSummaryClick();
  const click = (event: MouseEvent<HTMLElement>) => {
    onClick?.(event);
    toggle(event);
  };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a summary is the platform's own disclosure control, focusable and opened by Enter and Space; the click it already takes is routed to React's state.
    // biome-ignore lint/a11y/useAriaPropsSupportedByRole: a summary is exposed as its details' disclosure button, which takes aria-expanded; the rule's table gives the element no role.
    <summary
      className={cn(
        "cursor-default list-none select-none [&::-webkit-details-marker]:hidden",
        className,
      )}
      aria-expanded={open}
      onClick={click}
      {...props}
    >
      {children}
    </summary>
  );
}

/**
 * The chevron at a card's head, or a transcript fold's over the rows it
 * holds, turned down while the fold is open; a call's row wears none, its
 * own icon leading and the whole line the target. Note that it reads its own fold's state rather than the
 * `details` element's open state through a CSS group, because folds nest,
 * and an ancestor's open would turn every chevron inside it.
 */
export function FoldChevron({ className }: { className?: string }): ReactNode {
  const { open } = useDisclosureState();
  return (
    <ChevronRightIcon
      aria-hidden="true"
      className={cn(
        "size-4 shrink-0 text-muted-foreground transition-transform",
        open && "rotate-90",
        className,
      )}
    />
  );
}

/** Note that the body's element is the fold's own, to wait on its fade, so it takes no ref. */
export type FoldBodyProps = Omit<ComponentProps<"div">, "ref">;

/** What the fold holds, drawn only while it is open, on its way out, or a find is looking through it. */
export function FoldBody({ className, children, ...props }: FoldBodyProps): ReactNode {
  const { body, leaving } = useDisclosureState();
  const drawn = useDisclosureBodyDrawn();
  if (!drawn) return null;
  return (
    <div ref={body} className={cn("luke-disclosure-body", className)} inert={leaving} {...props}>
      {children}
    </div>
  );
}
