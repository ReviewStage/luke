import { type PointerEvent, type ReactNode, useRef } from "react";
import { HoverCard, HoverCardContent } from "../../shadcn/hover-card.js";
import { Tooltip, TooltipContent } from "../../shadcn/tooltip.js";

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
 */

/** What a card holds that a press chooses. */
const CARD_CHOICE = "button, a[href]";

/** How a hint keeps inside the window: turning to the other side where its own ends, and pushed along it where it runs past an edge. */
const HINT_COLLISION = { side: "flip", align: "shift", fallbackAxisSide: "none" } as const;

/** The pill's chord, muted against the pill's own dark fill rather than the window's (`hint.tsx`). */
export const TOOLTIP_CHORD =
  "luke-tooltip-chord [--luke-shortcut-ink:var(--luke-color-tooltip-chord)]";

/** What every hint is handed: the control it stands for, and how it shows and goes. */
interface TooltipBase {
  /** The hint's id, which the control's `aria-describedby` names while it describes it. */
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
  onHover,
  onPress,
  onChoice,
  children,
  ...base
}: TooltipBase & {
  /** Whether it hangs beside its control rather than under it. */
  beside?: boolean;
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
  return (
    <HoverCard open>
      <HoverCardContent
        anchor={base.anchor}
        side={beside ? "inline-end" : "bottom"}
        collisionAvoidance={HINT_COLLISION}
        role="tooltip"
        {...hintMarks(base)}
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
