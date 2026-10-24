/**
 * hint.tsx -- the window's one hover hint: a small dark pill naming a control and the shortcut that reaches it.
 *
 * It stands in for the system `title`, which waits over a second, cannot say
 * a shortcut apart from its name, and draws in a style of its own. The pill
 * shows once the pointer rests on its control for `--luke-hint-delay`, or the
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
 * down. The keyboard reaches it too: ⌥↓ on its control (`SHOW_DETAILS`), or
 * Show details in the control's row menu (`showDetailsFrom`), opens it at
 * once, or takes the one already showing on the control's focus, as a
 * non-modal popover with focus inside it, so Tab walks its buttons and
 * links; Escape takes it down and hands focus back to the control, one card
 * at a time where a card hangs from a control on another, and focus leaving
 * it for anywhere else takes it down. One tooltip
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
 * until the pointer has rested out `--luke-hint-delay`, so a pointer sweeping
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
 * A reader hears a hint without waiting for it, since a screen reader's focus
 * marks no keyboard and its cursor rests no pointer: from the control's first
 * render, its words, a card's one-line summary, are the control's
 * description, heard as focus lands on it. A control that takes no focus, a
 * run's time or a mark, is only read by the cursor, which hears no
 * description, so its words are hidden text it owns (`aria-owns`) instead,
 * which the cursor reads at its end, while its own words stay as they are.
 * And a control whose own name already says the words, a card's control
 * among them, is told them once, by its name.
 *
 * Its words are text like any other, so the session recording masks them
 * with the rest; nothing of it rides an attribute, and a card is left out
 * of the recording whole.
 *
 * The pill and the card are drawn, and placed, by `TooltipPill` and
 * `TooltipCard` (`tooltip.tsx`); what is here is when one shows and goes,
 * the warm spell, a card's linger, and the stack of cards hung over one
 * another. The waits are atoms' work on the registry the app's root provides
 * (`RegistryContext`), or the library's own where none is, over no services,
 * so nothing here builds a runtime of its own. Whether focus moved by the
 * keyboard is read from the root's `data-keyboard`, which the app's root
 * marks as the keyboard moves it; an app that marks nothing shows no pill on
 * focus.
 */

import { useAtomSet } from "@effect/atom-react";
import { MOTION_DELAY_MS } from "@luke/brand";
import {
  APP_COMMAND,
  APP_SHORTCUTS,
  type KeyedCommand,
  type ShortcutChord,
  shortcutAria,
  shortcutMatches,
} from "@luke/settings/shortcuts";
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
  type Ref,
  type RefObject,
  type TouchEventHandler,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { useDisclosure } from "../../use-disclosure.js";
import { useStateWithRef } from "../../use-state-with-ref.js";
import type { ListRowHint } from "../list-row/list-row.js";
import { useTouchHold } from "../menu/touch-hold.js";
import type { OneLineHint } from "../one-line/clipped-line.js";
import { Shortcut } from "../shortcut/shortcut.js";
import { VisuallyHidden } from "../visually-hidden/visually-hidden.js";
import { TOOLTIP_CHORD, TooltipCard, TooltipPill } from "./tooltip.js";

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
const CARD_LINGER = Duration.millis(MOTION_DELAY_MS.SETTLE);

/**
 * What a press may land on that is a control of its own: a tap works it
 * rather than showing its hint, so its hint shows on a long press instead.
 */
const OWN_CONTROL =
  "a[href], button, summary, input, textarea, select, label, [role='button'], [role='link'], [role='tab'], [role='switch'], [role='menuitem'], [contenteditable='true']";

/**
 * What takes focus, by Tab or by the arrows of a list it roves in, and so is
 * heard with its description; anything else is only walked by a reader's
 * cursor, which hears none.
 */
const TAKES_FOCUS =
  "a[href], button, summary, input, textarea, select, [tabindex], [contenteditable='true']";

/** What holds no words, so a hint over it is told as its description even where a reader only walks over it. */
const HOLDS_NO_WORDS = "img, svg, br, hr, wbr";

