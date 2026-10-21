import { type ReactNode, useCallback, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { visibleViewport } from "../../visible-viewport.js";

/**
 * tooltip.tsx -- a hover hint as it is drawn: a small dark pill naming a control and its shortcut, or a light card saying more, hung beside the control it names.
 *
 * A pill hangs centred below its control and turns above it where the
 * window ends, so it never covers what it names; a card hangs from the
 * control's start the same way, or beside it, past its end or before its
 * start where the window ends, as a list row's card hangs so it covers none
 * of the rows under it. Either is measured before it is painted, so it is
 * drawn once and where it fits, and placed again whenever it resizes.
 *
 * What is drawn here is the hint alone. When it shows and when it goes, the
 * wait before it, the warm spell after it, and the linger that lets the
 * pointer cross onto a card, are the app's: it hands the hint the control
 * it stands for, whether it skipped the wait (`instant`), and how it is on
 * its way out (`leaving`), and is told when the pointer arrives on a card,
 * presses it, or chooses one of its buttons or links.
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

/** The gap between a control and its hint, and the hint's least distance from the window's edge, in CSS pixels. */
const TOOLTIP_GAP = 6;
const TOOLTIP_MARGIN = 6;

/** What a card holds that a press chooses. */
const CARD_CHOICE = "button, a[href]";

/** Which side of its control a hint hangs on. */
const TOOLTIP_SIDE = {
  BELOW: "below",
  ABOVE: "above",
  /** Beside the control, past its end. */
  END: "end",
  /** Beside the control, before its start, where the window ends past it. */
  START: "start",
} as const;

type TooltipSide = (typeof TOOLTIP_SIDE)[keyof typeof TOOLTIP_SIDE];

/** How a hint is on its way out: fading, having been seen, or at once, having never been. */
export const TOOLTIP_LEAVING = {
  SEEN: "seen",
  UNSEEN: "unseen",
} as const;

export type TooltipLeaving = (typeof TOOLTIP_LEAVING)[keyof typeof TOOLTIP_LEAVING];

/** How a hint hangs: a pill centred on its control, a card from its start, or a card beside it. */
const TOOLTIP_HANG = {
  PILL: "pill",
  CARD: "card",
  CARD_BESIDE: "card-beside",
} as const;

type TooltipHang = (typeof TOOLTIP_HANG)[keyof typeof TOOLTIP_HANG];

/** What every hint is handed: the control it stands for, and how it shows and goes. */
interface TooltipBase {
  /** The hint's id, which the control's `aria-describedby` names while it describes it. */
  id: string;
  /** The control it hangs from. */
  anchor: HTMLElement;
  /** Whether it shows at once rather than after the wait. */
  instant: boolean;
  /** How it is on its way out, while it is: inert, and fading or already hidden. */
  leaving?: TooltipLeaving | undefined;
  /** Its element, for the hold that draws it through its exit. */
  ref?: ((element: HTMLElement | null) => void) | undefined;
}

interface TooltipPlace {
  left: number;
  top: number;
  side: TooltipSide;
}

/** `value` held a margin inside the edges `low` and `high`, for a hint `size` long. */
function clampTo(value: number, size: number, low: number, high: number): number {
  return Math.max(low + TOOLTIP_MARGIN, Math.min(value, high - size - TOOLTIP_MARGIN));
}

/**
 * Where a hint of this size goes for its control: below it, or above where
 * the window ends; centred on it, or from its start for a card. A card hung
 * beside its control stands past the control's end, level with its top and
 * held inside the window, or before its start where the window ends past
 * the control, as a menu turns at the screen's edge.
 */
function placeHint(anchor: HTMLElement, hint: HTMLElement, hang: TooltipHang): TooltipPlace {
  const at = anchor.getBoundingClientRect();
  // Note that its layout size is read rather than its box, because the box
  // is still scaled short by the fade it waits to play.
  const width = hint.offsetWidth;
  const height = hint.offsetHeight;
  const seen = visibleViewport();
  if (hang === TOOLTIP_HANG.CARD_BESIDE) {
    const top = clampTo(at.top, height, seen.top, seen.bottom);
    const past = at.right + TOOLTIP_GAP;
    const before = at.left - TOOLTIP_GAP - width;
    if (past + width > seen.right - TOOLTIP_MARGIN && before >= seen.left + TOOLTIP_MARGIN) {
      return { left: before, top, side: TOOLTIP_SIDE.START };
    }
    return { left: clampTo(past, width, seen.left, seen.right), top, side: TOOLTIP_SIDE.END };
  }
  const below = at.bottom + TOOLTIP_GAP;
  const fits = below + height <= seen.bottom - TOOLTIP_MARGIN;
  const left = hang === TOOLTIP_HANG.PILL ? at.left + at.width / 2 - width / 2 : at.left;
  return {
    left: clampTo(left, width, seen.left, seen.right),
    top: fits ? below : at.top - TOOLTIP_GAP - height,
    side: fits ? TOOLTIP_SIDE.BELOW : TOOLTIP_SIDE.ABOVE,
  };
}

/** The hint's element, placed for its control once measured and again whenever it resizes. */
function useHintPlace(
  anchor: HTMLElement,
  hang: TooltipHang,
  hold: ((element: HTMLElement | null) => void) | undefined,
): readonly [(node: HTMLDivElement | null) => void, TooltipPlace | undefined] {
  const element = useRef<HTMLDivElement | null>(null);
  const [at, setAt] = useState<TooltipPlace | undefined>(undefined);
  const drawn = useCallback(
    (node: HTMLDivElement | null) => {
      element.current = node;
      hold?.(node);
    },
    [hold],
  );
  useLayoutEffect(() => {
    const hint = element.current;
    if (hint === null) return;
    const measure = () => setAt(placeHint(anchor, hint, hang));
    measure();
    // Note that it is placed again whenever it resizes, because a card grows
    // as a read it made lands, and must stay inside the window as it does.
    const observer = new ResizeObserver(measure);
    observer.observe(hint);
    return () => observer.disconnect();
  }, [anchor, hang]);
  return [drawn, at];
}

/** The marks every hint's element carries, which its stylesheet draws from. */
function hintMarks(base: TooltipBase, at: TooltipPlace | undefined) {
  return {
    id: base.id,
    "data-placed": String(at !== undefined),
    "data-side": at?.side ?? TOOLTIP_SIDE.BELOW,
    "data-instant": String(base.instant),
    "data-leaving": base.leaving,
    inert: base.leaving !== undefined,
    style: at === undefined ? undefined : { left: at.left, top: at.top },
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
  const [drawn, at] = useHintPlace(base.anchor, TOOLTIP_HANG.PILL, base.ref);
  return createPortal(
    <div ref={drawn} role="tooltip" className="luke-tooltip" {...hintMarks(base, at)}>
      {label}
      {shortcut}
    </div>,
    document.body,
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
  const hang = beside ? TOOLTIP_HANG.CARD_BESIDE : TOOLTIP_HANG.CARD;
  const [drawn, at] = useHintPlace(base.anchor, hang, base.ref);
  return createPortal(
    // biome-ignore lint/a11y/useKeyWithClickEvents: the click is a card's own button's or link's, bubbled up, which its keys press as well.
    <div
      ref={drawn}
      role="tooltip"
      className="luke-tooltip luke-tooltip-card ph-no-capture"
      {...hintMarks(base, at)}
      onPointerEnter={(event) => {
        if (event.pointerType !== "touch") onHover?.(true);
      }}
      onPointerLeave={(event) => {
        if (event.pointerType !== "touch") onHover?.(false);
      }}
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
    </div>,
    document.body,
  );
}
