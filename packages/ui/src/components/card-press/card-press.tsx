import { SELECTION_WORDS } from "@luke/features/words";
import {
  type ButtonHTMLAttributes,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useRef,
} from "react";
import { PRESS_PULSE, pulsePress } from "../../press-pulse.js";
import { type ContextMenuProps, withContextMenu } from "../menu/menu.js";
import { rovingItem } from "../roving-keys/roving-keys.js";
import { holdRun, ListSelectionContext, selectableRow } from "../selection/list-selection.js";

/**
 * card-press.tsx -- the one press a whole card is: a real button that reaches every edge of the card it stands in.
 *
 * A card that opens something when pressed anywhere, a board's task card, a
 * list's task row, a suggestion, a comment thread at rest, is still a card
 * of the app's own: its edge, its ground, its hover, and the controls it
 * holds are the app's. What the card cannot be is a button, because a
 * button holds no button, and a clickable box is no control to a keyboard
 * or a reader. So the press is a button inside the card, holding the words
 * that name it, whose reach covers the card's whole box: the nearest
 * positioned box around it, which the app draws `position: relative`.
 *
 * It reaches the card in one of two ways (`CARD_PRESS_REACH`). Over the
 * card (`OVERLAY`), its reach lies over everything the card holds, so a
 * press anywhere is the button's own, and a drag that starts anywhere starts
 * on it; the card's own controls, a chip or a ⋯, stand over it (`position:
 * relative` and a `z-index` of 1), so a press on one is that control's and
 * never the card's. Through the card (`CARD`), for a card whose words carry
 * their own hover cards and links, as a thread's names and chips do, its
 * reach lets the pointer through, and the button hears every click in the
 * card it stands in (its parent element) instead: a press on what is no
 * control presses the card, one on a control is that control's own, unless
 * the control is one that presses the card too (`alsoPressedBy`), as a
 * mention's chip opens its thread while it shows what it names.
 *
 * Either way the button is the keyboard's way in, so Enter and Space press
 * it and Tab stops on it, and the reader hears it named by its words or
 * `label`. Its ring is drawn on its reach, around the whole card at the
 * card's corner (`CARD_PRESS_CORNER`), and only once the keyboard has moved
 * the focus, as every control's is (`data-focus-ring`). Pressed over the
 * card, the reach takes the pressed fill under the pointer.
 *
 * The press is handed what the pointer held (`CardPressEvent`), so a card
 * that opens something elsewhere may read a ⌘- or Ctrl-click; a middle
 * click is no click, so it presses nothing, as a button's never does. An
 * unavailable press (`disabled`) refuses the keyboard and the pointer alike.
 * Where the app drags its cards by their press, it finds the press by
 * `CARD_PRESS_SELECTOR`.
 *
 * In a `SelectionRegion`, a press with a key (`selectKey`) is a row that can
 * be chosen: ⌘- and ⇧-clicks on the button choose rows rather than press it
 * (`list-selection.ts`), and one chosen takes the selected fill on its
 * reach and is described as selected.
 *
 * A press that is an item of a roving set (`roving`), a list's or a board
 * column's whose box `useRovingKeys` keeps, is one of the set's items: the
 * set's one Tab stop or out of the tab order, the arrows walking to it.
 *
 * It is drawn in Tailwind utilities over the theme, with no shadcn/ui base:
 * a card press has no box of its own, its reach laid over the `Card` it
 * stands in, which carries its look.
 */

/** The press: a bare button holding the words that name its card. */
const PRESS =
  "luke-card-press group/card-press flex min-w-0 flex-col items-stretch border-0 bg-transparent p-0 text-start text-inherit [font:inherit] disabled:cursor-default";

/**
 * The reach, covering every edge of the card, the nearest positioned box,
 * which carries the press's pressed fill, or a chosen card's selected fill
 * as a chosen list row's. Its ring, the keyboard's (`data-focus-ring`), is
 * drawn inside the card's edge, so a scroller the card stands at the edge of
 * never cuts it off. Note that a press through its card lets the pointer
 * reach what the card holds, its hover cards among it, and hears the card's
 * clicks instead.
 */
