import {
  type ComponentPropsWithoutRef,
  createContext,
  type MouseEvent,
  type ReactNode,
  type SyntheticEvent,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { FoldChevronIcon } from "../../face/glyphs.js";
import { type DisclosureMotion, disclosureMotion, useDisclosure } from "../../use-disclosure.js";

/**
 * disclosure.tsx -- a fold: a `details` whose open state is React's, so a closed body is not drawn at all.
 *
 * The platform's own `details` lands at once and opens and closes from the
 * keyboard. The state is held here rather than left to the element, for one
 * reason: a transcript holds hundreds of folds, and a body drawn only once
 * its line is opened keeps the closed ones out of the layout entirely. The
 * summary takes the click itself and stops the element's own toggle, so the
 * two cannot disagree, and says whether it is open in `aria-expanded`.
 *
 * A press moves the fold, and nothing else does. The layout lands at once
 * either way; a press that opens marks the element `data-disclosure` as
 * opening, which unrolls the body as it fades in (disclosure.css), and a
 * press that closes holds the body drawn through its fade
 * (`use-disclosure.ts`). For the moment it moves, the body's height is
 * published on the element as `--disclosure-rise`, which is how a fold
 * whose line travels as it opens tells its stylesheet how far. A fold drawn
 * open from the start, or drawn again, replays nothing.
 *
 * While an app's find looks through what holds the fold (`DisclosureFind`),
 * a closed body is drawn after all, still hidden inside its closed `details`
 * as the platform hides one, so the find covers what the fold holds; a find
 * that shows a match there opens the element, and the fold follows the
 * element's own toggle, so its state is the element's again at once.
 *
 * `Disclosure` draws the quiet summary row: a chevron, then the caller's
 * glyph and words, muted until the pointer is over it. A surface that skins
 * its fold its own way builds on `useDisclosureFold` and `DisclosureScope`
 * instead, so the state and the motion live here once.
 */

/** Where an open body stands: under the summary's words, past its chevron, or flush with the row. */
export const DISCLOSURE_BODY = {
  INDENTED: "indented",
  FLUSH: "flush",
} as const;
export type DisclosureBodyInset = (typeof DISCLOSURE_BODY)[keyof typeof DISCLOSURE_BODY];

/** A fold's state, as its summary, chevron, and body read it. */
export interface DisclosureState {
  /** Whether it is open, as its line says. */
  readonly open: boolean;
  /** Whether its body is drawn: open, or closed and still fading. */
  readonly drawn: boolean;
  /** Whether its body is fading out, out of reach of the keys and the pointer. */
  readonly leaving: boolean;
  readonly toggle: () => void;
  /** The ref for the body, whose fade the fold waits on. */
  readonly body: (element: HTMLElement | null) => void;
}

/** What `useDisclosureFold` hands the `details` element it is drawn on. */
export interface DisclosureDetailsProps {
  readonly ref: (element: HTMLDetailsElement | null) => void;
  readonly open: boolean;
  readonly "data-disclosure": DisclosureMotion | undefined;
  readonly onToggle: (event: SyntheticEvent<HTMLDetailsElement>) => void;
}

/** A fold's state, and the props for the `details` it is drawn on. */
export interface DisclosureFold {
  readonly state: DisclosureState;
  readonly details: DisclosureDetailsProps;
}

const FindContext = createContext(false);
const StateContext = createContext<DisclosureState | undefined>(undefined);

/** The fold around the caller. */
export function useDisclosureState(): DisclosureState {
  const state = useContext(StateContext);
  if (state === undefined) throw new Error("A disclosure's parts must be drawn inside one");
  return state;
}

/**
 * Whether the fold around the caller draws its body: open, on its way out,
 * or a find looking through it. Note that a summary previewing its body asks
 * this rather than whether the fold is open, because the body a find draws
 * hidden says the same words, and a find counting both would open the fold
 * onto a match in the preview that opening it takes away.
 */
export function useDisclosureBodyDrawn(): boolean {
  const { drawn } = useDisclosureState();
  const finding = useContext(FindContext);
  return drawn || finding;
}

/**
 * A fold's state and the props for the `details` it is drawn on, for a
 * surface that draws its own summary and body inside `DisclosureScope`.
 */
export function useDisclosureFold(defaultOpen: boolean): DisclosureFold {
  const [open, setOpen] = useState(defaultOpen);
  // Whether the open state is a press's, which alone plays the opening.
  const [pressed, setPressed] = useState(false);
  const shown = useDisclosure(open);
  const root = useRef<HTMLDetailsElement | null>(null);
  const held = useRef<HTMLElement | null>(null);
  const shownRef = shown.ref;
  const body = useCallback(
    (element: HTMLElement | null) => {
      held.current = element;
      shownRef(element);
    },
    [shownRef],
  );
  const details = useCallback((element: HTMLDetailsElement | null) => {
    root.current = element;
  }, []);
  // Note that no motion plays while a find looks through, because a body
  // held open through its fade would be closed over the match a find showed
  // there, which opens only a `details` that is closed.
  const finding = useContext(FindContext);
  const motion = finding ? undefined : disclosureMotion(open && pressed, shown.leaving);
  // Note that this runs before the frame the press is drawn on, so the rise
  // is there for the first frame of any motion that reads it.
  useLayoutEffect(() => {
    if (motion === undefined || held.current === null) return;
    root.current?.style.setProperty("--disclosure-rise", `${held.current.offsetHeight}px`);
  }, [motion]);
  return {
    state: {
      open,
      drawn: shown.mounted,
      leaving: shown.leaving,
      toggle: () => {
        setPressed(true);
        setOpen(!open);
      },
      body,
    },
    details: {
      ref: details,
      open: shown.mounted,
      "data-disclosure": motion,
      onToggle: (event) => {
        // Note that the element's own toggle, a find's among them, lands at once.
        if (event.currentTarget.open === shown.mounted) return;
        setPressed(false);
        setOpen(event.currentTarget.open);
      },
    },
  };
}

/** Hands the fold's state to the summary, chevron, and body drawn inside it. */
export function DisclosureScope({
  state,
  children,
}: {
  state: DisclosureState;
  children: ReactNode;
}): React.JSX.Element {
  return <StateContext.Provider value={state}>{children}</StateContext.Provider>;
}

/**
 * Says whether an app's find looks through what it holds: every fold inside
 * draws its closed body, hidden, while `finding`, so the find covers it.
 */
export function DisclosureFind({
  finding,
  children,
}: {
  finding: boolean;
  children: ReactNode;
}): React.JSX.Element {
  return <FindContext.Provider value={finding}>{children}</FindContext.Provider>;
}

/** Whether an app's find looks through what holds the caller. */
export function useDisclosureFinding(): boolean {
  return useContext(FindContext);
}

/**
 * The summary's click, routed to the fold's state. Note that the element's
 * own toggle is stopped, because the open state is React's.
 */
export function useDisclosureSummaryClick(): (event: MouseEvent<HTMLElement>) => void {
  const { toggle } = useDisclosureState();
  return (event) => {
    event.preventDefault();
    toggle();
  };
}

/** Note that the element's own `open` is not a prop: the state is the fold's, and a fold meant to start open says `defaultOpen`. */
type DisclosureProps = {
  defaultOpen?: boolean;
  children: ReactNode;
} & Omit<ComponentPropsWithoutRef<"details">, "open" | "className" | "style" | "children">;

/** A fold drawn as the quiet summary row and its body. */
export function Disclosure({
  defaultOpen = false,
  onToggle,
  children,
  ...props
}: DisclosureProps): React.JSX.Element {
  const { state, details } = useDisclosureFold(defaultOpen);
  return (
    <DisclosureScope state={state}>
      <details
        {...props}
        {...details}
        className="luke-disclosure"
        onToggle={(event) => {
          details.onToggle(event);
          onToggle?.(event);
        }}
      >
        {children}
      </details>
    </DisclosureScope>
  );
}

type DisclosureSummaryProps = {
  children: ReactNode;
} & Omit<
  ComponentPropsWithoutRef<"summary">,
  "className" | "style" | "children" | "onClick" | "aria-expanded"
>;

/** The one line a closed fold shows, which opens and closes it: the chevron, then the caller's glyph and words. */
export function DisclosureSummary({
  children,
  ...props
}: DisclosureSummaryProps): React.JSX.Element {
  const { open } = useDisclosureState();
  const click = useDisclosureSummaryClick();
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a summary is the platform's own disclosure control, focusable and opened by Enter and Space; the click it already takes is routed to React's state.
    // biome-ignore lint/a11y/useAriaPropsSupportedByRole: a summary is exposed as its details' disclosure button, which takes aria-expanded; the rule's table gives the element no role.
    <summary {...props} className="luke-disclosure-summary" aria-expanded={open} onClick={click}>
      <DisclosureChevron />
      {children}
    </summary>
  );
}

/**
 * The chevron, turned down while its own fold is open. Note that it reads its
 * fold's state rather than the `details` element's through a selector,
 * because folds nest, and an ancestor's open would turn every chevron inside it.
 */
export function DisclosureChevron(): React.JSX.Element {
  const { open } = useDisclosureState();
  return (
    <span className="luke-disclosure-turn" data-open={open}>
      <FoldChevronIcon />
    </span>
  );
}

/** What the fold holds, drawn only while it is open, on its way out, or a find is looking through it. */
export function DisclosureBody({
  inset = DISCLOSURE_BODY.INDENTED,
  children,
}: {
  inset?: DisclosureBodyInset;
  children: ReactNode;
}): React.JSX.Element | null {
  const { body, leaving } = useDisclosureState();
  const drawn = useDisclosureBodyDrawn();
  if (!drawn) return null;
  return (
    <div ref={body} className="luke-disclosure-body" data-inset={inset} inert={leaving}>
      {children}
    </div>
  );
}
