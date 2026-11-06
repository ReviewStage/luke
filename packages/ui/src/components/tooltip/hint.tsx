import { useAtomSet } from "@effect/atom-react";
import { MOTION_DELAY_MS } from "@repo/brand";
import {
  APP_SHORTCUTS,
  type KeyedCommand,
  type ShortcutChord,
  shortcutAria,
} from "@repo/settings/shortcuts";
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

const WARM_MS = MOTION_DELAY_MS.HINT;

const HINT_REST = Duration.millis(MOTION_DELAY_MS.HINT);

const CARD_LINGER = Duration.millis(MOTION_DELAY_MS.SETTLE);

const MODIFIER_KEYS: ReadonlySet<string> = new Set([
  "Alt",
  "AltGraph",
  "CapsLock",
  "Control",
  "Fn",
  "Meta",
  "Shift",
]);

const OWN_CONTROL =
  "a[href], button, summary, input, textarea, select, label, [role='button'], [role='link'], [role='tab'], [role='switch'], [role^='menuitem'], [role='option'], [role='radio'], [role='checkbox'], [role='slider'], [contenteditable='true']";

const TAKES_FOCUS =
  "a[href], button, summary, input, textarea, select, [tabindex], [contenteditable='true']";

const HOLDS_NO_WORDS = "img, svg, br, hr, wbr";

const SPACING = /\s+/gu;

const HEARD = {
  DESCRIBED: "described",
  SPOKEN: "spoken",
  NAMED: "named",
} as const;

type Heard = (typeof HEARD)[keyof typeof HEARD];

const LONG_PRESS_MENU = "[data-long-press]";

interface CardDoor {
  readonly rest: (touched: boolean) => void;
}

const cardDoors = new WeakMap<HTMLElement, CardDoor>();

let warmUntil = 0;

interface Standing {
  readonly id: string;
  readonly anchor: HTMLElement;
  readonly hide: () => void;
  readonly region: HTMLElement | undefined;
  readonly carded: boolean;
  readonly holds: (node: Node) => boolean;
}

const standing: Standing[] = [];

function takeDownOver(depth: number, own: string): void {
  for (const each of standing.slice(depth).reverse()) if (each.id !== own) each.hide();
}

function unstack(id: string): void {
  const at = standing.findIndex((each) => each.id === id);
  if (at !== -1) standing.splice(at, 1);
}

const hintRestAtom = Atom.fn(({ show }: { readonly show: () => void }) =>
  Effect.andThen(Effect.sleep(HINT_REST), Effect.sync(show)),
);

let resting: { readonly id: string; readonly unhear: () => void } | undefined;

function letGoRest(): void {
  resting?.unhear();
  resting = undefined;
}

function hearRestEnders(stop: () => void): () => void {
  const key = (event: KeyboardEvent) => {
    if (!MODIFIER_KEYS.has(event.key)) stop();
  };
  const scrolled = (event: Event) => {
    const { target } = event;
    if (!(target instanceof Node && standing.some((each) => each.holds(target)))) stop();
  };
  window.addEventListener("keydown", key, true);
  window.addEventListener("scroll", scrolled, true);
  window.addEventListener("blur", stop);
  return () => {
    window.removeEventListener("keydown", key, true);
    window.removeEventListener("scroll", scrolled, true);
    window.removeEventListener("blur", stop);
  };
}

const cardLingerAtom = Atom.family((_tooltip: string) =>
  Atom.fn(({ leave }: { readonly leave: () => void }) =>
    Effect.andThen(Effect.sleep(CARD_LINGER), Effect.sync(leave)),
  ),
);

const noLingerAtom = Atom.fn((_pill: { readonly leave: () => void }) => Effect.void);

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

interface Shown {
  anchor: HTMLElement;
  region: HTMLElement | undefined;
  touched: boolean;
}

interface Drawn {
  shown: Shown;
  label: string;
}

interface HintRest {
  readonly rest: (show: () => void) => void;
  readonly stop: () => void;
}

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

export function hintedControlOf(node: Node): HTMLElement | undefined {
  return standing.findLast((each) => each.holds(node))?.anchor;
}