const REACH =
  "luke-card-press-reach absolute inset-0 rounded-control outline-offset-[calc(-1*var(--luke-focus-ring-width))] transition-[background-color] duration-(--luke-duration-hover) ease-motion-exit group-data-[corner=menu]/card-press:rounded-menu group-data-[reach=card]/card-press:pointer-events-none group-data-[selected=true]/card-press:bg-fill-selected group-[:active:not(:disabled)]/card-press:bg-fill-pressed";

/** How a press reaches its card: lying over it, or hearing through it. */
export const CARD_PRESS_REACH = {
  /** Over everything the card holds, but for the controls it lifts over the press. */
  OVERLAY: "overlay",
  /** Through it: the pointer reaches what the card holds, and the press hears every click on what is no control. */
  CARD: "card",
} as const;

export type CardPressReach = (typeof CARD_PRESS_REACH)[keyof typeof CARD_PRESS_REACH];

/** The corner of the card a press reaches, which its ring is drawn at. */
export const CARD_PRESS_CORNER = {
  /** A control's corner: a task's card or row, a suggestion. */
  CONTROL: "control",
  /** A menu's corner: a card standing on a menu's surface, as a comment thread does. */
  MENU: "menu",
} as const;

export type CardPressCorner = (typeof CARD_PRESS_CORNER)[keyof typeof CARD_PRESS_CORNER];

/** The attribute every press wears. */
const CARD_PRESS_ATTRIBUTE = "data-card-press";

/** What finds a card's press, as a drag's handle does. */
export const CARD_PRESS_SELECTOR = `[${CARD_PRESS_ATTRIBUTE}]`;

/** What a press hands on of the pointer's press: its modifiers, and which button. */
export type CardPressEvent = Pick<
  MouseEvent,
  "altKey" | "ctrlKey" | "metaKey" | "shiftKey" | "button"
>;

/** What a hint wrapped around a press hands it, as around any control: when to show and go, and what it says of the press. */
type CardPressHintProps = Pick<
  ButtonHTMLAttributes<HTMLButtonElement>,
  | "onPointerEnter"
  | "onPointerLeave"
  | "onPointerDown"
  | "onTouchEnd"
  | "onClick"
  | "onFocus"
  | "onBlur"
  | "aria-describedby"
  | "aria-keyshortcuts"
>;

/**
 * Plays a press's pulse on the card `press` reaches, the box its reach
 * covers, a little, as a wide shape gives; on the press itself where no box
 * stands around it but the page's.
 */
function pulseCard(press: HTMLElement): void {
  const reach = press.querySelector(":scope > .luke-card-press-reach");
  const card = reach instanceof HTMLElement ? reach.offsetParent : null;
  const moved = card instanceof HTMLElement && card !== press.ownerDocument.body ? card : press;
  pulsePress(moved, PRESS_PULSE.QUIET);
}

/** What is a control of its own inside a card, whose press is its own rather than the card's. */
const CONTROL = "a, button, input, select, textarea, summary, [role='button'], [role='menuitem']";

