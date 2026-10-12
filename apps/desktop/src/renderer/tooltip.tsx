/**
 * tooltip.tsx -- the window's one hover hint: a small dark pill naming a control and the shortcut that reaches it.
 *
 * It stands in for the system `title`, which waits over a second, cannot say
 * a shortcut apart from its name, and draws in a style of its own. The pill
 * shows once the pointer rests on its control for `--hint-delay`, or the
 * control takes focus from the keyboard; once one has shown, the next is
 * shown at once for as long as the pointer keeps moving between controls,
 * the way a menu bar stays open across its titles. Pressing, any key,
 * Escape among them, scrolling, the pointer leaving, and the window losing
 * the keyboard all take it down. It hangs below its control and turns above it where the window ends,
 * so it never covers what it names.
 *
 * A control with more to say than a pill holds hangs a card in its place:
 * the same wait, warm spell, and ways down, drawn as a small light panel
 * from the control's start, the way a browser's tab hover card hangs
 * (`card`).
 *
 * Its words are text like any other, so the session recording masks them
 * with the rest; nothing of it rides an attribute, and a card is left out
 * of the recording whole.
 */

import { MOTION_DELAY_MS } from "@sidecar/surface";
import {
  cloneElement,
  type FocusEventHandler,
  type PointerEventHandler,
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { APP_SHORTCUTS, type KeyedCommand, shortcutAria, shortcutGlyphs } from "#shared/shortcuts";
import { useStateWithRef } from "./use-state-with-ref";

/** The gap between a control and its pill, and the pill's least distance from the window's edge, in CSS pixels. */
const TOOLTIP_GAP = 6;
const TOOLTIP_MARGIN = 6;

/**
 * How long after one pill goes the next shows at once. Note that it is the
 * rest delay itself, because a pointer that pauses longer than it would wait
 * anyway has stopped moving between controls.
 */
const WARM_MS = MOTION_DELAY_MS.HINT;

/** Which side of its control a pill hangs on. */
const TOOLTIP_SIDE = {
  BELOW: "below",
  ABOVE: "above",
  /** Beside the control, past its end: a card a list row hangs, so it covers none of the rows under it. */
  END: "end",
} as const;

type TooltipSide = (typeof TOOLTIP_SIDE)[keyof typeof TOOLTIP_SIDE];

/** Until when a newly rested-on control shows its pill at once: the window's one warm spell. */
let warmUntil = 0;

/** What the tooltip adds to its control's props. */
interface AnchorProps {
  "aria-describedby"?: string | undefined;
  "aria-keyshortcuts"?: string | undefined;
  onPointerEnter?: PointerEventHandler<HTMLElement> | undefined;
  onPointerLeave?: PointerEventHandler<HTMLElement> | undefined;
  onPointerDown?: PointerEventHandler<HTMLElement> | undefined;
  onFocus?: FocusEventHandler<HTMLElement> | undefined;
  onBlur?: FocusEventHandler<HTMLElement> | undefined;
}

/**
 * A pill standing: the control it names, when it began, whether it skipped
 * the wait, and whether its label says more than the control's own name.
 */
interface Shown {
  anchor: HTMLElement;
  since: number;
  instant: boolean;
  describes: boolean;
}

interface PillPlace {
  left: number;
  top: number;
  side: TooltipSide;
}

function clampTo(value: number, size: number, room: number): number {
  return Math.max(TOOLTIP_MARGIN, Math.min(value, room - size - TOOLTIP_MARGIN));
}

/**
 * Where a pill of this size goes for its control: below it, or above where
 * the window ends; centred on it, or from its start for a card. A card hung
 * beside its control stands past the control's end, level with its top and
 * held inside the window.
 */
function pillPlace(
  shown: Shown,
  width: number,
  height: number,
  card: { readonly beside: boolean } | undefined,
): PillPlace {
  const anchor = shown.anchor.getBoundingClientRect();
  if (card?.beside === true) {
    return {
      left: clampTo(anchor.right + TOOLTIP_GAP, width, window.innerWidth),
      top: clampTo(anchor.top, height, window.innerHeight),
      side: TOOLTIP_SIDE.END,
    };
  }
  const below = anchor.bottom + TOOLTIP_GAP;
  const fits = below + height <= window.innerHeight - TOOLTIP_MARGIN;
  const left = card === undefined ? anchor.left + anchor.width / 2 - width / 2 : anchor.left;
  return {
    left: clampTo(left, width, window.innerWidth),
    top: fits ? below : anchor.top - TOOLTIP_GAP - height,
    side: fits ? TOOLTIP_SIDE.BELOW : TOOLTIP_SIDE.ABOVE,
  };
}

/** The chord as its muted glyphs, the way a menu prints it. Hidden from readers: the control says it in `aria-keyshortcuts`. */
export function ShortcutGlyphs({
  command,
  className,
}: {
  command: KeyedCommand;
  className?: string;
}): React.JSX.Element {
  return (
    <span
      className={className ? `shortcut-glyphs ${className}` : "shortcut-glyphs"}
      aria-hidden="true"
    >
      {shortcutGlyphs(APP_SHORTCUTS[command].chord).map((glyph) => (
        <span key={glyph}>{glyph}</span>
      ))}
    </span>
  );
}

/** The chord as `aria-keyshortcuts` spells it, for a control that shows its shortcut without a tooltip. */
export function commandKeyshortcuts(command: KeyedCommand): string {
  return shortcutAria(APP_SHORTCUTS[command].chord);
}

/** Whether a pill has finished waiting and is on screen. */
function visible(shown: Shown): boolean {
  return shown.instant || performance.now() - shown.since >= MOTION_DELAY_MS.HINT;
}

/** The pill itself, or the card in its place, measured before it is painted so it is drawn once and where it fits. */
function TooltipPill({
  id,
  shown,
  label,
  command,
  card,
  cardBeside,
}: {
  id: string;
  shown: Shown;
  label: string;
  command: KeyedCommand | undefined;
  card: ReactNode;
  cardBeside: boolean;
}): React.JSX.Element {
  const element = useRef<HTMLDivElement | null>(null);
  const [at, setAt] = useState<PillPlace | undefined>(undefined);
  const carded = card !== undefined;

  useLayoutEffect(() => {
    const drawn = element.current;
    if (drawn === null) return;
    // Note that its layout size is read rather than its box, because the box
    // is still scaled short by the fade it waits to play.
    const placed = carded ? { beside: cardBeside } : undefined;
    setAt(pillPlace(shown, drawn.offsetWidth, drawn.offsetHeight, placed));
  }, [shown, label, carded, cardBeside]);

  return createPortal(
    <div
      ref={element}
      id={id}
      role="tooltip"
      className={carded ? "tooltip tooltip-card ph-no-capture" : "tooltip"}
      data-placed={String(at !== undefined)}
      data-side={at?.side ?? TOOLTIP_SIDE.BELOW}
      data-instant={String(shown.instant)}
      style={at === undefined ? undefined : { left: at.left, top: at.top }}
    >
      {carded ? card : label}
      {command === undefined || carded ? null : <ShortcutGlyphs command={command} />}
    </div>,
    document.body,
  );
}

/**
 * Wraps one control, which must take the handlers it is handed. `command`
 * adds its chord to the pill and to the control's `aria-keyshortcuts`. The
 * pill describes the control only where its label is not already the
 * control's own name, so a reader is not told the same word twice. With no
 * label it raises no pill, so a control whose hint comes and goes keeps its
 * place, and its focus, while it does. `card`, while given, is drawn in the
 * pill's place, and always describes the control, since it says more than
 * the control's name; `cardBeside` hangs it past the control's end rather
 * than under it, as a list row's card hangs.
 */
export function Tooltip({
  label,
  command,
  card,
  cardBeside = false,
  children,
}: {
  label: string | undefined;
  command?: KeyedCommand;
  card?: ReactNode;
  cardBeside?: boolean;
  children: ReactElement<AnchorProps>;
}): React.JSX.Element {
  const id = useId();
  const [shown, setShown, latest] = useStateWithRef<Shown | undefined>(undefined);
  const show = (anchor: HTMLElement) => {
    if (label === undefined) return;
    const now = performance.now();
    const name = anchor.getAttribute("aria-label") ?? anchor.textContent?.trim();
    setShown({
      anchor,
      since: now,
      instant: now < warmUntil,
      describes: card !== undefined || name !== label,
    });
  };
  // A pill that was on screen warms the window for the next; one still
  // waiting leaves it as it was.
  const hide = useCallback(() => {
    const standing = latest();
    if (standing === undefined) return;
    if (visible(standing)) warmUntil = performance.now() + WARM_MS;
    setShown(undefined);
  }, [latest, setShown]);

  // While a pill stands, the window's own movements take it down. A key is
  // a press too, Escape among them, and the key is still the control's or
  // the window's: the pill is no layer of its own to take one.
  const standing = shown !== undefined;
  useEffect(() => {
    if (!standing) return;
    window.addEventListener("keydown", hide, true);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("blur", hide);
    return () => {
      window.removeEventListener("keydown", hide, true);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("blur", hide);
    };
  }, [standing, hide]);

  const own = children.props;
  const anchor = cloneElement(children, {
    ...(shown?.describes && label !== undefined ? { "aria-describedby": id } : undefined),
    ...(command === undefined
      ? undefined
      : { "aria-keyshortcuts": shortcutAria(APP_SHORTCUTS[command].chord) }),
    onPointerEnter: (event) => {
      own.onPointerEnter?.(event);
      // A touch has no hover to rest, so it shows nothing.
      if (event.pointerType !== "touch") show(event.currentTarget);
    },
    onPointerLeave: (event) => {
      own.onPointerLeave?.(event);
      hide();
    },
    onPointerDown: (event) => {
      own.onPointerDown?.(event);
      hide();
    },
    onFocus: (event) => {
      own.onFocus?.(event);
      // Only focus the keyboard moved shows the pill: a press focuses its
      // control too, and has just taken the pill down.
      if (document.documentElement.dataset.keyboard === "true") show(event.currentTarget);
    },
    onBlur: (event) => {
      own.onBlur?.(event);
      hide();
    },
  });
  return (
    <>
      {anchor}
      {shown === undefined || label === undefined ? null : (
        <TooltipPill
          id={id}
          shown={shown}
          label={label}
          command={command}
          card={card}
          cardBeside={cardBeside}
        />
      )}
    </>
  );
}
