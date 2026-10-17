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
 * the same wait and warm spell, drawn as a small light panel from the
 * control's start, the way a browser's tab hover card hangs (`card`). A card
 * is a surface of its own, the way GitHub's hover cards are: the pointer
 * leaving its control lets it linger for `CARD_LINGER`, long enough to
 * cross onto it, and the pointer on it keeps it standing, its words there
 * to be read and selected, until the pointer leaves it for anywhere but its
 * control. While the pointer is on it, only Escape among the keys takes it
 * down, so the shortcut that copies a selection reaches it. A card may hold
 * buttons and links, as GitHub's and Linear's do, and choosing one takes it
 * down; like theirs, it is the pointer's preview, which the keyboard never
 * enters, so what a card's buttons do is offered elsewhere too. One tooltip
 * stands in the window at a time: the next to show takes a lingering card
 * down at once, unless its control stands on that card, as a person named
 * on an agent's card is, when its card hangs over the one beneath, which
 * goes when the pointer leaves both and takes it along. A card hung from a row may name the row (`cardRegion`):
 * the row's other controls, a list row's Pin and Archive, are then part of
 * its control, so the pointer crossing onto them leaves the card standing
 * and their own pills yield to it, while a press anywhere in the row takes
 * it down.
 *
 * Taken down once it has shown, a pill or a card is held drawn through its
 * exit, inert, and only then taken out; one taken down while it still
 * waited was never seen, and goes at once.
 *
 * Its words are text like any other, so the session recording masks them
 * with the rest; nothing of it rides an attribute, and a card is left out
 * of the recording whole.
 */

import { useAtomSet } from "@effect/atom-react";
import { MOTION_DELAY_MS } from "@luke/brand";
import { useStateWithRef } from "@luke/ui/use-state-with-ref";
import { Duration, Effect } from "effect";
import * as Atom from "effect/reactivity/Atom";
import {
  cloneElement,
  type FocusEventHandler,
  type PointerEventHandler,
  type ReactElement,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  APP_SHORTCUTS,
  type KeyedCommand,
  type ShortcutChord,
  shortcutAria,
} from "#shared/shortcuts";
import { rendererRuntime } from "./renderer-runtime";
import { Shortcut } from "./shortcut";
import { useDisclosure } from "./use-disclosure";

/** The gap between a control and its pill, and the pill's least distance from the window's edge, in CSS pixels. */
const TOOLTIP_GAP = 6;
const TOOLTIP_MARGIN = 6;

/**
 * How long after one pill goes the next shows at once. Note that it is the
 * rest delay itself, because a pointer that pauses longer than it would wait
 * anyway has stopped moving between controls.
 */
const WARM_MS = MOTION_DELAY_MS.HINT;

/**
 * How long a card stands once the pointer has left it or its control: long
 * enough to cross the gap between them, even on a slant, and short enough
 * that a pointer moving on has it gone before it looks for it, as Radix's
 * and GitHub's hover cards wait.
 */
const CARD_LINGER = Duration.millis(180);

/** What a card holds that a press chooses, which takes the card down. */
const CARD_CHOICE = "button, a[href]";

/** Which side of its control a pill hangs on. */
const TOOLTIP_SIDE = {
  BELOW: "below",
  ABOVE: "above",
  /** Beside the control, past its end: a card a list row hangs, so it covers none of the rows under it. */
  END: "end",
  /** Beside the control, before its start: a row's card where the window ends past the row, as the plan's summary at its right edge hangs one. */
  START: "start",
} as const;

type TooltipSide = (typeof TOOLTIP_SIDE)[keyof typeof TOOLTIP_SIDE];

/** Until when a newly rested-on control shows its pill at once: the window's one warm spell. */
let warmUntil = 0;

/** A tooltip standing in the window: the way to take it down, the row its card was hung from, and whether a node stands on its card. */
interface Standing {
  readonly hide: () => void;
  /** The row the card was hung from, whose other controls raise nothing of their own while it stands. */
  readonly region: HTMLElement | undefined;
  readonly holds: (node: Node) => boolean;
}

/**
 * The tooltips standing in the window: one, and over it each card hung
 * from a control on the card beneath it, as a person named on an agent's
 * card hangs their own.
 */
const standing: Standing[] = [];

/** Takes down every tooltip standing over the `depth` beneath it, the topmost first, other than the one asking (`own`). */
function takeDownOver(depth: number, own: () => void): void {
  for (const each of standing.slice(depth).reverse()) if (each.hide !== own) each.hide();
}

/** Takes a tooltip off the window's stack, where it stands. */
function unstack(hide: () => void): void {
  const at = standing.findIndex((each) => each.hide === hide);
  if (at !== -1) standing.splice(at, 1);
}