/** One whole-card press: `children` named on the button, reaching the card it stands in. */
export function CardPress({
  onPress,
  reach = CARD_PRESS_REACH.OVERLAY,
  alsoPressedBy,
  corner = CARD_PRESS_CORNER.CONTROL,
  label,
  disabled = false,
  selectKey,
  roving = false,
  ref,
  onKeyDown,
  contextMenu,
  onPointerDown,
  onTouchEnd,
  onClick,
  children,
  ...hint
}: CardPressHintProps & {
  /** What pressing the card does, handed the press, whose modifiers it may read. */
  onPress: (event: CardPressEvent) => void;
  /** How it reaches its card: over it, or through it. */
  reach?: CardPressReach | undefined;
  /** Where it reaches through its card, a selector of the controls in it whose own press presses the card too. */
  alsoPressedBy?: string | undefined;
  /** The card's corner, which its ring follows. */
  corner?: CardPressCorner | undefined;
  /** Its accessible name where its words say less, or say nothing visible. */
  label?: string | undefined;
  /** Whether its press is unavailable: refused, and out of the tab order. */
  disabled?: boolean | undefined;
  /** What the card is chosen by in a `SelectionRegion`; a press with none is never chosen. */
  selectKey?: string | undefined;
  /** Whether it is an item of a roving set, whose box keeps one Tab stop that the arrows walk (`useRovingKeys`). */
  roving?: boolean | undefined;
  /** The button, for what focuses it or measures against it. */
  ref?: RefObject<HTMLButtonElement | null> | undefined;
  /** A key pressed on it, as a menu's key opens the card's menu. */
  onKeyDown?: ((event: KeyboardEvent<HTMLElement>) => void) | undefined;
  /** The menu a right-click, the menu key, or a long press on it opens (`useMenu`'s `contextMenu`). */
  contextMenu?: ContextMenuProps | undefined;
  /** What the card is, as the button shows and names it. */
  children: ReactNode;
}): React.JSX.Element {
  const selecting = useContext(ListSelectionContext);
  const choosable = selecting !== undefined && selectKey !== undefined;
  const chosen = choosable && selecting.selected.has(selectKey);
  const own = useRef<HTMLButtonElement | null>(null);
  const held = useCallback(
    (element: HTMLButtonElement | null) => {
      own.current = element;
      if (ref !== undefined) ref.current = element;
    },
    [ref],
  );
  // Note that the listener reads the latest props, so it is added once per card rather than once per render.
  const latest = useRef({ onPress, alsoPressedBy, disabled });
  latest.current = { onPress, alsoPressedBy, disabled };
  useEffect(() => {
    const card = reach === CARD_PRESS_REACH.CARD ? own.current?.parentElement : null;
    if (card === null || card === undefined) return undefined;
    // Note that it hears the click as it goes down, because a chip that presses the card too stops its own press from going further.
    const heard = (event: MouseEvent) => {
      const { onPress: press, alsoPressedBy: through, disabled: refused } = latest.current;
      const target = event.target instanceof Element ? event.target : null;
      if (refused || target === null || own.current?.contains(target)) return;
      const pressesCard = through !== undefined && target.closest(through) !== null;
      const control = target.closest(CONTROL);
      if (!pressesCard && control !== null && card.contains(control)) return;
      if (own.current !== null) pulseCard(own.current);
      press(event);
    };
    card.addEventListener("click", heard, true);
    return () => card.removeEventListener("click", heard, true);
  }, [reach]);
  return (
    <button
      ref={held}
      type="button"
      className={PRESS}
      data-reach={reach}
      data-corner={corner}
      {...{ [CARD_PRESS_ATTRIBUTE]: "" }}
      aria-label={label}
      aria-description={chosen ? SELECTION_WORDS.SELECTED : undefined}
      data-selected={chosen ? "true" : undefined}
      {...(choosable ? selectableRow(selectKey) : {})}
      {...(roving ? rovingItem() : {})}
      disabled={disabled}
      onMouseDown={choosable ? holdRun : undefined}
      onClick={(event: ReactMouseEvent<HTMLButtonElement>) => {
        pulseCard(event.currentTarget);
        // Note that a ⌘- or ⇧-click that chose rows is no press of the card.
        if (!(choosable && selecting.press(selectKey, event))) onPress(event);
        onClick?.(event);
      }}
      onKeyDown={onKeyDown}
      {...hint}
      {...withContextMenu(contextMenu, { onPointerDown, onTouchEnd })}
    >
      {children}
      <span className={REACH} data-focus-ring="" aria-hidden="true" />
    </button>
  );
}
