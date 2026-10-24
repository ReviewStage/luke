import {
  type PointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { HoverCard, HoverCardContent } from "../../shadcn/hover-card.js";
import { Tooltip, TooltipContent } from "../../shadcn/tooltip.js";
import { VisuallyHidden } from "../visually-hidden/visually-hidden.js";

/**
 * tooltip.tsx -- a hover hint as it is drawn: a small dark pill naming a control and its shortcut, or a light card saying more, hung beside the control it names.
 *
 * A pill hangs centred below its control and turns above it where the
 * window ends, so it never covers what it names; a card hangs from the
 * control's start the same way, or beside it, past its end or before its
 * start where the window ends, as a list row's card hangs so it covers none
 * of the rows under it. Either is held a margin inside the window, placed
 * by shadcn/ui's Base UI tooltip and hover card (`../../shadcn/tooltip.tsx`,
 * `hover-card.tsx`), which keep it unseen until it is placed and place it
 * again as it, its control, or the window moves or resizes.
 *
 * What is drawn here is the hint alone. When it shows and when it goes, the
 * wait before it, the warm spell after it, and the linger that lets the
 * pointer cross onto a card, are `Tooltip`'s (`hint.tsx`): it mounts the hint once the
 * wait is over, hands it the control it stands for and how it is on its
 * way out (`leaving`), and is told when the pointer arrives on a card,
 * presses it, or chooses one of its buttons or links. So Base UI's root
 * stands open for as long as the hint is mounted, with no trigger of its
 * own, and what it hears as a dismissal is left to `Tooltip`.
 *
 * A pill takes no presses, so it never stands between the pointer and the
 * control beside it. A card is a surface the pointer crosses onto: its words
 * can be selected, and its presses go no further than the card, because the
 * portal still bubbles them through the tree it was drawn from, and a card
 * hung from a mark inside a row's button would otherwise press the row. Its
 * words are the app's, so a card is left out of a session recording whole,
 * by the recorder's fixed `ph-no-capture` class. A finger has no hover, so
 * its touch arriving on a card, or lifting off it, tells the app nothing of
 * a pointer resting there; its press still does.
 *
 * A card the keyboard entered (`entered`, ⌥↓ on its control) is no longer a
 * description but a popover the keyboard is in: a non-modal dialog named as
 * its control is, which takes focus to its first button or link, or to
 * itself where it holds none, so Tab walks what it holds. Its keys go no
 * further up the tree it was drawn from than its presses do, since a list
 * that walks its rows by the arrows would otherwise take them, bar a Command
 * chord, which is still the window's.
 *
 * A reader hears a hint's words apart from either: `TooltipWords` keeps them
 * for the control from its first render, whether or not a hint is drawn,
 * since a reader's focus or cursor rests on a control without resting the
 * pointer or marking the keyboard.
 */

/** What a card holds that a press chooses, and that the keyboard walks once it is entered. */
const CARD_CHOICE = "button, a[href]";

/** An entered card's look: no ring of its own when focus lands on it, as a popover panel wears none, its standing open saying where the keyboard is. */
const ENTERED = "focus-visible:outline-none";

/** How many frames focus is tried into a card the keyboard entered before it is given up. */
const FOCUS_FRAMES = 10;

/**
 * Moves focus into a card the keyboard entered: to its first choice, or to
 * the card itself where it holds none. Note that it tries again each frame
 * for a few, because the card fades in from `visibility: hidden`
 * (`luke-tooltip-fade`), which refuses focus until its first frame is drawn.
 * Answers the way to stop trying.
 */
function focusInto(card: HTMLElement): () => void {
  let frame = 0;
  let tries = 0;
  const attempt = () => {
    (card.querySelector<HTMLElement>(CARD_CHOICE) ?? card).focus({ preventScroll: true });
    tries += 1;
    if (!card.contains(document.activeElement) && tries < FOCUS_FRAMES) {
      frame = requestAnimationFrame(attempt);
    }
  };
  attempt();
  return () => cancelAnimationFrame(frame);
}

/** Hears no change, since whether this is a window never changes once drawn. */
const noChange = () => () => {};

/** The one element at the window body's end that every hint's words stand in, made with the first. */
let wordsHome: HTMLElement | undefined;

/**
 * The element hints' words stand in, made afresh where the body it stood in
 * was emptied. Note that words are still taken out of one so emptied, which
 * still holds them, where taken out of the body itself they would throw.
 */
function wordsHomeNow(): HTMLElement {
  if (wordsHome === undefined || !wordsHome.isConnected) {
    wordsHome = document.createElement("div");
    document.body.append(wordsHome);
  }
  return wordsHome;
}

/**
 * A hint's words as a reader hears them, from the control's first render
 * rather than once the hint is drawn: its description (`aria-describedby`),
 * heard as focus lands on it, hidden; or, `spoken`, words of a control that
 * takes no focus, which it owns (`aria-owns`) so a reader's cursor reads them
 * at its end, drawn nowhere. Either stands at the window body's end rather
 * than in or beside the control, so the control's own words, and the row or bar
 * around it, are as they were. Note that a server, which has no body, draws
 * none, and the window then draws them as it takes the page over.
 */
export function TooltipWords({
  id,
  words,
  spoken,
}: {
  id: string;
  words: string;
  spoken: boolean;
}): React.ReactNode {
  const inWindow = useSyncExternalStore(
    noChange,
    () => true,
    () => false,
  );
  if (!inWindow) return null;
  return createPortal(
    spoken ? (
      <VisuallyHidden id={id}>{words}</VisuallyHidden>
    ) : (
      <span id={id} hidden>
        {words}
      </span>
    ),
    wordsHomeNow(),
  );
}

/** How a hint keeps inside the window: turning to the other side where its own ends, and pushed along it where it runs past an edge. */
const HINT_COLLISION = { side: "flip", align: "shift", fallbackAxisSide: "none" } as const;

/** The pill's chord, muted against the pill's own dark fill rather than the window's (`hint.tsx`). */
export const TOOLTIP_CHORD =
  "luke-tooltip-chord [--luke-shortcut-ink:var(--luke-color-tooltip-chord)]";

/** What every hint is handed: the control it stands for, and how it shows and goes. */
interface TooltipBase {
  /** The hint's own id, apart from its words' (`TooltipWords`), which describe its control. */
  id: string;
  /** The control it hangs from. */
  anchor: HTMLElement;
  /** Whether it is on its way out: inert, and fading. */
  leaving?: boolean | undefined;
  /** Its element, for the hold that draws it through its exit. */
  ref?: ((element: HTMLElement | null) => void) | undefined;
}

/** The marks every hint carries, which its look draws from: its id, and how it is leaving, inert meanwhile. */
function hintMarks(base: TooltipBase) {
  return {
    id: base.id,
    ref: base.ref,
    "data-leaving": base.leaving === true ? "" : undefined,
    inert: base.leaving === true,
  } as const;
}

/** A pill naming its control in `label`, with the shortcut that reaches it where there is one. */
export function TooltipPill({
  label,
  shortcut,
  ...base
}: TooltipBase & {
  label: string;
  /** The control's chord, drawn after its name in the pill's muted ink. */
  shortcut?: ReactNode;
}): React.JSX.Element {
  return (
    <Tooltip open>
      <TooltipContent
        anchor={base.anchor}
        collisionAvoidance={HINT_COLLISION}
        role="tooltip"
        {...hintMarks(base)}
      >
        {label}
        {shortcut}
      </TooltipContent>
    </Tooltip>
  );
}

/** A card saying more about its control than a pill holds, as a surface the pointer may cross onto. */
export function TooltipCard({
  beside = false,
  entered,
  onHover,
  onPress,
  onChoice,
  children,
  ...base
}: TooltipBase & {
  /** Whether it hangs beside its control rather than under it. */
  beside?: boolean;
  /** The words naming it once the keyboard has entered it, as a dialog; until then it is its control's description. */
  entered?: string | undefined;
  /** The pointer arriving on the card, or leaving it; never a finger's touch. */
  onHover?: (over: boolean) => void;
  /** A press begun on the card. */
  onPress?: () => void;
  /** One of the card's buttons or links chosen. */
  onChoice?: () => void;
  children: ReactNode;
}): React.JSX.Element {
  // Note that each card stands in a portal node of its own, and React tells
  // a card hung over another of one pointer crossing once for each portal
  // node the move bubbles through, so a crossing already told is heard once.
  const told = useRef<Event | undefined>(undefined);
  const hover = (over: boolean, event: PointerEvent<HTMLElement>) => {
    if (event.pointerType === "touch" || event.nativeEvent === told.current) return;
    told.current = event.nativeEvent;
    onHover?.(over);
  };
  // Note that the card's element is state, because Base UI's portal draws it
  // a render after the card mounts, and focus goes in once both stand.
  const [element, setElement] = useState<HTMLElement | null>(null);
  const hold = base.ref;
  const ref = useCallback(
    (node: HTMLElement | null) => {
      setElement(node);
      hold?.(node);
    },
    [hold],
  );
  const keyed = entered !== undefined;
  useEffect(() => {
    if (!keyed || element === null) return;
    return focusInto(element);
  }, [keyed, element]);
  return (
    <HoverCard open>
      <HoverCardContent
        anchor={base.anchor}
        side={beside ? "inline-end" : "bottom"}
        collisionAvoidance={HINT_COLLISION}
        {...hintMarks(base)}
        ref={ref}
        {...(keyed
          ? { role: "dialog", "aria-label": entered, tabIndex: -1, className: ENTERED }
          : { role: "tooltip" })}
        onKeyDown={(event) => {
          if (keyed && !event.metaKey && !event.ctrlKey) event.stopPropagation();
        }}
        onPointerEnter={(event) => hover(true, event)}
        onPointerLeave={(event) => hover(false, event)}
        onPointerDown={(event) => {
          event.stopPropagation();
          onPress?.();
        }}
        onClick={(event) => {
          event.stopPropagation();
          if (event.target instanceof Element && event.target.closest(CARD_CHOICE) !== null) {
            onChoice?.();
          }
        }}
      >
        {children}
      </HoverCardContent>
    </HoverCard>
  );
}
