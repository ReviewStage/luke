/**
 * over-pane.tsx -- a pane that floats over a tab while the tab has no room to dock it beside: slid in from its edge as it opens, out past it as it closes, and put away by Escape or a press outside it.
 *
 * A narrow window floats what a wide one docks beside the work: a File tab's
 * tree, a Terminal tab's shells, the Chapters view's rail. Each is this one
 * pane, so each comes and goes the same way. `open` drives it. Opened, it
 * slides in from its edge on the pane's motion tokens and takes the
 * keyboard, onto the control its owner names or else its first, and holds
 * it against Tab. Closed, it slides back out past its edge, held drawn and
 * inert through its exit and let go once that has played, and hands the
 * keyboard back to wherever it stood as the pane opened, unless a press
 * outside already put it somewhere else. Reduced motion and a capture run,
 * which zero the tokens, let it go at once.
 *
 * A pane may come as a peek instead, as the pointer rests on its toggle: a
 * beat late, taking no keyboard and holding none against Tab, and put away
 * by its owner as the pointer leaves it. A press of its toggle makes it
 * open, which takes the keyboard.
 *
 * Escape in it, and a press anywhere outside it and its toggle, ask its
 * owner to close it (`onClose`); a menu or a dialog it raised takes its own
 * Escape first, and a press in one is the pane's own, since React carries
 * it through the pane (`PanePin`). It stands over the nearest positioned
 * box its owner draws it in, at that box's full height, as wide as the box
 * less a strip of the tab to press it away by, or a column's width.
 */

import { useAtomSet } from "@effect/atom-react";
import { MOTION_DURATION_MS } from "@luke/brand";
import { Duration, Effect } from "effect";
import * as Atom from "effect/reactivity/Atom";
import {
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { MOTION_TOKEN, milliseconds } from "../../motion-timing.js";
import { trappedTab } from "../../trapped-tab.js";
import { PanePin } from "../pane-pin/pane-pin.js";

/** Which edge of the tab the pane stands at, and slides in from and out past. */
export const OVER_PANE_EDGE = {
  RIGHT: "right",
  LEFT: "left",
} as const;

export type OverPaneEdge = (typeof OVER_PANE_EDGE)[keyof typeof OVER_PANE_EDGE];

/** How wide the pane stands over the tab. */
export const OVER_PANE_WIDTH = {
  /** The tab's width less a strip to press it away by, so a long path reads whole: a File tab's tree. */
  SHEET: "sheet",
  /** A column's width, or the sheet's where the tab is narrower: a Terminal tab's shells, the Chapters rail. */
  COLUMN: "column",
} as const;

export type OverPaneWidth = (typeof OVER_PANE_WIDTH)[keyof typeof OVER_PANE_WIDTH];

/** The control that opens and closes the pane, or the controls, where the owner draws it twice. */
type OverPaneToggle = RefObject<HTMLElement | null> | readonly RefObject<HTMLElement | null>[];

/** Whether `target` is in the toggle, or any of them. */
function onToggle(toggle: OverPaneToggle | undefined, target: Node): boolean {
  if (toggle === undefined) return false;
  const all = "current" in toggle ? [toggle] : toggle;
  return all.some((each) => each.current?.contains(target) === true);
}

/** Where the pane stands in its coming and going, which its sheet slides it by. */
const OVER_PANE_STATE = {
  OPEN: "open",
  LEAVING: "leaving",
} as const;

/** How a pane came, where it is not simply opened. */
const OVER_PANE_ARRIVAL = {
  PEEK: "peek",
} as const;

/** The layers that answer their own Escape before the pane hears it. */
const KEY_LAYERS = '[role="menu"], [role="dialog"], [role="alertdialog"]';

/**
 * How long the pane's slide out runs, read as the token stands on the body,
 * where a capture run zeroes it as reduced motion does. Note that a window
 * no stylesheet has drawn sets nothing, and waits the brand's own duration,
 * the one the token is generated from.
 */
function exitDuration(): number {
  const value = getComputedStyle(document.body).getPropertyValue(MOTION_TOKEN.DURATION_PANE);
  return value.trim() === "" ? MOTION_DURATION_MS.PANE : milliseconds(value);
}

/**
 * The pane's exit, as an atom whose work is the wait: it lets the pane go
 * once its slide out has run. Note that the way to say so is handed inside a
 * record, because a function handed to an atom's setter is read as an update
 * of its value and called at once.
 */
function exitWait() {
  return Atom.fn(({ delay, done }: { readonly delay: number; readonly done: () => void }) =>
    Effect.andThen(Effect.sleep(Duration.millis(delay)), Effect.sync(done)),
  );
}

/**
 * Whether the pane is on its way out: from the render `open` falls in until
 * its slide out has run, or not at all where there is no motion to play. A
 * pane opened again on its way out stops leaving and slides back in.
 */
function useLeaving(open: boolean): boolean {
  const atom = useMemo(exitWait, []);
  const wait = useAtomSet(atom);
  const [shown, setShown] = useState(open);
  const [leaving, setLeaving] = useState(false);
  if (shown !== open) {
    setShown(open);
    setLeaving(!open);
  }
  useLayoutEffect(() => {
    if (!leaving) return undefined;
    const delay = exitDuration();
    // Note that reduced motion leaves 1ms rather than none, which is no motion either.
    if (delay <= 1) {
      setLeaving(false);
      return undefined;
    }
    wait({ delay, done: () => setLeaving(false) });
    return () => wait(Atom.Interrupt);
  }, [leaving, wait]);
  return leaving;
}

/** Whether the keyboard stands nowhere, or in `box`, so handing it back takes it from no one. */
function heldIn(box: HTMLElement | null): boolean {
  const now = document.activeElement;
  return now === null || now === document.body || (box?.contains(now) ?? false);
}

/**
 * Takes the keyboard into the pane as it opens and hands it back as it
 * closes, to wherever it stood as the pane opened, while that still stands.
 * Note that it is handed back only from inside the pane, or from nowhere,
 * because a press outside that closed the pane has already put the focus
 * where it was meant to go; and that it is handed back as the close lands
 * rather than as the open is cleaned up, because React puts back the focus
 * a commit's changes moved, which would take it back into the pane.
 */
function useHeldKeyboard(
  open: boolean,
  pane: RefObject<HTMLElement | null>,
  initialFocus: RefObject<HTMLElement | null> | undefined,
): void {
  const before = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const box = pane.current;
    if (open) {
      before.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      (initialFocus?.current ?? box)?.focus({ preventScroll: true });
      return;
    }
    const back = before.current;
    before.current = null;
    if (back?.isConnected === true && heldIn(box)) back.focus({ preventScroll: true });
  }, [open, pane, initialFocus]);
  // A pane its owner lets go while it is open hands the keyboard back too.
  useEffect(
    () => () => {
      const back = before.current;
      if (back?.isConnected === true && heldIn(null)) back.focus({ preventScroll: true });
    },
    [],
  );
}