/**
 * A card's linger, as an atom whose work is the wait: it takes the card down
 * once it has run out. Each tooltip has its own, by its id, held for as long
 * as the tooltip is mounted: a new linger starts it afresh and an interrupt
 * calls it off. Note that a card hung over another lingers apart from it,
 * because the pointer leaving the stack lets both linger at once, and the
 * pointer back on either calls off that one's alone. Note too that the way
 * down is handed inside a record, because a function handed to an atom's
 * setter is read as an update of its value and called at once.
 */
const cardLingerAtom = Atom.family((_tooltip: string) =>
  rendererRuntime.fn(({ leave }: { readonly leave: () => void }) =>
    Effect.andThen(Effect.sleep(CARD_LINGER), Effect.sync(leave)),
  ),
);

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

/** A pill drawn: what it stands for, and the words it says, kept through its exit. */
interface Drawn {
  shown: Shown;
  label: string;
}

/** How a pill is on its way out: fading, having been seen, or at once, having never been. */
const PILL_LEAVING = {
  SEEN: "seen",
  UNSEEN: "unseen",
} as const;

type PillLeaving = (typeof PILL_LEAVING)[keyof typeof PILL_LEAVING];

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
 * held inside the window, or before its start where the window ends past
 * the control, as a menu turns at the screen's edge, so it never covers the
 * control it describes.
 */
function pillPlace(
  shown: Shown,
  width: number,
  height: number,
  card: { readonly beside: boolean } | undefined,
): PillPlace {
  const anchor = shown.anchor.getBoundingClientRect();
  if (card?.beside === true) {
    const top = clampTo(anchor.top, height, window.innerHeight);
    const past = anchor.right + TOOLTIP_GAP;
    const before = anchor.left - TOOLTIP_GAP - width;
    if (past + width > window.innerWidth - TOOLTIP_MARGIN && before >= TOOLTIP_MARGIN) {
      return { left: before, top, side: TOOLTIP_SIDE.START };
    }
    return { left: clampTo(past, width, window.innerWidth), top, side: TOOLTIP_SIDE.END };
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
  chord,
  card,
  cardBeside,
  leaving,
  ref: hold,
  onCard,
  onCardPress,
  onCardChoice,
}: {
  id: string;
  shown: Shown;
  label: string;
  chord: ShortcutChord | undefined;
  card: ReactNode;
  cardBeside: boolean;
  /** How it is on its way out, while it is: inert, and fading or already hidden. */
  leaving: PillLeaving | undefined;
  /** Hands its element to the hold that draws it through its exit. */
  ref: (element: HTMLElement | null) => void;
  /** The pointer arriving on the card, or leaving it. */
  onCard: (over: boolean) => void;
  /** A press begun on the card. */
  onCardPress: () => void;
  /** One of the card's buttons or links chosen. */
  onCardChoice: () => void;
}): React.JSX.Element {
  const element = useRef<HTMLDivElement | null>(null);
  const drawn = useCallback(
    (node: HTMLDivElement | null) => {
      element.current = node;
      hold(node);
    },
    [hold],
  );
  const [at, setAt] = useState<PillPlace | undefined>(undefined);
  const carded = card !== undefined;

  useLayoutEffect(() => {
    const drawn = element.current;
    if (drawn === null) return;
    // Note that its layout size is read rather than its box, because the box
    // is still scaled short by the fade it waits to play.
    const placed = carded ? { beside: cardBeside } : undefined;
    const measure = () => setAt(pillPlace(shown, drawn.offsetWidth, drawn.offsetHeight, placed));
    measure();
    // Note that it is placed again whenever it resizes, because a card grows
    // as a read it made lands, and must stay inside the window as it does.
    const observer = new ResizeObserver(measure);
    observer.observe(drawn);
    return () => observer.disconnect();
  }, [shown, label, carded, cardBeside]);

  return createPortal(
    // biome-ignore lint/a11y/useKeyWithClickEvents: the click is a card's own button's or link's, bubbled up, which its keys press as well.
    <div
      ref={drawn}
      id={id}
      role="tooltip"
      className={carded ? "tooltip tooltip-card ph-no-capture" : "tooltip"}
      data-placed={String(at !== undefined)}
      data-side={at?.side ?? TOOLTIP_SIDE.BELOW}
      data-instant={String(shown.instant)}
      data-leaving={leaving}
      inert={leaving !== undefined}
      style={at === undefined ? undefined : { left: at.left, top: at.top }}
      onPointerEnter={carded ? () => onCard(true) : undefined}
      onPointerLeave={carded ? () => onCard(false) : undefined}
      // Note that a card's presses go no further than the card, because the
      // portal still bubbles them through the tree it was drawn from, and a
      // card hung from a mark inside a row's button would otherwise press
      // the row, or take itself down through its own control's press.
      onPointerDown={
        carded
          ? (event) => {
              event.stopPropagation();
              onCardPress();
            }
          : undefined
      }
      onClick={
        carded
          ? (event) => {
              event.stopPropagation();
              if (event.target instanceof Element && event.target.closest(CARD_CHOICE) !== null) {
                onCardChoice();
              }
            }
          : undefined
      }
    >
      {carded ? card : label}
      {chord === undefined || carded ? null : <Shortcut chord={chord} />}
    </div>,
    document.body,
  );
}