/** What a name is compared by: its letters alone, as a path cut into a file and its lines still says both. */
const SPACING = /\s+/gu;

/** How a reader hears a hint's words: as its control's description, spoken at the end of a control that takes no focus, as words it owns, or not at all where the control's own name already says them. */
const HEARD = {
  DESCRIBED: "described",
  SPOKEN: "spoken",
  NAMED: "named",
} as const;

type Heard = (typeof HEARD)[keyof typeof HEARD];

/** What carries a context menu, whose long press is the menu's rather than a hint's (`useMenu`'s `contextMenu`). */
const LONG_PRESS_MENU = "[data-long-press]";

/** The chord that opens a focused control's card and takes focus into it. */
const DETAILS_CHORD = APP_SHORTCUTS[APP_COMMAND.SHOW_DETAILS].chord;

/**
 * How each control hanging a card opens it from the keyboard, by the
 * control's element, so a menu opened from it can open that card
 * (`showDetailsFrom`). Note that it is keyed by the element, as the tooltip
 * learns it from its ref where the control is an element of the page's own,
 * or else from the first pointer or focus on it, because a control takes
 * only the handlers a hint hands it and wears no mark of ours.
 */
const cardDoors = new WeakMap<HTMLElement, () => void>();

/** Until when a newly rested-on control shows its pill at once: the window's one warm spell. */
let warmUntil = 0;

/** A tooltip standing in the window: its id, the control it hangs from, the way to take it down, the row its card was hung from, and whether a node stands on its card. */
interface Standing {
  readonly id: string;
  readonly anchor: HTMLElement;
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
const hintRestAtom = Atom.fn(({ show }: { readonly show: () => void }) =>
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
  Atom.fn(({ leave }: { readonly leave: () => void }) =>
    Effect.andThen(Effect.sleep(CARD_LINGER), Effect.sync(leave)),
  ),
);

/**
 * A pill's linger, which is none: one atom every pill shares, so only a
 * tooltip that hangs a card holds a linger of its own.
 */
const noLingerAtom = Atom.fn((_pill: { readonly leave: () => void }) => Effect.void);

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
  "aria-owns"?: string | undefined;
  ref?: Ref<HTMLElement> | undefined;
}

/**
 * A pill standing: the control it names, the row a card hung from it hangs
 * beside, whether a finger opened it, by a tap or a long press, rather than a
 * pointer resting or the keyboard, and whether the keyboard entered its card.
 */
