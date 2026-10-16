import { cn } from "@luke/ui";
import { ChevronRightIcon } from "lucide-react";
import {
  type ComponentProps,
  createContext,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useFindOpen } from "../find-in-tab";
import { disclosureMotion, useDisclosure } from "../use-disclosure";

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
 * cannot disagree, and says whether it is open in `aria-expanded`.
 *
 * A press moves the fold, and nothing else does. The layout lands at once
 * either way; a press that opens marks the element `data-disclosure` as
 * opening, which unrolls the body as it fades in (base.css), and a press
 * that closes holds the body drawn through its fade (`use-disclosure.ts`).
 * For the moment it moves, the body's height is published on the element
 * as `--disclosure-rise`, which is how a fold whose line travels as it
 * opens, the to-do list docked over the composer, tells the stylesheet how
 * far. A fold drawn open from the start, or drawn again, replays nothing.
 *
 * While a find bar is open over the tab (`find-in-tab.tsx`), a closed body
 * is drawn after all, still hidden inside its closed `details` as the
 * platform hides one, so the find covers what the fold holds; a find that
 * shows a match there opens the element, and the fold follows the element's
 * own toggle, so its state is the element's again at once, with no motion.
 */

interface FoldState {
  /** Whether it is open, as its line says. */
  readonly open: boolean;
  /** Whether its body is drawn: open, or closed and still fading. */
  readonly drawn: boolean;
  /** Whether its body is fading out, out of reach of the keys and the pointer. */
  readonly leaving: boolean;
  readonly toggle: () => void;
  readonly body: (element: HTMLElement | null) => void;
}

const FoldContext = createContext<FoldState | undefined>(undefined);

function useFold(): FoldState {
  const context = useContext(FoldContext);
  if (context === undefined) throw new Error("Fold components must be used within Fold");
  return context;
}

/**
 * Whether the fold around the caller draws its body: open, on its way out,
 * or a find looking through it. Note that a summary previewing its body asks
 * this rather than whether the fold is open, because the body a find draws
 * hidden says the same words, and a find counting both would open the fold
 * onto a match in the preview that opening it takes away.
 */
export function useFoldBodyDrawn(): boolean {
  const { drawn } = useFold();
  const finding = useFindOpen();
  return drawn || finding;
}

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
  const [open, setOpen] = useState(defaultOpen);
  // Whether the open state is a press's, which alone plays the opening.
  const [pressed, setPressed] = useState(false);
  const shown = useDisclosure(open);
  const root = useRef<HTMLDetailsElement>(null);
  const held = useRef<HTMLElement | null>(null);
  const shownRef = shown.ref;
  const body = useCallback(
    (element: HTMLElement | null) => {
      held.current = element;
      shownRef(element);
    },
    [shownRef],
  );
  // Note that no motion plays while a find looks through the tab, because a
  // body held open through its fade would be closed over the match a find
  // showed there, which opens only a `details` that is closed.
  const finding = useFindOpen();
  const motion = finding ? undefined : disclosureMotion(open && pressed, shown.leaving);
  // Note that this runs before the frame the press is drawn on, so the rise
  // is there for the first frame of any motion that reads it.
  useLayoutEffect(() => {
    if (motion === undefined || held.current === null) return;
    root.current?.style.setProperty("--disclosure-rise", `${held.current.offsetHeight}px`);
  }, [motion]);
  const state: FoldState = {
    open,
    drawn: shown.mounted,
    leaving: shown.leaving,
    toggle: () => {
      setPressed(true);
      setOpen(!open);
    },
    body,
  };
  return (
    <FoldContext.Provider value={state}>
      <details
        ref={root}
        open={shown.mounted}
        className={cn("group/fold min-w-0", className)}
        data-disclosure={motion}
        onToggle={(event) => {
          // Note that the element's own toggle, a find's among them, lands at once.
          if (event.currentTarget.open !== shown.mounted) {
            setPressed(false);
            setOpen(event.currentTarget.open);
          }
          onToggle?.(event);
        }}
        {...props}
      >
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
  const { open, toggle } = useFold();
  const click = (event: MouseEvent<HTMLElement>) => {
    // Note that the element's own toggle is stopped, because the open state is React's.
    event.preventDefault();
    onClick?.(event);
    toggle();
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

/** Note that the body's element is the fold's own, to wait on its fade, so it takes no ref. */
export type FoldBodyProps = Omit<ComponentProps<"div">, "ref">;

/** What the fold holds, drawn only while it is open, on its way out, or a find is looking through it. */
export function FoldBody({ className, children, ...props }: FoldBodyProps): ReactNode {
  const { body, leaving } = useFold();
  const drawn = useFoldBodyDrawn();
  if (!drawn) return null;
  return (
    <div ref={body} className={cn("disclosure-body", className)} inert={leaving} {...props}>
      {children}
    </div>
  );
}
