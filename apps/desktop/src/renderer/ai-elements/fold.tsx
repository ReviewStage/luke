import { ChevronRightIcon } from "lucide-react";
import {
  type ComponentProps,
  createContext,
  type MouseEvent,
  type ReactNode,
  useContext,
  useState,
} from "react";
import { cn } from "./utils";

/**
 * fold.tsx -- the one fold the transcript's components fold on: a `details` whose open state is React's, so a closed body is not drawn at all.
 *
 * The AI Elements registry folds on Radix's Collapsible, which animates
 * its height on timings of its own; docs/DESIGN.md has content land at
 * once, and the platform's own `details` does, which the keyboard already
 * opens and closes. The state is held here rather than left to the
 * element, for one reason: a transcript holds hundreds of calls, each
 * with its input and its answer, and a body drawn only once its row is
 * opened keeps the closed ones out of the layout entirely. The summary
 * takes the click itself and stops the element's own toggle, so the two
 * cannot disagree.
 */

interface FoldState {
  readonly open: boolean;
  readonly toggle: () => void;
}

const FoldContext = createContext<FoldState | undefined>(undefined);

function useFold(): FoldState {
  const context = useContext(FoldContext);
  if (context === undefined) throw new Error("Fold components must be used within Fold");
  return context;
}

/** Note that the element's own `open` is not a prop: the state is this component's, and a fold meant to start open says `defaultOpen`. */
export type FoldProps = Omit<ComponentProps<"details">, "open"> & {
  defaultOpen?: boolean;
};

export function Fold({ className, children, defaultOpen = false, ...props }: FoldProps): ReactNode {
  const [open, setOpen] = useState(defaultOpen);
  const state: FoldState = { open, toggle: () => setOpen((was) => !was) };
  return (
    <FoldContext.Provider value={state}>
      <details open={open} className={cn("group/fold min-w-0", className)} {...props}>
        {children}
      </details>
    </FoldContext.Provider>
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
  const { toggle } = useFold();
  const click = (event: MouseEvent<HTMLElement>) => {
    // Note that the element's own toggle is stopped, because the open state is React's.
    event.preventDefault();
    onClick?.(event);
    toggle();
  };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a summary is the platform's own disclosure control, focusable and opened by Enter and Space; the click it already takes is routed to React's state.
    <summary
      className={cn(
        "cursor-default list-none select-none [&::-webkit-details-marker]:hidden",
        className,
      )}
      onClick={click}
      {...props}
    >
      {children}
    </summary>
  );
}

/**
 * The chevron at a summary's head, turned down while the fold is open. Note
 * that it reads its own fold's state rather than the `details` element's
 * open state through a CSS group, because folds nest (a group of calls holds
 * each call's fold), and an ancestor's open would turn every chevron inside it.
 */
export function FoldChevron({ className }: { className?: string }): ReactNode {
  const { open } = useFold();
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

export type FoldBodyProps = ComponentProps<"div">;

/** What the fold holds, drawn only while it is open. */
export function FoldBody({ children, ...props }: FoldBodyProps): ReactNode {
  const { open } = useFold();
  if (!open) return null;
  return <div {...props}>{children}</div>;
}
