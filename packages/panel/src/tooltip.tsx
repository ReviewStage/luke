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
 * it down; such a card hangs beside the row rather than its control, so the
 * control giving its end up to those acts on hover never puts the card over
 * the row.
 *
 * A finger has no hover to rest, so under one a hint is opened by hand,
 * as a popover: a tap on what is no control of its own, a line of words or
 * a mark, opens it at once and another tap closes it; on a control, whose
 * tap is still its own press and a link's still goes where it leads, a long
 * press opens it instead, and its release presses nothing. A control whose
 * long press opens its context menu keeps that press for the menu. A tap
 * anywhere but on the hint or its control, Escape, and a scroll close it.
 *
 * The wait is this window's own, not the stylesheet's: nothing is drawn
 * until the pointer has rested out `--hint-delay`, so a pointer sweeping
 * across a list mounts nothing for the rows it only crosses. The window
 * keeps one wait, since the pointer rests on one control at a time, and a
 * rest begun on the next calls off the last. Only a pill warms the window:
 * a card lingers as the pointer moves on rather than going, and the next
 * control waits its own wait, so a pointer sweeping down a list of carded
 * rows hangs none of them.
 *
 * Taken down once it has shown, a pill or a card is held drawn through its
 * exit, inert, and only then taken out.
 *
 * Its words are text like any other, so the session recording masks them
 * with the rest; nothing of it rides an attribute, and a card is left out
 * of the recording whole.
 *
 * The pill and the card are drawn, and placed, by `@luke/ui`'s `TooltipPill`
 * and `TooltipCard`; what is the window's own is here: when one shows and
 * goes, the warm spell, a card's linger on the window's runtime, and the
 * stack of cards hung over one another.
 */

