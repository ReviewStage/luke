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
 *
 * The pill and the card are drawn, and placed, by `@luke/ui`'s `TooltipPill`
 * and `TooltipCard`; what is the window's own is here: when one shows and
 * goes, the warm spell, a card's linger on the window's runtime, and the
 * stack of cards hung over one another.
 */

import { useAtomSet } from "@effect/atom-react";
import { MOTION_DELAY_MS } from "@luke/brand";
import { rendererRuntime } from "@luke/panel/renderer-runtime";
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
} from "@luke/ui";
import { useDisclosure } from "@luke/ui/use-disclosure";
import { useStateWithRef } from "@luke/ui/use-state-with-ref";
import { Duration, Effect } from "effect";
import * as Atom from "effect/reactivity/Atom";
import {
  cloneElement,
  createContext,
  type FocusEventHandler,
  type PointerEventHandler,
  type ReactElement,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { Shortcut } from "./shortcut";

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

/** The chord as `aria-keyshortcuts` spells it, for a control that shows its shortcut without a tooltip. */
export function commandKeyshortcuts(command: KeyedCommand): string {
  return shortcutAria(APP_SHORTCUTS[command].chord);
}

/** Whether a pill has finished waiting and is on screen. */
function visible(shown: Shown): boolean {
  return shown.instant || performance.now() - shown.since >= MOTION_DELAY_MS.HINT;
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
  const { anchor, instant } = drawn.shown;
  const placed = { id, anchor, instant, leaving, ref: hold };
  if (card !== undefined) {
    return (
      <TooltipCard
        {...placed}
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
        <Hint
          id={id}
          drawn={drawn}
          chord={chord}
          card={card}
          cardBeside={cardBeside}
          leaving={
            pill.leaving ? (seen ? TOOLTIP_LEAVING.SEEN : TOOLTIP_LEAVING.UNSEEN) : undefined
          }
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
  shown?: boolean;
  command?: KeyedCommand;
  card?: ReactNode;
  cardBeside?: boolean;
  cardRegion?: RefObject<HTMLElement | null>;
}

const RowHintContext = createContext<RowHintOptions>({});

/** Hands the `RowHint` of the `ListRow` inside it what it hangs beyond its words. */
export function RowHintOptions({
  children,
  ...options
}: RowHintOptions & { children: ReactNode }): React.JSX.Element {
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
