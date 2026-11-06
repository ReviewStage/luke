import { SELECTION_WORDS } from "@repo/features/words";
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
import { SelectBox, type SelectBoxPlace } from "../selection/select-box.js";

export { SELECT_BOX_PLACE, type SelectBoxPlace } from "../selection/select-box.js";

const PRESS =
  "ui-card-press group/card-press peer/card-press flex min-w-0 flex-col items-stretch border-0 bg-transparent p-0 text-start text-inherit [font:inherit] disabled:cursor-default";

const REACH =
  "ui-card-press-reach absolute inset-0 rounded-control outline-offset-[calc(-1*var(--ui-focus-ring-width))] transition-[background-color] duration-(--ui-duration-hover) ease-motion-exit group-data-[corner=menu]/card-press:rounded-menu group-data-[reach=card]/card-press:pointer-events-none group-data-[selected=true]/card-press:bg-fill-selected group-[:active:not(:disabled)]/card-press:bg-fill-pressed";

export const CARD_PRESS_REACH = {
  OVERLAY: "overlay",
  CARD: "card",
} as const;

export type CardPressReach = (typeof CARD_PRESS_REACH)[keyof typeof CARD_PRESS_REACH];

export const CARD_PRESS_CORNER = {
  CONTROL: "control",
  MENU: "menu",
} as const;

export type CardPressCorner = (typeof CARD_PRESS_CORNER)[keyof typeof CARD_PRESS_CORNER];

const CARD_PRESS_ATTRIBUTE = "data-card-press";

export const CARD_PRESS_SELECTOR = `[${CARD_PRESS_ATTRIBUTE}]`;

export type CardPressEvent = Pick<
  MouseEvent,
  "altKey" | "ctrlKey" | "metaKey" | "shiftKey" | "button"
>;

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

function pulseCard(press: HTMLElement): void {
  const reach = press.querySelector(":scope > .ui-card-press-reach");
  const card = reach instanceof HTMLElement ? reach.offsetParent : null;
  const moved = card instanceof HTMLElement && card !== press.ownerDocument.body ? card : press;
  pulsePress(moved, PRESS_PULSE.QUIET);
}

const CONTROL =
  "a, button, input, select, textarea, summary, [role='button'], [role='menuitem'], [role='checkbox']";

export function CardPress({
  onPress,
  reach = CARD_PRESS_REACH.OVERLAY,
  alsoPressedBy,
  corner = CARD_PRESS_CORNER.CONTROL,
  label,
  disabled = false,
  selectKey,
  selectBox,
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
  onPress: (event: CardPressEvent) => void;
  reach?: CardPressReach | undefined;
  alsoPressedBy?: string | undefined;
  corner?: CardPressCorner | undefined;
  label?: string | undefined;
  disabled?: boolean | undefined;
  selectKey?: string | undefined;
  selectBox?: SelectBoxPlace | undefined;
  roving?: boolean | undefined;
  ref?: RefObject<HTMLButtonElement | null> | undefined;
  onKeyDown?: ((event: KeyboardEvent<HTMLElement>) => void) | undefined;
  contextMenu?: ContextMenuProps | undefined;
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
  const latest = useRef({ onPress, alsoPressedBy, disabled });
  latest.current = { onPress, alsoPressedBy, disabled };
  useEffect(() => {
    const card = reach === CARD_PRESS_REACH.CARD ? own.current?.parentElement : null;
    if (card === null || card === undefined) return undefined;
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
    <>
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
      {choosable && !disabled && selectBox !== undefined ? (
        <SelectBox selectKey={selectKey} place={selectBox} />
      ) : null}
    </>
  );
}
