import { cn, DISCLOSURE_BODY, DisclosureBody, DisclosureScope, useDisclosureFold } from "@repo/ui";
import type { ComponentProps, ReactNode } from "react";

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

export type FoldBodyProps = Omit<ComponentProps<"div">, "ref">;

export function FoldBody({ children, ...props }: FoldBodyProps): ReactNode {
  return (
    <DisclosureBody inset={DISCLOSURE_BODY.NONE}>
      <div {...props}>{children}</div>
    </DisclosureBody>
  );
}