/**
 * Asks the owner to close the pane at a press anywhere outside it and its
 * toggle, answering the handler the pane takes its own presses with. Note
 * that the press is heard at the document as it bubbles, after the pane's
 * own handler has marked it, so a press in a menu or a dialog the pane
 * raised, which React carries through the pane, is no press outside.
 */
function usePressOutside(
  open: boolean,
  toggle: OverPaneToggle | undefined,
  onClose: () => void,
): () => void {
  const within = useRef(false);
  const close = useRef(onClose);
  close.current = onClose;
  const toggles = useRef(toggle);
  toggles.current = toggle;
  useEffect(() => {
    if (!open) return undefined;
    within.current = false;
    const press = (event: PointerEvent) => {
      const own = within.current;
      within.current = false;
      const target = event.target;
      if (own || (target instanceof Node && onToggle(toggles.current, target))) return;
      close.current();
    };
    document.addEventListener("pointerdown", press);
    return () => document.removeEventListener("pointerdown", press);
  }, [open]);
  return useCallback(() => {
    within.current = true;
  }, []);
}

/** The pane floating over a tab, drawn while `open` and through its slide out. */
export function OverPane({
  open,
  onClose,
  label,
  edge = OVER_PANE_EDGE.RIGHT,
  width = OVER_PANE_WIDTH.SHEET,
  toggle,
  initialFocus,
  peek = false,
  onPointerLeave,
  children,
}: {
  /** Whether it stands over the tab; falling, it slides out before it is let go. */
  open: boolean;
  /** Escape, or a press outside it and its toggle: the owner closes it. */
  onClose: () => void;
  /** What it is called, read as the region's name. */
  label: string;
  edge?: OverPaneEdge | undefined;
  width?: OverPaneWidth | undefined;
  /** The control that opens and closes it, or each of them where it is drawn twice, whose presses are its own rather than a press outside. */
  toggle?: OverPaneToggle | undefined;
  /** The control that takes the keyboard as it opens; the pane itself where it names none. */
  initialFocus?: RefObject<HTMLElement | null> | undefined;
  /** Whether it stands as a peek, which the pointer opened: it comes a beat late and takes no keyboard until the toggle's press makes it open. */
  peek?: boolean | undefined;
  /** The pointer leaving the pane, which is how its owner puts a peek away. */
  onPointerLeave?: ((event: React.PointerEvent<HTMLElement>) => void) | undefined;
  children: ReactNode;
}): React.JSX.Element | null {
  const pane = useRef<HTMLElement>(null);
  const leaving = useLeaving(open);
  useHeldKeyboard(open && !peek, pane, initialFocus);
  const pin = usePressOutside(open, toggle, onClose);
  if (!open && !leaving) return null;

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Tab") {
      if (!peek) trappedTab(event);
      return;
    }
    if (event.key !== "Escape" || event.defaultPrevented || event.nativeEvent.isComposing) return;
    if (event.target instanceof Element && event.target.closest(KEY_LAYERS) !== null) return;
    // Note that the key goes no further, so a layer behind the tab keeps standing.
    event.preventDefault();
    event.stopPropagation();
    onClose();
  };

  return (
    <PanePin
      ref={pane}
      className="luke-over-pane"
      aria-label={label}
      tabIndex={-1}
      data-edge={edge}
      data-width={width}
      data-state={open ? OVER_PANE_STATE.OPEN : OVER_PANE_STATE.LEAVING}
      data-arrival={open && peek ? OVER_PANE_ARRIVAL.PEEK : undefined}
      inert={!open}
      onPin={open ? pin : undefined}
      onKeyDown={open ? onKeyDown : undefined}
      onPointerLeave={onPointerLeave}
    >
      {children}
    </PanePin>
  );
}