interface Shown {
  anchor: HTMLElement;
  region: HTMLElement | undefined;
  touched: boolean;
  entered: boolean;
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
 * the pointer has rested `--luke-hint-delay`, and `stop` calls the wait off,
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

/**
 * The control the standing hint `node` stands on hangs from, as a menu traces
 * a press on an item's card back to its item, the topmost where cards hang
 * over one another; none where `node` stands on no hint.
 */
export function hintedControlOf(node: Node): HTMLElement | undefined {
  return standing.findLast((each) => each.holds(node))?.anchor;
}

/** The chord as `aria-keyshortcuts` spells it, for a control that shows its shortcut without a tooltip. */
export function commandKeyshortcuts(command: KeyedCommand): string {
  return shortcutAria(APP_SHORTCUTS[command].chord);
}

/**
 * The way to open, and enter, the card of the control `from` stands for, as
 * Show details in its menu does: the control itself, or one it stands in.
 * Note that a control inside it, as a creator's face on a task's row, is
 * never asked, because its card is of another thing than the row. Nothing
 * where no card hangs there.
 */
export function showDetailsFrom(from: HTMLElement | null | undefined): (() => void) | undefined {
  for (let each = from ?? null; each !== null; each = each.parentElement) {
    const door = cardDoors.get(each);
    if (door !== undefined) return door;
  }
  return undefined;
}

/**
 * How a reader hears `label` over `element`: never twice, so not at all where
 * its `aria-label`, or else its words, already say it, and spoken at its end
 * where it takes no focus and holds words.
 */
function heardOver(element: HTMLElement, label: string): Heard {
  const name = element.getAttribute("aria-label") ?? element.textContent ?? "";
  if (name.replace(SPACING, "").includes(label.replace(SPACING, ""))) return HEARD.NAMED;
  const spoken = !element.matches(TAKES_FOCUS) && !element.matches(HOLDS_NO_WORDS);
  return spoken ? HEARD.SPOKEN : HEARD.DESCRIBED;
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
function HintWords({
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

/** Hands `node` to a ref of any shape, as a control's own ref is handed beside the tooltip's. */
function handRef<T>(ref: Ref<T> | undefined, node: T | null): void {
  if (typeof ref === "function") ref(node);
  else if (ref !== null && ref !== undefined) ref.current = node;
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
  leaving: boolean;
  hold: (element: HTMLElement | null) => void;
  onCard: (over: boolean) => void;
  onCardPress: () => void;
  onCardChoice: () => void;
}): React.JSX.Element {
  const { anchor, region, entered } = drawn.shown;
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
        entered={entered ? drawn.label : undefined}
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
        chord === undefined ? undefined : <Shortcut chord={chord} className={TOOLTIP_CHORD} />
      }
    />
  );
}

/**
 * Wraps one control, which must take the handlers it is handed. `command`
 * adds its chord to the pill and to the control's `aria-keyshortcuts`, and
 * `chord` does the same for a key the control's own surface answers rather
 * than the window, as the picture viewer's bare = and − do. The
 * label describes the control from its first render, whether or not the pill
 * stands, only where the control's own name does not already say it, so a
 * reader is not told the same words twice, and is spoken at the end of a
 * control that takes no focus, which a reader hears no description of. With no
 * label it raises no pill, so a control whose hint comes and goes keeps its
 * place, and its focus, while it does. `card`, while given, is drawn in the
 * pill's place, its label, the card's one-line summary, heard as the pill's
 * is; `cardBeside` hangs it past the control's end rather
 * than under it, as a list row's card hangs, or before its start where the
 * window ends past the control. A card's buttons and links
 * take it down once chosen; ⌥↓ on the control opens its card and takes
 * focus into it, where Tab walks them and Escape hands focus back, and the
 * control says so in its `aria-keyshortcuts`. `cardRegion` is the row the
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
    // A card the keyboard is in hands focus back to its control as it goes.
    const stood = latest();
    const focused = document.activeElement;
    if (stood?.entered === true && focused !== null && pillElement.current?.contains(focused)) {
      stood.anchor.focus({ preventScroll: true });
    }
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
  const stand = (anchor: HTMLElement, touched: boolean, entered = false) => {
    if (label === undefined) return;
    // Note that a control on a standing card hangs its own over it and
    // leaves the card beneath standing, because the pointer is still on it.
    const beneath = standing.findLastIndex((each) => each.id !== id && each.holds(anchor));
    takeDownOver(beneath + 1, id);
    unstack(id);
    const row = region();
    setShown({ anchor, region: row, touched, entered });
    standing.push({
      id,
      anchor,
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
  // The card opened at once over `anchor`, or the one standing there, with
  // the keyboard in it.
  const enter = (anchor: HTMLElement) => {
    if (!carded || label === undefined) return;
    const stood = latest();
    linger(Atom.Interrupt);
    if (stood?.anchor === anchor) {
      setShown({ ...stood, entered: true });
      return;
    }
    stopRest();
    stand(anchor, false, true);
  };
  // Note that the door a menu opens the card by reads the latest `enter`, because it is offered once for as long as the card is.
  const enterRef = useRef(enter);
  useLayoutEffect(() => {
    enterRef.current = enter;
  });
  // A card on screen lingers for the pointer crossing to it, unless the
  // keyboard is in it; a pill goes at once, and a hint still waiting is
  // called off.
  const leave = useCallback(() => {
    const stood = latest();
    if (stood?.entered === true) return;
    if (carded && stood !== undefined) linger({ leave: hide });
    else hide();
  }, [carded, latest, linger, hide]);
  // A selection dragged past the card's edge leaves it standing until the
  // press ends, and the pointer then off the card lets it linger.
  const onCard = (over: boolean) => {
    overCard.current = over;
    if (over) linger(Atom.Interrupt);
    else if (!pressingCard.current && latest()?.entered !== true) linger({ leave: hide });
  };
  const onCardPress = () => {
    pressingCard.current = true;
    const end = () => {
      window.removeEventListener("pointerup", end, true);
      window.removeEventListener("pointercancel", end, true);
      pressingCard.current = false;
      // A card a finger opened stands until a tap elsewhere, as a popover does.
      const stood = latest();
      if (stood !== undefined && !stood.touched && !stood.entered && !overCard.current) {
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
  // A control hanging a card offers it to the menus opened from it, once
  // its element is known, and hears ⌥↓ while it holds focus.
  const offersCard = carded && label !== undefined;
  const control = useRef<HTMLElement | null>(null);
  const learn = useCallback(
    (element: HTMLElement | null) => {
      const before = control.current;
      if (element === before) return;
      if (before !== null) cardDoors.delete(before);
      control.current = element;
      if (element !== null && offersCard) cardDoors.set(element, () => enterRef.current(element));
    },
    [offersCard],
  );
  useEffect(() => {
    const element = control.current;
    if (element === null) return;
    if (offersCard) cardDoors.set(element, () => enterRef.current(element));
    else cardDoors.delete(element);
  }, [offersCard]);
  const unhearKey = useRef<(() => void) | undefined>(undefined);
  // Note that the key is heard on the window, ahead of the page's own, because a control takes no key handler a hint hands it.
  const hearKey = (element: HTMLElement) => {
    unhearKey.current?.();
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || document.activeElement !== element) return;
      if (!shortcutMatches(DETAILS_CHORD, event)) return;
      event.preventDefault();
      enterRef.current(element);
    };
    window.addEventListener("keydown", key, true);
    unhearKey.current = () => {
      window.removeEventListener("keydown", key, true);
      unhearKey.current = undefined;
    };
  };
  // A control that goes takes its door and its key with it.
  useEffect(
    () => () => {
      unhearKey.current?.();
      if (control.current !== null) cardDoors.delete(control.current);
    },
    [],
  );
  const ownRef = (children.props as AnchorProps).ref;
  const anchorRef = useCallback(
    (element: HTMLElement | null) => {
      handRef(ownRef, element);
      if (element !== null) learn(element);
    },
    [ownRef, learn],
  );

  // How a reader hears the label, read off the control once it is drawn and
  // again as it draws anew, ahead of any focus landing on it.
  const wordsId = useId();
  const [heard, setHeard] = useState<Heard>(HEARD.DESCRIBED);
  useLayoutEffect(() => {
    if (label === undefined) return;
    // Note that a control the tooltip hands no ref is found by the
    // description it was first drawn with, which every control starts on.
    let element = control.current;
    if (element === null || !element.isConnected) {
      element = document.querySelector<HTMLElement>(`[aria-describedby~="${wordsId}"]`);
    }
    if (element === null) return;
    learn(element);
    setHeard(heardOver(element, label));
  });

  // While a pill stands, the window's own movements take it down. A key is
  // a press too, Escape among them, and the key is still the control's or
  // the window's: the pill is no layer of its own to take one. Only a card
  // the pointer is on lets a key other than Escape pass, since that key is
  // most likely the copy of what was selected on it, and a list scrolling
  // within a standing card, this one or one stacked over it, leaves it
  // standing, since that is the cards being read. A card the keyboard is
  // in keeps its keys, Escape taking it down and the window's layered Escape
  // with it, and ⌥↓ on the control is the control's, which enters its card.
  const up = shown !== undefined;
  useEffect(() => {
    if (!up) return;
    const key = (event: KeyboardEvent) => {
      const stood = latest();
      if (stood?.entered === true) {
        if (event.key !== "Escape") return;
        // Note that the press is spent here even where a card stacked over
        // this one, hung from a control on it, is the one to go, because
        // that card may be the pointer's, which leaves the press to the
        // window; so Escape steps back one card at a time and no further.
        event.preventDefault();
        const at = standing.findIndex((each) => each.id === id);
        if (at === standing.length - 1) hide();
        return;
      }
      const { target } = event;
      const onControl = target instanceof Node && stood?.anchor.contains(target) === true;
      if (carded && onControl && shortcutMatches(DETAILS_CHORD, event)) return;
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
  }, [up, latest, carded, hide]);

  // While the keyboard is in a card, focus leaving it for anywhere but its
  // control takes it down, as Tab past its last choice does.
  const entered = shown?.entered === true;
  useEffect(() => {
    if (!entered) return;
    const moved = (event: FocusEvent) => {
      const { target } = event;
      if (!(target instanceof Node)) return;
      if (latest()?.anchor.contains(target) === true) return;
      if (standing.some((each) => each.holds(target))) return;
      hide();
    };
    document.addEventListener("focusin", moved);
    return () => document.removeEventListener("focusin", moved);
  }, [entered, latest, hide]);

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
  // Note that a control hanging a card names ⌥↓ after the chord it already
  // names, its own where the tooltip names none, space apart, as
  // `aria-keyshortcuts` lists several.
  const keyshortcuts = [
    chord === undefined ? own["aria-keyshortcuts"] : shortcutAria(chord),
    offersCard ? shortcutAria(DETAILS_CHORD) : undefined,
  ]
    .filter((each) => each !== undefined && each !== "")
    .join(" ");
  const described = label !== undefined && heard === HEARD.DESCRIBED;
  // Note that the control's own description is kept, ahead of the label.
  const describedBy = [own["aria-describedby"], described ? wordsId : undefined]
    .filter((each) => each !== undefined && each !== "")
    .join(" ");
  const spoken = label !== undefined && heard === HEARD.SPOKEN;
  const owns = [own["aria-owns"], spoken ? wordsId : undefined]
    .filter((each) => each !== undefined && each !== "")
    .join(" ");
  const anchor = cloneElement(children, {
    ...(describedBy === "" ? undefined : { "aria-describedby": describedBy }),
    ...(owns === "" ? undefined : { "aria-owns": owns }),
    ...(keyshortcuts === "" ? undefined : { "aria-keyshortcuts": keyshortcuts }),
    // Note that only an element of the page's own is handed a ref, because a component may spread what it is handed over a ref of its own, as a chip's link address is.
    ...(typeof children.type === "string" ? { ref: anchorRef } : undefined),
    onPointerEnter: (event) => {
      own.onPointerEnter?.(event);
      learn(event.currentTarget);
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
      learn(event.currentTarget);
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
      // Note that a focus on a control inside, as a chip in a fold's line, is
      // that control's to hint, so it raises nothing over it here.
      if (event.target !== event.currentTarget) return;
      learn(event.currentTarget);
      if (offersCard) hearKey(event.currentTarget);
      // Only focus the keyboard moved shows the pill: a press focuses its
      // control too, and has just taken the pill down.
      if (document.documentElement.dataset.keyboard === "true") show(event.currentTarget);
    },
    onBlur: (event) => {
      own.onBlur?.(event);
      if (event.target === event.currentTarget) unhearKey.current?.();
      // A press on the card, anywhere while a finger's hint stands, or focus
      // going into the card the keyboard entered, leaves it to its own close.
      const stood = latest();
      if (!overCard.current && stood?.touched !== true && stood?.entered !== true) hide();
    },
  });
  return (
    <>
      {anchor}
      {described || spoken ? <HintWords id={wordsId} words={label} spoken={spoken} /> : null}
      {!pill.mounted || drawn === undefined ? null : (
        <Hint
          id={id}
          drawn={drawn}
          chord={chord}
          card={card}
          cardBeside={cardBeside}
          leaving={pill.leaving}
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
