import { cn } from "../cn.js";

export const SPINNER_RING =
  "ui-spinner-ring block box-border size-full rounded-full border-solid border-current/22 border-t-current";

export function ShadcnSpinner({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="spinner"
      aria-hidden="true"
      className={cn(SPINNER_RING, className)}
      {...props}
    />
  );
}
