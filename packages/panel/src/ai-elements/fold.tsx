import { cn, DISCLOSURE_BODY, DisclosureBody, DisclosureScope, useDisclosureFold } from "@luke/ui";
import type { ComponentProps, ReactNode } from "react";

/**
 * fold.tsx -- the transcript's own skins of `@luke/ui`'s Disclosure: a tool call's line, a reasoning block, a plan card, the to-do dock, each drawing its summary and body in classes of its own.
 *
 * The state, the motion, and the find's reveal are the package's
 * (`useDisclosureFold`); what is here is only where each part wears its
 * caller's classes; its summary, chevron, and body are the package's own
 * (`DisclosureSummary`'s transcript look, whose line the fold's classes
 * draw, `DisclosureChevron`, `DisclosureBody`). A fold that draws the quiet
 * summary row is `Disclosure` itself, not this.
 */

/** Note that the element's own `open` is not a prop: a fold meant to start open says `defaultOpen`, and one whose holder keeps its state says `open` and hears `onOpenChange`, each press and each toggle a find makes. */
export type FoldProps = Omit<ComponentProps<"details">, "open"> & {
  defaultOpen?: boolean;
  open?: boolean | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
};

export function Fold({
  className,
  children,
  defaultOpen = false,
  open,
  onOpenChange,
  onToggle,
  ...props
}: FoldProps): ReactNode {
  const { state, details } = useDisclosureFold(
    defaultOpen,
    open === undefined ? undefined : { open, onOpenChange: onOpenChange ?? (() => undefined) },
  );
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

/** Note that the body's element is the fold's own, to wait on its fade, so it takes no ref. */
export type FoldBodyProps = Omit<ComponentProps<"div">, "ref">;

/**
 * What the fold holds, drawn only while it is open, on its way out, or a
 * find is looking through it: the fold's own body, set bare, holding the
 * caller's skin.
 */
export function FoldBody({ children, ...props }: FoldBodyProps): ReactNode {
  return (
    <DisclosureBody inset={DISCLOSURE_BODY.NONE}>
      <div {...props}>{children}</div>
    </DisclosureBody>
  );
}