export function commandKeyshortcuts(command: KeyedCommand): string {
  return shortcutAria(APP_SHORTCUTS[command].chord);
}

function cardDoorFrom(from: HTMLElement | null): CardDoor | undefined {
  for (let each = from; each !== null; each = each.parentElement) {
    const door = cardDoors.get(each);
    if (door !== undefined) return door;
  }
  return undefined;
}

function cardDoorAround(anchor: HTMLElement): CardDoor | undefined {
  return cardDoorFrom(anchor.parentElement);
}

function heardOver(element: HTMLElement, label: string): Heard {
  const name = element.getAttribute("aria-label") ?? element.textContent ?? "";
  if (name.replace(SPACING, "").includes(label.replace(SPACING, ""))) return HEARD.NAMED;
  const spoken = !element.matches(TAKES_FOCUS) && !element.matches(HOLDS_NO_WORDS);
  return spoken ? HEARD.SPOKEN : HEARD.DESCRIBED;
}

const noChange = () => () => {};

let wordsHome: HTMLElement | undefined;

function wordsHomeNow(): HTMLElement {
  if (wordsHome === undefined || !wordsHome.isConnected) {
    wordsHome = document.createElement("div");
    document.body.append(wordsHome);
  }
  return wordsHome;
}

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

function handRef<T>(ref: Ref<T> | undefined, node: T | null): void {
  if (typeof ref === "function") ref(node);
  else if (ref !== null && ref !== undefined) ref.current = node;
}

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
  const { anchor, region } = drawn.shown;
  const placed = { id, anchor, leaving, ref: hold };
  if (card !== undefined) {
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
        chord === undefined ? undefined : <Shortcut chord={chord} className={TOOLTIP_CHORD} />
      }
    />
  );
}

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
  const region = useCallback(
    () => (carded ? (cardRegion?.current ?? undefined) : undefined),
    [carded, cardRegion],
  );
  const linger = useAtomSet(carded ? cardLingerAtom(id) : noLingerAtom);
  const { rest, stop: stopRest } = useHintRest();
  const overCard = useRef(false);
  const pressingCard = useRef(false);
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
  const hide = useCallback(() => {
    if (latest() === undefined) {
      stopRest();
      return;
    }
    if (!carded) warmUntil = performance.now() + WARM_MS;
    const at = standing.findIndex((each) => each.id === id);
    if (at !== -1) takeDownOver(at + 1, id);
    unstack(id);
    overCard.current = false;
    linger(Atom.Interrupt);
    setShown(undefined);
  }, [latest, stopRest, carded, id, setShown, linger]);
  const stand = (anchor: HTMLElement, touched: boolean) => {
    if (label === undefined) return;
    const beneath = standing.findLastIndex((each) => each.id !== id && each.holds(anchor));
    takeDownOver(beneath + 1, id);
    unstack(id);
    const row = region();
    setShown({ anchor, region: row, touched });
    standing.push({
      id,
      anchor,
      hide,
      region: row,
      carded,
      holds: (node) => pillElement.current?.contains(node) === true,
    });
  };
  const show = (anchor: HTMLElement, touched = false) => {
    if (label === undefined) return;
    if (latest()?.anchor === anchor) {
      linger(Atom.Interrupt);
      return;
    }
    const top = standing.at(-1);
    if (top !== undefined && top.id !== id && top.region?.contains(anchor) === true) return;
    const around = carded || anchor.matches(OWN_CONTROL) ? undefined : cardDoorAround(anchor);
    if (around !== undefined) {
      around.rest(touched);
      return;
    }
    if (touched || performance.now() < warmUntil) {
      stopRest();
      stand(anchor, touched);
      return;
    }
    rest(() => stand(anchor, false));
  };
  const showRef = useRef(show);
  useLayoutEffect(() => {
    showRef.current = show;
  });
  const leave = useCallback(() => {
    if (carded && latest() !== undefined) linger({ leave: hide });
    else hide();
  }, [carded, latest, linger, hide]);
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
      const stood = latest();
      if (stood !== undefined && !stood.touched && !overCard.current) {
        linger({ leave: hide });
      }
    };
    window.addEventListener("pointerup", end, true);
    window.addEventListener("pointercancel", end, true);
  };
  useEffect(
    () => () => {
      if (!standing.some((each) => each.id === id)) return;
      unstack(id);
      linger(Atom.Interrupt);
    },
    [id, linger],
  );
  const offersCard = carded && label !== undefined;
  const control = useRef<HTMLElement | null>(null);
  const doorTo = (element: HTMLElement): CardDoor => ({
    rest: (touched) => showRef.current(element, touched),
  });
  const learn = useCallback(
    (element: HTMLElement | null) => {
      const before = control.current;
      if (element === before) return;
      if (before !== null) cardDoors.delete(before);
      control.current = element;
      if (element !== null && offersCard) cardDoors.set(element, doorTo(element));
    },
    [offersCard],
  );
  useEffect(() => {
    const element = control.current;
    if (element === null) return;
    if (offersCard) cardDoors.set(element, doorTo(element));
    else cardDoors.delete(element);
  }, [offersCard]);
  useEffect(
    () => () => {
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

  const wordsId = useId();
  const [heard, setHeard] = useState<Heard>(HEARD.DESCRIBED);
  useLayoutEffect(() => {
    if (label === undefined) return;
    let element = control.current;
    if (element === null || !element.isConnected) {
      element = document.querySelector<HTMLElement>(`[aria-describedby~="${wordsId}"]`);
    }
    if (element === null) return;
    learn(element);
    setHeard(heardOver(element, label));
  });

  const up = shown !== undefined;
  useEffect(() => {
    if (!up) return;
    const key = (event: KeyboardEvent) => {
      if (MODIFIER_KEYS.has(event.key)) return;
      if (event.key === "Escape" || !overCard.current) hide();
    };
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

  useEffect(() => {
    const row = region();
    if (!up || row === undefined) return;
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

  const hold = useTouchHold();
  const fingerPress = useRef(false);
  const shownAtPress = useRef(false);

  const own = children.props;
  const described = label !== undefined && heard === HEARD.DESCRIBED;
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
    ...(chord === undefined ? undefined : { "aria-keyshortcuts": shortcutAria(chord) }),
    ...(typeof children.type === "string" ? { ref: anchorRef } : undefined),
    onPointerEnter: (event) => {
      own.onPointerEnter?.(event);
      learn(event.currentTarget);
      if (event.pointerType !== "touch") show(event.currentTarget);
    },
    onPointerLeave: (event) => {
      own.onPointerLeave?.(event);
      if (event.pointerType === "touch") return;
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
      const { target } = event;
      const onControl = target instanceof Element && target.closest(OWN_CONTROL) !== null;
      if (onControl || event.currentTarget.closest(OWN_CONTROL) !== null) return;
      event.preventDefault();
      show(event.currentTarget, true);
    },
    onFocus: (event) => {
      own.onFocus?.(event);
      if (event.target !== event.currentTarget) return;
      learn(event.currentTarget);
      if (document.documentElement.dataset.keyboard === "true") show(event.currentTarget);
    },
    onBlur: (event) => {
      own.onBlur?.(event);
      if (!overCard.current && latest()?.touched !== true) hide();
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

interface RowHintOptions {
  shown?: boolean | undefined;
  command?: KeyedCommand | undefined;
  card?: ReactNode;
}

const RowHintContext = createContext<RowHintOptions>({});

export function RowHintOptions({
  shown,
  command,
  card,
  children,
}: RowHintOptions & { children: ReactNode }): React.JSX.Element {
  const options = useMemo((): RowHintOptions => ({ shown, command, card }), [shown, command, card]);
  return <RowHintContext.Provider value={options}>{children}</RowHintContext.Provider>;
}

export const RowHint: ListRowHint = ({ label, row, children }) => {
  const { shown = true, ...options } = useContext(RowHintContext);
  return (
    <Tooltip label={shown ? label : undefined} {...options} cardBeside cardRegion={row}>
      {children}
    </Tooltip>
  );
};

export function wholeWordsHint(words: string): OneLineHint {
  return (line, clipped) => <Tooltip label={clipped ? words : undefined}>{line}</Tooltip>;
}