/**
 * Wraps one control, which must take the handlers it is handed. `command`
 * adds its chord to the pill and to the control's `aria-keyshortcuts`, and
 * `chord` does the same for a key the control's own surface answers rather
 * than the window, as the picture viewer's bare = and − do. The
 * pill describes the control only where its label is not already the
 * control's own name, so a reader is not told the same word twice. With no
 * label it raises no pill, so a control whose hint comes and goes keeps its
 * place, and its focus, while it does. `card`, while given, is drawn in the
 * pill's place, and always describes the control, since it says more than
 * the control's name; `cardBeside` hangs it past the control's end rather
 * than under it, as a list row's card hangs, or before its start where the
 * window ends past the control. A card's buttons and links
 * take it down once chosen, and stay the pointer's alone, so the card is a
 * description the keyboard never enters. `cardRegion` is the row the
 * control stands in, the whole of which counts as the control while its
 * card stands.
 */
export function Tooltip({
  label,
  command,
  chord: ownChord,
  card,
  cardBeside = false,
  cardRegion,
  children,
}: {
  label: string | undefined;
  command?: KeyedCommand;
  chord?: ShortcutChord | undefined;
  card?: ReactNode;
  cardBeside?: boolean;
  cardRegion?: RefObject<HTMLElement | null>;
  children: ReactElement<AnchorProps>;
}): React.JSX.Element {
  const id = useId();
  const chord = command === undefined ? ownChord : APP_SHORTCUTS[command].chord;
  const [shown, setShown, latest] = useStateWithRef<Shown | undefined>(undefined);
  const carded = card !== undefined;
  // The row a card counts as its control, where it names one; a pill has none.
  const region = useCallback(
    () => (carded ? (cardRegion?.current ?? undefined) : undefined),
    [carded, cardRegion],
  );
  const linger = useAtomSet(cardLingerAtom(id));
  // Note that this is a ref, because the window's key listener reads it,
  // which no render stands between.
  const overCard = useRef(false);
  const pressingCard = useRef(false);
  // The pill is drawn through its exit as it last stood, and as seen or not.
  const asked = shown === undefined || label === undefined ? undefined : { shown, label };
  const [drawn, setDrawn] = useState<Drawn | undefined>(asked);
  if (asked !== undefined && (asked.shown !== drawn?.shown || asked.label !== drawn.label)) {
    setDrawn(asked);
  }
  const [seen, setSeen] = useState(false);
  const pill = useDisclosure(asked !== undefined);
  const pillElement = useRef<HTMLElement | null>(null);
  const holdPill = pill.ref;
  const drawPill = useCallback(
    (element: HTMLElement | null) => {
      pillElement.current = element;
      holdPill(element);
    },
    [holdPill],
  );
  // A pill that was on screen warms the window for the next; one still
  // waiting leaves it as it was.
  const hide = useCallback(() => {
    const shownNow = latest();
    if (shownNow === undefined) return;
    setSeen(visible(shownNow));
    if (visible(shownNow)) warmUntil = performance.now() + WARM_MS;
    // A card going takes down the cards hung from its controls with it.
    const at = standing.findIndex((each) => each.hide === hide);
    if (at !== -1) takeDownOver(at + 1, hide);
    unstack(hide);
    overCard.current = false;
    linger(Atom.Interrupt);
    setShown(undefined);
  }, [latest, setShown, linger]);
  const show = (anchor: HTMLElement) => {
    if (label === undefined) return;
    // The pointer back on a lingering card's control keeps the card as it stands.
    if (latest()?.anchor === anchor) {
      linger(Atom.Interrupt);
      return;
    }
    // A control in the standing card's row is part of that row, and leaves the card standing.
    const top = standing.at(-1);
    if (top !== undefined && top.hide !== hide && top.region?.contains(anchor) === true) return;
    // Note that a control on a standing card hangs its own over it and
    // leaves the card beneath standing, because the pointer is still on it.
    const beneath = standing.findLastIndex((each) => each.hide !== hide && each.holds(anchor));
    takeDownOver(beneath + 1, hide);
    unstack(hide);
    const now = performance.now();
    const name = anchor.getAttribute("aria-label") ?? anchor.textContent?.trim();
    setShown({
      anchor,
      since: now,
      instant: now < warmUntil,
      describes: card !== undefined || name !== label,
    });
    standing.push({
      hide,
      region: region(),
      holds: (node) => pillElement.current?.contains(node) === true,
    });
  };
  // A card on screen lingers for the pointer crossing to it; a pill, or a
  // card still waiting, goes at once.
  const leave = useCallback(() => {
    const standing = latest();
    if (carded && standing !== undefined && visible(standing)) linger({ leave: hide });
    else hide();
  }, [carded, latest, linger, hide]);
  // A selection dragged past the card's edge leaves it standing until the
  // press ends, and the pointer then off the card lets it linger.
  const onCard = (over: boolean) => {
    overCard.current = over;
    if (over) linger(Atom.Interrupt);
    else if (!pressingCard.current) linger({ leave: hide });
  };
  const onCardPress = () => {
    pressingCard.current = true;
    const end = () => {
      window.removeEventListener("pointerup", end, true);
      window.removeEventListener("pointercancel", end, true);
      pressingCard.current = false;
      if (latest() !== undefined && !overCard.current) linger({ leave: hide });
    };
    window.addEventListener("pointerup", end, true);
    window.addEventListener("pointercancel", end, true);
  };
  // A control that goes while its card stands takes the card, and its linger, with it.
  useEffect(
    () => () => {
      if (!standing.some((each) => each.hide === hide)) return;
      unstack(hide);
      linger(Atom.Interrupt);
    },
    [hide, linger],
  );

  // While a pill stands, the window's own movements take it down. A key is
  // a press too, Escape among them, and the key is still the control's or
  // the window's: the pill is no layer of its own to take one. Only a card
  // the pointer is on lets a key other than Escape pass, since that key is
  // most likely the copy of what was selected on it, and a list scrolling
  // within a standing card, this one or one stacked over it, leaves it
  // standing, since that is the cards being read.
  const up = shown !== undefined;
  useEffect(() => {
    if (!up) return;
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" || !overCard.current) hide();
    };
    // Note that a card stacked over this one is portaled apart from it, so a scroll on any standing card is read as the cards being read.
    const scrolled = (event: Event) => {
      const { target } = event;
      const within = target instanceof Node && standing.some((each) => each.holds(target));
      if (!within) hide();
    };
    window.addEventListener("keydown", key, true);
    window.addEventListener("scroll", scrolled, true);
    window.addEventListener("blur", hide);
    return () => {
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("scroll", scrolled, true);
      window.removeEventListener("blur", hide);
    };
  }, [up, hide]);

  // While a card hung from a row stands, the pointer leaving the row, not
  // its control, is what lets it linger, the pointer back anywhere in the
  // row keeps it, and a press anywhere in the row, on the control or one of
  // its siblings, takes it down. Note that these are the row's own events,
  // because the row is no element of this one's, and that the pointer
  // leaving the row onto the card lets nothing linger, because React has
  // told the card the pointer arrived before the window tells the row it
  // left.
  useEffect(() => {
    const row = region();
    if (!up || row === undefined) return;
    const out = () => {
      if (!overCard.current) leave();
    };
    const back = () => linger(Atom.Interrupt);
    row.addEventListener("pointerleave", out);
    row.addEventListener("pointerenter", back);
    row.addEventListener("pointerdown", hide);
    return () => {
      row.removeEventListener("pointerleave", out);
      row.removeEventListener("pointerenter", back);
      row.removeEventListener("pointerdown", hide);
    };
  }, [up, region, leave, linger, hide]);

  const own = children.props;
  const anchor = cloneElement(children, {
    ...(shown?.describes && label !== undefined ? { "aria-describedby": id } : undefined),
    ...(chord === undefined ? undefined : { "aria-keyshortcuts": shortcutAria(chord) }),
    onPointerEnter: (event) => {
      own.onPointerEnter?.(event);
      // A touch has no hover to rest, so it shows nothing.
      if (event.pointerType !== "touch") show(event.currentTarget);
    },
    onPointerLeave: (event) => {
      own.onPointerLeave?.(event);
      // A card hung from a row lingers once the pointer leaves the row instead.
      if (region() === undefined) leave();
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
      // A press on the card takes focus from its control, and leaves the card standing.
      if (!overCard.current) hide();
    },
  });
  return (
    <>
      {anchor}
      {!pill.mounted || drawn === undefined ? null : (
        <TooltipPill
          id={id}
          shown={drawn.shown}
          label={drawn.label}
          chord={chord}
          card={card}
          cardBeside={cardBeside}
          leaving={pill.leaving ? (seen ? PILL_LEAVING.SEEN : PILL_LEAVING.UNSEEN) : undefined}
          ref={drawPill}
          onCard={onCard}
          onCardPress={onCardPress}
          onCardChoice={hide}
        />
      )}
    </>
  );
}