import { useAtomSet } from "@effect/atom-react";
import { MOTION_DELAY_MS } from "@luke/brand";
import {
  APP_SHORTCUTS,
  type KeyedCommand,
  type ShortcutChord,
  shortcutAria,
} from "@luke/settings/shortcuts";
import {
  type ListRowHint,
  type OneLineHint,
  TOOLTIP_LEAVING,
  TooltipCard,
  type TooltipLeaving,
  TooltipPill,
  useTouchHold,
} from "@luke/ui";
import { useDisclosure } from "@luke/ui/use-disclosure";
import { useStateWithRef } from "@luke/ui/use-state-with-ref";
import { Duration, Effect } from "effect";
import * as Atom from "effect/reactivity/Atom";
import {
  cloneElement,
  createContext,
  type FocusEventHandler,
  type MouseEventHandler,
  type PointerEventHandler,
  type ReactElement,
  type ReactNode,
  type RefObject,
  type TouchEventHandler,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { rendererRuntime } from "./renderer-runtime.js";
import { Shortcut } from "./shortcut.js";

/**
 * How long after one pill goes the next shows at once. Note that it is the
 * rest delay itself, because a pointer that pauses longer than it would wait
 * anyway has stopped moving between controls.
 */
const WARM_MS = MOTION_DELAY_MS.HINT;

/** How long the pointer rests on a control before its hint shows. */
const HINT_REST = Duration.millis(MOTION_DELAY_MS.HINT);

/**
 * How long a card stands once the pointer has left it or its control: long
 * enough to cross the gap between them, even on a slant, and short enough
 * that a pointer moving on has it gone before it looks for it, as Radix's
 * and GitHub's hover cards wait.
 */
const CARD_LINGER = Duration.millis(180);

/**
 * What a press may land on that is a control of its own: a tap works it
 * rather than showing its hint, so its hint shows on a long press instead.
 */
const OWN_CONTROL =
  "a[href], button, summary, input, textarea, select, label, [role='button'], [role='link'], [role='tab'], [role='switch'], [role='menuitem'], [contenteditable='true']";

/** What carries a context menu, whose long press is the menu's rather than a hint's (`useMenu`'s `contextMenu`). */
const LONG_PRESS_MENU = "[data-long-press]";

/** Until when a newly rested-on control shows its pill at once: the window's one warm spell. */
let warmUntil = 0;

/** A tooltip standing in the window: its id, the way to take it down, the row its card was hung from, and whether a node stands on its card. */
interface Standing {
  readonly id: string;
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
function takeDownOver(depth: number, own: string): void {
  for (const each of standing.slice(depth).reverse()) if (each.id !== own) each.hide();
}

/** Takes a tooltip off the window's stack, where it stands. */
function unstack(id: string): void {
  const at = standing.findIndex((each) => each.id === id);
  if (at !== -1) standing.splice(at, 1);
}

/**
 * The window's one wait for a hint, as an atom whose work is the wait: it
 * shows the hint once the rest has run out. A rest begun on another control
 * starts it afresh, which calls off the one before, and an interrupt calls
 * it off. Note that the way up is handed inside a record, as a linger's way
 * down is (`cardLingerAtom`).
 */
const hintRestAtom = rendererRuntime.fn(({ show }: { readonly show: () => void }) =>
  Effect.andThen(Effect.sleep(HINT_REST), Effect.sync(show)),
);

/**
 * Who the window's one wait is for, by an id of theirs, so only they call
 * the wait off, and the way to let go of the window's movements it hears
 * while it runs.
 */
let resting: { readonly id: string; readonly unhear: () => void } | undefined;

/** The window's one wait let go of: its movements no longer heard, and no one's. */
function letGoRest(): void {
  resting?.unhear();
  resting = undefined;
}

/**
 * Hears, while a wait runs, the window's movements that take a hint down
 * once it stands, so they call off a hint still waiting the same way: a key,
 * a scroll anywhere but on a standing card, which is a card being read, and
 * the window losing the keyboard. Answers the way to stop hearing them.
 */
function hearRestEnders(stop: () => void): () => void {
  const scrolled = (event: Event) => {
    const { target } = event;
    if (!(target instanceof Node && standing.some((each) => each.holds(target)))) stop();
  };
  window.addEventListener("keydown", stop, true);
  window.addEventListener("scroll", scrolled, true);
  window.addEventListener("blur", stop);
  return () => {
    window.removeEventListener("keydown", stop, true);
    window.removeEventListener("scroll", scrolled, true);
    window.removeEventListener("blur", stop);
  };
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

/**
 * A pill's linger, which is none: one atom every pill shares, so only a
 * tooltip that hangs a card holds a linger of its own.
 */
const noLingerAtom = rendererRuntime.fn((_pill: { readonly leave: () => void }) => Effect.void);

/** What the tooltip adds to its control's props. */
interface AnchorProps {
  "aria-describedby"?: string | undefined;
  "aria-keyshortcuts"?: string | undefined;
  onPointerEnter?: PointerEventHandler<HTMLElement> | undefined;
  onPointerLeave?: PointerEventHandler<HTMLElement> | undefined;
  onPointerDown?: PointerEventHandler<HTMLElement> | undefined;
  onClick?: MouseEventHandler<HTMLElement> | undefined;
  onTouchEnd?: TouchEventHandler<HTMLElement> | undefined;
  onFocus?: FocusEventHandler<HTMLElement> | undefined;
  onBlur?: FocusEventHandler<HTMLElement> | undefined;
}

/**
 * A pill standing: the control it names, the row a card hung from it hangs
 * beside, whether its label says more than the control's own name, and
 * whether a finger opened it, by a tap or a long press, rather than a
 * pointer resting or the keyboard.
 */
interface Shown {
  anchor: HTMLElement;
  region: HTMLElement | undefined;
  describes: boolean;
  touched: boolean;
}

/** A pill drawn: what it stands for, and the words it says, kept through its exit. */
interface Drawn {
  shown: Shown;
  label: string;
}

/** The window's wait for one hint: `rest` begins it, calling off whichever stood, and `stop` calls it off where it is still this one's. */
interface HintRest {
  readonly rest: (show: () => void) => void;
  readonly stop: () => void;
}

/**
 * The window's one wait, for a hint of the caller's: `rest` shows it once
 * the pointer has rested `--hint-delay`, and `stop` calls the wait off,
 * as the caller unmounting does, and as a key, a scroll, or the window
 * losing the keyboard do while it runs, as they take a standing hint down. `Tooltip` waits through it, and so does a
 * hint drawn by hand, as the diff's gap controls draw theirs.
 */
export function useHintRest(): HintRest {
  const id = useId();
  const wait = useAtomSet(hintRestAtom);
  const stop = useCallback(() => {
    if (resting?.id !== id) return;
    letGoRest();
    wait(Atom.Interrupt);
  }, [id, wait]);
  const rest = useCallback(
    (show: () => void) => {
      letGoRest();
      resting = { id, unhear: hearRestEnders(stop) };
      wait({
        show: () => {
          letGoRest();
          show();
        },
      });
    },
    [id, wait, stop],
  );
  useEffect(() => stop, [stop]);
  return useMemo(() => ({ rest, stop }), [rest, stop]);
}

/** The chord as `aria-keyshortcuts` spells it, for a control that shows its shortcut without a tooltip. */
export function commandKeyshortcuts(command: KeyedCommand): string {
  return shortcutAria(APP_SHORTCUTS[command].chord);
}

/** The pill as it was last shown, or the card in its place, with the chord the pill prints. */
function Hint({
  id,
  drawn,
  chord,
  card,
  cardBeside,
  leaving,
  hold,
  onCard,
  onCardPress,
  onCardChoice,
}: {
  id: string;
  drawn: Drawn;
  chord: ShortcutChord | undefined;
  card: ReactNode;
  cardBeside: boolean;
  leaving: TooltipLeaving | undefined;
  hold: (element: HTMLElement | null) => void;
  onCard: (over: boolean) => void;
  onCardPress: () => void;
  onCardChoice: () => void;
}): React.JSX.Element {
  const { anchor, region } = drawn.shown;
  const placed = { id, anchor, leaving, ref: hold };
  if (card !== undefined) {
    // Note that a card hung from a row hangs beside the whole row, because
    // its control, the row's press, gives its end up to the row's acts as
    // they come in on hover, and a card beside the press would stand over
    // the row's end.
    return (
      <TooltipCard
        {...placed}
        anchor={region ?? anchor}
        beside={cardBeside}
        onHover={onCard}
        onPress={onCardPress}
        onChoice={onCardChoice}
      >
        {card}
      </TooltipCard>
    );
  }
  return (
    <TooltipPill
      {...placed}
      label={drawn.label}
      shortcut={
        chord === undefined ? undefined : <Shortcut chord={chord} className="tooltip-chord" />
      }
    />
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
 * card stands, and which the card hangs from in the control's place.
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
  command?: KeyedCommand | undefined;
  chord?: ShortcutChord | undefined;
  card?: ReactNode;
  cardBeside?: boolean | undefined;
  cardRegion?: RefObject<HTMLElement | null> | undefined;
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
  // Note that only a tooltip hanging a card holds a linger of its own.
  const linger = useAtomSet(carded ? cardLingerAtom(id) : noLingerAtom);
  const { rest, stop: stopRest } = useHintRest();
  // Note that this is a ref, because the window's key listener reads it,
  // which no render stands between.
  const overCard = useRef(false);
  const pressingCard = useRef(false);
  // The pill is drawn through its exit as it last stood.
  const asked = shown === undefined || label === undefined ? undefined : { shown, label };
  const [drawn, setDrawn] = useState<Drawn | undefined>(asked);
  if (asked !== undefined && (asked.shown !== drawn?.shown || asked.label !== drawn.label)) {
    setDrawn(asked);
  }
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
  // A pill that was on screen warms the window for the next; a card, which
  // lingers as the pointer moves on, leaves it as it was, and a hint still
  // waiting is only called off.
  const hide = useCallback(() => {
    if (latest() === undefined) {
      stopRest();
      return;
    }
    if (!carded) warmUntil = performance.now() + WARM_MS;
    // A card going takes down the cards hung from its controls with it.
    const at = standing.findIndex((each) => each.id === id);
    if (at !== -1) takeDownOver(at + 1, id);
    unstack(id);
    overCard.current = false;
    linger(Atom.Interrupt);
    setShown(undefined);
  }, [latest, stopRest, carded, id, setShown, linger]);
  // The hint up over `anchor`, over the standing card it stands on, if any,
  // and in place of every other.
  const stand = (anchor: HTMLElement, touched: boolean) => {
    if (label === undefined) return;
    // Note that a control on a standing card hangs its own over it and
    // leaves the card beneath standing, because the pointer is still on it.
    const beneath = standing.findLastIndex((each) => each.id !== id && each.holds(anchor));
    takeDownOver(beneath + 1, id);
    unstack(id);
    const name = anchor.getAttribute("aria-label") ?? anchor.textContent?.trim();
    const row = region();
    setShown({ anchor, region: row, describes: carded || name !== label, touched });
    standing.push({
      id,
      hide,
      region: row,
      holds: (node) => pillElement.current?.contains(node) === true,
    });
  };
  const show = (anchor: HTMLElement, touched = false) => {
    if (label === undefined) return;
    // The pointer back on a lingering card's control keeps the card as it stands.
    if (latest()?.anchor === anchor) {
      linger(Atom.Interrupt);
      return;
    }
    // A control in the standing card's row is part of that row, and leaves the card standing.
    const top = standing.at(-1);
    if (top !== undefined && top.id !== id && top.region?.contains(anchor) === true) return;
    // Note that the warm spell is read before anything is taken down, so a
    // hint this one takes down never warms the window for it.
    if (touched || performance.now() < warmUntil) {
      stopRest();
      stand(anchor, touched);
      return;
    }
    rest(() => stand(anchor, false));
  };
  // A card on screen lingers for the pointer crossing to it; a pill goes at
  // once, and a hint still waiting is called off.
  const leave = useCallback(() => {
    if (carded && latest() !== undefined) linger({ leave: hide });
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
      // A card a finger opened stands until a tap elsewhere, as a popover does.
      const stood = latest();
      if (stood !== undefined && !stood.touched && !overCard.current) {
        linger({ leave: hide });
      }
    };
    window.addEventListener("pointerup", end, true);
    window.addEventListener("pointercancel", end, true);
  };
  // A control that goes while its card stands takes the card, and its
  // linger, with it; one that goes while its hint waits calls the wait off
  // (`useHintRest`).
  useEffect(
    () => () => {
      if (!standing.some((each) => each.id === id)) return;
      unstack(id);
      linger(Atom.Interrupt);
    },
    [id, linger],
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
    // Note that a finger lifted leaves the row too, which is no pointer moving on.
    const out = (event: PointerEvent) => {
      if (event.pointerType !== "touch" && !overCard.current) leave();
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

  // A hint a finger opened is a popover, which a press off its control and its cards takes down.
  const touchedUp = shown?.touched === true;
  useEffect(() => {
    if (!touchedUp) return;
    const pressed = (event: PointerEvent) => {
      const { target } = event;
      if (!(target instanceof Node)) return;
      if (latest()?.anchor.contains(target) === true) return;
      if (standing.some((each) => each.holds(target))) return;
      hide();
    };
    window.addEventListener("pointerdown", pressed, true);
    return () => window.removeEventListener("pointerdown", pressed, true);
  }, [touchedUp, latest, hide]);

  // A finger's long press on a control, which opens its hint by hand.
  const hold = useTouchHold();
  // Whether the press now ending was a finger's, and whether its hint stood as it went down.
  const fingerPress = useRef(false);
  const shownAtPress = useRef(false);

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
      // A finger lifted leaves its control too, which takes down nothing it opened.
      if (event.pointerType === "touch") return;
      // A card hung from a row lingers once the pointer leaves the row
      // instead, while one still waiting is called off as the press is left.
      if (region() === undefined || latest() === undefined) leave();
    },
    onPointerDown: (event) => {
      own.onPointerDown?.(event);
      fingerPress.current = event.pointerType === "touch";
      shownAtPress.current = latest() !== undefined;
      hide();
      const control = event.currentTarget;
      if (!fingerPress.current || shownAtPress.current || label === undefined) return;
      // Note that an inner control holds for the hint because its tap does not open it.
      const pressed = event.target instanceof Element ? event.target : control;
      if (pressed.closest(OWN_CONTROL) === null || pressed.closest(LONG_PRESS_MENU) !== null) {
        return;
      }
      hold.start(event, () => show(control, true));
    },
    onTouchEnd: (event) => {
      own.onTouchEnd?.(event);
      hold.touchEnd(event);
    },
    onClick: (event) => {
      own.onClick?.(event);
      const tapped = fingerPress.current && !shownAtPress.current;
      fingerPress.current = false;
      shownAtPress.current = false;
      if (!tapped || label === undefined || event.defaultPrevented) return;
      // Note that a control inside the words, a choice bar the hint names, takes its own tap too.
      const { target } = event;
      const onControl = target instanceof Element && target.closest(OWN_CONTROL) !== null;
      if (onControl || event.currentTarget.closest(OWN_CONTROL) !== null) return;
      // Note that the tap is spent here, so a message holding the words shows no actions for it.
      event.preventDefault();
      show(event.currentTarget, true);
    },
    onFocus: (event) => {
      own.onFocus?.(event);
      // Only focus the keyboard moved shows the pill: a press focuses its
      // control too, and has just taken the pill down.
      if (document.documentElement.dataset.keyboard === "true") show(event.currentTarget);
    },
    onBlur: (event) => {
      own.onBlur?.(event);
      // A press on the card, or anywhere while a finger's hint stands, leaves it to its own close.
      if (!overCard.current && latest()?.touched !== true) hide();
    },
  });
  return (
    <>
      {anchor}
      {!pill.mounted || drawn === undefined ? null : (
        <Hint
          id={id}
          drawn={drawn}
          chord={chord}
          card={card}
          cardBeside={cardBeside}
          leaving={pill.leaving ? TOOLTIP_LEAVING.SEEN : undefined}
          hold={drawPill}
          onCard={onCard}
          onCardPress={onCardPress}
          onCardChoice={hide}
        />
      )}
    </>
  );
}

/**
 * What a `ListRow`'s hint hangs beyond its words: whether it raises them at
 * all (`shown`, as a title only cut short is hinted), the shortcut it names,
 * and the card in the pill's place, beside the row, the row its control.
 */
interface RowHintOptions {
  shown?: boolean | undefined;
  command?: KeyedCommand | undefined;
  card?: ReactNode;
  cardBeside?: boolean | undefined;
  cardRegion?: RefObject<HTMLElement | null> | undefined;
}

const RowHintContext = createContext<RowHintOptions>({});

/**
 * Hands the `RowHint` of the `ListRow` inside it what it hangs beyond its
 * words, as one value while none of them changes, so the row's hint draws
 * again only when they do.
 */
export function RowHintOptions({
  shown,
  command,
  card,
  cardBeside,
  cardRegion,
  children,
}: RowHintOptions & { children: ReactNode }): React.JSX.Element {
  const options = useMemo(
    (): RowHintOptions => ({ shown, command, card, cardBeside, cardRegion }),
    [shown, command, card, cardBeside, cardRegion],
  );
  return <RowHintContext.Provider value={options}>{children}</RowHintContext.Provider>;
}

/**
 * A `ListRow`'s hint: this window's tooltip over the row's press, hanging
 * what `RowHintOptions` hands it. Note that the options come by context,
 * because the row takes its hint as a component, which must stay one
 * component across renders for the press it wraps to stay one press.
 */
export const RowHint: ListRowHint = ({ label, children }) => {
  const { shown = true, ...options } = useContext(RowHintContext);
  return (
    <Tooltip label={shown ? label : undefined} {...options}>
      {children}
    </Tooltip>
  );
};

/**
 * The hint over words held to one line (`@luke/ui`'s `OneLine`): the pill
 * reading them whole while the line cuts them short, and none while it
 * draws them whole, since a line drawn whole says nothing twice. The words
 * ride the pill rather than a `title`, which session replay would carry
 * unmasked.
 */
export function wholeWordsHint(words: string): OneLineHint {
  return (line, clipped) => <Tooltip label={clipped ? words : undefined}>{line}</Tooltip>;
}
