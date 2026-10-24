import { cn } from "../cn.js";

/**
 * spinner.tsx -- shadcn/ui's spinner (style `base-nova`), vendored and drawn as Luke's own ring.
 *
 * The component is shadcn's own source, kept as close to it as the window
 * allows, so a later `shadcn add spinner` reads as a small diff. Its local
 * changes: lucide's `Loader2Icon`, a dependency the repository refuses, is
 * swapped for Luke's ring, a `span` drawn as an arc in the ink around it
 * (`border-t-current`) over a faint track of that ink, its stroke the one
 * `spinner.css` reads from `--luke-spinner-stroke`; the ring fills the box it stands in (`size-full`)
 * rather than taking shadcn's `size-4`, because `@luke/ui`'s `Spinner` sizes
 * the box; it turns on `spinner.css`'s `luke-spinner-ring` rule rather than
 * `animate-spin`, because that turn holds still on `--luke-loop-motion`
 * under reduced motion and a capture run, at the ring's own 900ms; and it
 * is hidden from a reader rather than a `role="status"` named "Loading",
 * because what a wait says is said by the status line `@luke/ui`'s
 * `Spinner` stands beside it (`components/spinner/spinner.tsx`), which is
 * what an app draws; this is its inside.
 */

/** The ring: a turning arc in the ink around it over a faint track of the same ink, filling its box. */
export const SPINNER_RING =
  "luke-spinner-ring block box-border size-full rounded-full border-solid border-current/22 border-t-current";

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
