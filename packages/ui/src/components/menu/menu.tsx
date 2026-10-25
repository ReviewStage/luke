import type { BaseUIEvent } from "@base-ui/react/types";
import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { cn } from "../../cn.js";
import { CheckIcon, ChevronRightIcon } from "../../face/glyphs.js";
import { PRESS_PULSE, pulseOnPress } from "../../press-pulse.js";
import {
  DROPDOWN_MENU_ITEM,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "../../shadcn/dropdown-menu.js";
import { useDisclosure } from "../../use-disclosure.js";
import { visibleViewport } from "../../visible-viewport.js";
import { OneLine } from "../one-line/one-line.js";
import { ROVING_STOP, rovingItem, useRovingKeys } from "../roving-keys/roving-keys.js";
import { SCROLL_FADE, SCROLL_SIZE, ScrollArea } from "../scroll-area/scroll-area.js";
import { SwitchMark } from "../switch/switch.js";
import { hintedControlOf, Tooltip } from "../tooltip/hint.js";
import { MenuGlyph } from "./menu-surface.js";
import { useTouchHold } from "./touch-hold.js";

/**
 * menu.tsx -- a drop-down menu hung at a point in the window: a thing's ⋯, its right-click, and an account's row all open one.
 *
 * It behaves as a system menu does: focus on its first item, the arrow keys
 * between items, and Escape, Tab, a press elsewhere, or the window losing
 * the keyboard closing it with focus back where it was. An item that does
 * not apply now is drawn dimmed and passed over, as a system menu's is. An
 * item may open a submenu beside it instead of acting, as a system menu's
 * does: resting on it, pressing it, or Right opens it, Left or Escape in it
 * closes it alone, and resting on another item closes it. A submenu is a
 * flyout, a second menu on its own surface beside the first, which stands
 * whole behind it; it is never a page drawn in the menu's place. Closing
 * hands focus back at once and plays the menu's exit after it: the menu is
 * held drawn, inert, until the exit is done, and opening it again in that
 * time takes it back as it stands.
 *
 * It hangs at a point rather than from its button's box, which is what lets
 * a right-click hang it at the pointer; a popover hung from its own button,
 * as the desktop composer's chips hang theirs, is `AnchoredPopover`. A
 * shortcut an item takes is the app's: it hands the words it prints as the
 * item's `hint`.
 *
 * A label or a detail wider than the menu fades out over its last few
 * pixels, as every cut line of the app does. An item may hang its thing's
 * card beside itself while the pointer rests on it, as a picker's row does
 * (`card`): the item's description, which the keyboard never enters, so the
 * focus and the arrows stay the menu's while it stands, and a press on it
 * is a press on the menu rather than one that closes it.
 *
 * An item stands outside a menu too, among a searchable menu's pinned rows,
 * whose keys stay in the menu's field (`SteeredMenuItem`): a button the
 * field names while it holds the one highlight the arrows and the pointer
 * both move, which a press never takes focus to.
 *
 * It is shadcn/ui's dropdown menu over Base UI (`../../shadcn/dropdown-menu.tsx`),
 * which places it, keys it (the arrows, Home, End, and a typed name), and
 * draws it in the Tailwind theme. A right-click's menu is the same menu
 * hung at the pointer, so `useMenu`'s `contextMenu` stays the spread an
 * element carries rather than a Base UI context menu wrapped around it.
 * Each part keeps its `luke-menu*` name beside its classes, which the
 * panel's layer rule and the tests find it by.
 */

/** Which way from the point it hangs at a menu grows: rightward from it, or leftward to it. */
export const MENU_ALIGN = {
  START: "start",
  END: "end",
} as const;

type MenuAlign = (typeof MENU_ALIGN)[keyof typeof MENU_ALIGN];

/** Which way from the point it hangs at a menu grows: down from it, or up to it. */
const MENU_GROW = {
  DOWN: "down",
  UP: "up",
} as const;

type MenuGrow = (typeof MENU_GROW)[keyof typeof MENU_GROW];

/** The gap a menu keeps from the window's edges, in CSS pixels. */
const MENU_MARGIN = 8;
/** The menu's own padding around its items, `--luke-menu-inset`, which a submenu rises by so its first item is level with its opener. */
const MENU_INSET = 4;
/** How a setting in a menu says whether it is on: a check at its end while it is, or a switch. */
export const MENU_ITEM_MARK = {
  CHECK: "check",
  SWITCH: "switch",
} as const;

export type MenuItemMark = (typeof MENU_ITEM_MARK)[keyof typeof MENU_ITEM_MARK];

/** Where an item's detail stands: a second line under its label, or beside it on the one line, as a picker's row says a person's email. */
export const MENU_DETAIL = {
  UNDER: "under",
  BESIDE: "beside",
} as const;

export type MenuDetailPlace = (typeof MENU_DETAIL)[keyof typeof MENU_DETAIL];

/** The gap between a button and the menu dropped from it. */
export const MENU_DROP = 4;
/** The items the menu's keys move between: every one that applies now, a setting's as an action's. */
const MENU_ITEM =
  ':is([role="menuitem"], [role="menuitemcheckbox"]):not(:disabled, [aria-disabled="true"])';
/** How a submenu finds room: the menu's other side where its own has none, and rising to end level with its item where the window's foot leaves no room below. */
const BESIDE_OR_ACROSS = { side: "flip", align: "flip", fallbackAxisSide: "none" } as const;
/** How a menu is held inside what can be seen: never turned to its other side, only moved along either axis until it fits, as it was clamped. */
const HELD_INSIDE = { side: "shift", align: "shift", fallbackAxisSide: "none" } as const;

/** Where a menu hangs: a point in the window, and which ways from it the menu grows; down where no way is said. */
export interface MenuPlacement {
  x: number;
  y: number;
  align: MenuAlign;
  grow?: MenuGrow;
}

export interface MenuAction {
  label: string;
  /** The glyph leading the label, drawn in a column every item keeps whether or not it has one. */
  icon?: React.JSX.Element;
  /** A muted second line under the label, such as who shares a workspace, which a reader hears after it. */
  detail?: string | undefined;
  /** Where the detail stands: under the label where none is said, or beside it. */
  detailPlace?: MenuDetailPlace | undefined;
  onSelect: () => void;
  /** Drawn red: the action cannot be taken back, or ends what it acts on, as closing a pull request or canceling a task does. */
  danger?: boolean;
  /** Printed muted at the item's end: the shortcut that takes the same action, as the app draws it. */
  hint?: React.ReactNode;
  /** Drawn dimmed and not chosen: the action does not apply now. */
  disabled?: boolean;
  /** A setting rather than an action: whether it is on, a check at the item's end saying so. */
  checked?: boolean | undefined;
  /** How a setting says whether it is on: a check (where none is said) or a switch. */
  mark?: MenuItemMark | undefined;
  /** Whether choosing it opens a list beside it rather than acting, which a chevron at its end says. */
  opens?: boolean | undefined;
  /** Whether choosing it leaves the menu standing, as one of several values a filter toggles is. */
  stays?: boolean | undefined;
  /** The card hung beside the item while the pointer rests on it, as a person's in a people filter; none hangs nothing. */
  card?: React.ReactNode;
}

/**
 * An item of a list whose keys stay in a field rather than moving focus, as
 * a searchable menu's pinned rows are: a button, or a switch for a setting,
 * that the field names while it holds the list's one highlight.
 */
export interface SteeredMenuItem {
  /** Its id, which the field names while it holds the highlight. */
  id: string;
  highlighted: boolean;
  /** The pointer moved over it, which is the highlight's to answer. */
  onHover: () => void;
  /** Whether the list it opens stands beside it now, for an item that `opens` one. */
  expanded?: boolean | undefined;
}

/** An item that opens a menu of its own beside it rather than acting. */
export interface MenuSubmenu {
  label: string;
  icon?: React.JSX.Element;
  items: readonly MenuAction[];
}

/** One line of a menu: an action, or a submenu of them. */
export type MenuEntry = MenuAction | MenuSubmenu;

/** A menu standing open: where it hangs, and the control that opened it, which takes focus back. */
export interface OpenMenu {
  placement: MenuPlacement;
  opener: HTMLElement;
}

/** A menu drawn: standing open, or on its way out, and the element its exit is waited on. */
export interface DrawnMenu extends OpenMenu {
  /** The id the menu stands under, which its trigger's `aria-controls` names. */
  id: string;
  leaving: boolean;
  ref: (element: HTMLElement | null) => void;
}

/**
 * The layer a menu stands in: over the window, or over the modal it was
 * opened from. A menu is drawn over `document.body`, so one opened from a
 * modal's card would otherwise stand under the window the modal dims.
 */
const MENU_LAYER = {
  WINDOW: "window",
  DIALOG: "dialog",
} as const;

type MenuLayer = (typeof MENU_LAYER)[keyof typeof MENU_LAYER];

/** The layer a menu opened from `opener` stands in. */
function layerOf(opener: HTMLElement): MenuLayer {
  return opener.closest('[aria-modal="true"]') === null ? MENU_LAYER.WINDOW : MENU_LAYER.DIALOG;
}

/** Where a menu dropped from a button hangs: under it, its right edge on the button's. */
export function dropBelow(button: HTMLElement): MenuPlacement {
  const bounds = button.getBoundingClientRect();
  return { x: bounds.right, y: bounds.bottom + MENU_DROP, align: MENU_ALIGN.END };
}

/** Where a menu dropped from a row as wide as its column hangs: under it, its left edge on the row's. */
export function dropBelowStart(button: HTMLElement): MenuPlacement {
  const bounds = button.getBoundingClientRect();
  return { x: bounds.left, y: bounds.bottom + MENU_DROP, align: MENU_ALIGN.START };
}

/** Where a menu raised from a button at the window's foot hangs: over it, its left edge on the button's. */
export function riseAbove(button: HTMLElement): MenuPlacement {
  const bounds = button.getBoundingClientRect();
  return { x: bounds.left, y: bounds.top - MENU_DROP, align: MENU_ALIGN.START, grow: MENU_GROW.UP };
}

/** Where a menu raised from a button at a row's right end hangs: over it, its right edge on the button's. */
export function riseAboveEnd(button: HTMLElement): MenuPlacement {
  const bounds = button.getBoundingClientRect();
  return { x: bounds.right, y: bounds.top - MENU_DROP, align: MENU_ALIGN.END, grow: MENU_GROW.UP };
}

/**
 * Where a right-click's menu hangs: at the pointer, growing rightward from
 * it; or, for the menu key the system turned into a right-click, which says
 * no point of its own, where `place` hangs it from what was clicked, under
 * it from its start unless told otherwise.
 */
export function atPointer(
  event: React.MouseEvent<HTMLElement>,
  place: (element: HTMLElement) => MenuPlacement = dropBelowStart,
): MenuPlacement {
  if (event.clientX === 0 && event.clientY === 0) return place(event.currentTarget);
  return { x: event.clientX, y: event.clientY, align: MENU_ALIGN.START };
}

/**
 * The props of an element whose menu a right-click opens (`useMenu`'s
 * `contextMenu`), spread on it: the right-click's handler, the long press
 * that opens the same menu from a touch, and the mark that keeps the
 * system's own callout off it while held.
 */
export interface ContextMenuProps {
  onContextMenu: (event: React.MouseEvent<HTMLElement>) => void;
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onTouchEnd: (event: React.TouchEvent<HTMLElement>) => void;
  "data-long-press": "";
}

/**
 * The props of a control inside an element carrying a context menu that
 * keeps the menu its own press would otherwise open, as a row's switch
 * does: a right-click on it does not reach the row, and a long press that
 * starts on it never starts the row's hold.
 */
export const NO_CONTEXT_MENU = {
  "data-no-context-menu": "",
  onContextMenu: (event: React.MouseEvent<HTMLElement>) => event.stopPropagation(),
} as const;

/** The handlers of the events a context menu hears that an element carrying it may hear for itself too. */
export interface ContextMenuCarrier<T extends HTMLElement> {
  onContextMenu?: React.MouseEventHandler<T> | undefined;
  onPointerDown?: React.PointerEventHandler<T> | undefined;
  onTouchEnd?: React.TouchEventHandler<T> | undefined;
}

/** Two handlers of one event, both heard, the carrier's first; whichever is given where one is not. */
function heardBoth<E>(
  own: ((event: E) => void) | undefined,
  menu: ((event: E) => void) | undefined,
): ((event: E) => void) | undefined {
  if (own === undefined || menu === undefined) return own ?? menu;
  return (event) => {
    own(event);
    menu(event);
  };
}

/**
 * The props an element spreads to carry a context menu beside handlers of
 * its own for the same events, as a row's swipe hears the same pointer:
 * each event heard by both, its own first; its own alone where it carries
 * no menu.
 */
export function withContextMenu<T extends HTMLElement>(
  contextMenu: ContextMenuProps | undefined,
  own: ContextMenuCarrier<T>,
): ContextMenuCarrier<T> & { "data-long-press"?: "" } {
  if (contextMenu === undefined) return own;
  return {
    "data-long-press": contextMenu["data-long-press"],
    onContextMenu: heardBoth(own.onContextMenu, contextMenu.onContextMenu),
    onPointerDown: heardBoth(own.onPointerDown, contextMenu.onPointerDown),
    onTouchEnd: heardBoth(own.onTouchEnd, contextMenu.onTouchEnd),
  };
}

/** Whether a key opens what holds the keyboard's own menu, as a right-click would: the menu key, or ⇧F10. */
export function opensMenu(event: React.KeyboardEvent): boolean {
  return event.key === "ContextMenu" || (event.shiftKey && event.key === "F10");
}

/**
 * One control's menu: where it hangs while it stands open, the door that
 * opens it from an element, which takes focus back when it closes by key,
 * and the close; and `drawn`, the menu to draw, which goes on through its
 * exit at the last place it hung. A menu does not outlive the surface it
 * stands on, so it starts leaving in the render that finds the surface off
 * screen.
 *
 * It also hands out the doors every owner draws, so each opens its menu
 * the same way: `trigger`, the props of the button the menu drops from,
 * whose press opens it where `place` says (under the button, right edges
 * level, unless told otherwise) and closes it again while it stands; and
 * `contextMenu`, the props of what a right-click opens it on, which hang
 * it at the pointer, or where `place` says for the menu key's right-click,
 * which says no point, and hand focus back to `opener` where one is given,
 * the ⋯ or the row the keyboard reaches the menu from, else to what was
 * clicked; and `keyMenu`,
 * the same row's key handler, which hangs it under the row from its start
 * on the menu key or ⇧F10, for a row with no ⋯ to reach it by.
 *
 * A touch has no right-click, and iOS sends no contextmenu for a long
 * press, so `contextMenu` opens the menu on a touch held still for
 * `LONG_PRESS_MS` (`touch-hold.ts`) too, at the point it went down. Drifting past
 * `LONG_PRESS_SLOP`, a scroll, or the touch ending first lets it go. A
 * hold that opened the menu is not also a press, so its touch ends in no
 * mousedown or click, which would land on the menu now under the finger,
 * taking the focus off its first item; nor is it two, so the contextmenu
 * Android sends for the same hold while it is down opens nothing more. A
 * mouse and a pen have their right-click, and are left to it.
 */
export function useMenu(shown: boolean) {
  const [menu, setMenu] = useState<OpenMenu | undefined>(undefined);
  const [standing, setStanding] = useState(false);
  if (standing && !shown) setStanding(false);
  const { mounted, leaving, ref } = useDisclosure(standing);
  const opener = useRef<HTMLElement | null>(null);
  const id = useId();
  const close = useCallback((returnFocus: boolean) => {
    setStanding(false);
    if (returnFocus) opener.current?.focus();
  }, []);
  const show = useCallback((placement: MenuPlacement, element: HTMLElement) => {
    opener.current = element;
    setMenu({ placement, opener: element });
    setStanding(true);
  }, []);
  const drawn: DrawnMenu | undefined =
    mounted && menu !== undefined ? { ...menu, id, leaving, ref } : undefined;
  const trigger = (place: (button: HTMLElement) => MenuPlacement = dropBelow) => ({
    "aria-haspopup": "menu" as const,
    "aria-expanded": standing,
    // Note that the menu is named only while it stands open, as `aria-expanded` says, because one on its way out controls nothing.
    "aria-controls": standing && drawn !== undefined ? id : undefined,
    onClick: (event: React.MouseEvent<HTMLElement>) => {
      if (standing) close(true);
      else show(place(event.currentTarget), event.currentTarget);
    },
  });
  const hold = useTouchHold();
  const contextMenu = (
    opener?: React.RefObject<HTMLElement | null>,
    place: (element: HTMLElement) => MenuPlacement = dropBelowStart,
  ): ContextMenuProps => ({
    "data-long-press": "",
    onContextMenu: (event) => {
      event.preventDefault();
      if (hold.held.current) return;
      // Note that Android's own contextmenu may come before the hold's
      // timer, and opens the menu in its place.
      if (hold.counting()) hold.claim();
      show(atPointer(event, place), opener?.current ?? event.currentTarget);
    },
    onPointerDown: (event) => {
      const element = event.currentTarget;
      hold.start(event, ({ x, y }) =>
        show({ x, y, align: MENU_ALIGN.START }, opener?.current ?? element),
      );
    },
    onTouchEnd: hold.touchEnd,
  });
  const keyMenu = (event: React.KeyboardEvent<HTMLElement>) => {
    if (!opensMenu(event)) return;
    event.preventDefault();
    show(dropBelowStart(event.currentTarget), event.currentTarget);
  };
  return { open: standing ? menu : undefined, drawn, show, close, trigger, contextMenu, keyMenu };
}

/** A point in the window as the box of no size a menu hangs from. */
function pointAt(x: number, y: number): { getBoundingClientRect: () => DOMRect } {
  const box = { x, y, left: x, top: y, right: x, bottom: y, width: 0, height: 0 };
  return { getBoundingClientRect: () => ({ ...box, toJSON: () => box }) };
}

/** What can be seen of the window, as the rectangle a menu is held inside. */
function seenRect() {
  const seen = visibleViewport();
  return {
    x: seen.left,
    y: seen.top,
    width: seen.right - seen.left,
    height: seen.bottom - seen.top,
  };
}

/** The items of one menu, its own and not a submenu's within it, that the keys move between now. */
function itemsOf(menu: HTMLElement): HTMLElement[] {
  return [...menu.querySelectorAll<HTMLElement>(MENU_ITEM)].filter(
    (item) => item.closest('[role="menu"]') === menu,
  );
}

/**
 * Whether a press landed on the card an item of one of `menus` hangs, or on
 * a card hung from a control on that card, as a person named on an agent's
 * card hangs their own. Each card stands apart from the menu, portalled to
 * the body, so it is traced back through the control it hangs from
 * (`hintedControlOf`), card by card, until one stands in a menu.
 */
function onItemCard(target: Node | null, menus: readonly (HTMLElement | null)[]): boolean {
  const seen = new Set<Node>();
  let on = target;
  while (on !== null && !seen.has(on)) {
    seen.add(on);
    const control = hintedControlOf(on);
    if (control === undefined) return false;
    if (menus.some((menu) => menu?.contains(control) === true)) return true;
    on = control;
  }
  return false;
}

/** The slot at a row's end, one glyph wide, after any hint; a setting's check in the text's own ink. */
function endSlot(afterHint: boolean, setting: boolean): string {
  return cn(
    "luke-menu-item-end grid size-menu-glyph flex-none place-items-center text-muted-foreground [&>svg]:size-menu-glyph [&>svg]:flex-none [&>svg]:text-inherit [&>svg.settings-chevron]:size-menu-chevron",
    !afterHint && "ml-auto",
    setting && "text-foreground",
  );
}

/** What an item prints at its end: its hint, and after it a setting's switch, the chevron of a list it opens, or a setting's check while it is on. */
function ItemEnd({ action }: { action: MenuAction }): React.JSX.Element | null {
  const hint =
    action.hint === undefined ? null : <span className="luke-menu-item-hint">{action.hint}</span>;
  if (action.mark === MENU_ITEM_MARK.SWITCH && action.checked !== undefined) {
    return (
      <>
        {hint}
        <span className={cn("luke-menu-item-switch flex flex-none", hint === null && "ml-auto")}>
          <SwitchMark checked={action.checked} />
        </span>
      </>
    );
  }
  if (action.opens === true) {
    return (
      <>
        {hint}
        <span className={endSlot(hint !== null, false)}>
          <ChevronRightIcon />
        </span>
      </>
    );
  }
  // Note that a setting with a hint keeps its check's room while it is off, so the hints of a menu of them end in one line down it.
  if (action.checked === true || (action.checked === false && hint !== null)) {
    return (
      <>
        {hint}
        <span className={endSlot(hint !== null, true)}>
          {action.checked ? <CheckIcon /> : null}
        </span>
      </>
    );
  }
  return hint;
}

/** Whether an item draws its detail as a second line under its label, which the item grows to hold. */
function secondLine(action: MenuAction): boolean {
  return action.detail !== undefined && action.detailPlace !== MENU_DETAIL.BESIDE;
}

/** An item's glyph, words, and end, as every row draws them. */
function ItemBody({ action }: { action: MenuAction }): React.JSX.Element {
  const beside = action.detailPlace === MENU_DETAIL.BESIDE;
  if (action.detail === undefined) {
    return (
      <>
        <MenuGlyph>{action.icon}</MenuGlyph>
        <OneLine className="luke-menu-item-label min-w-0 flex-1">{action.label}</OneLine>
        <ItemEnd action={action} />
      </>
    );
  }
  return (
    <>
      <MenuGlyph>{action.icon}</MenuGlyph>
      <span
        className={cn(
          "luke-menu-item-copy flex min-w-0 flex-1",
          beside ? "flex-row items-baseline gap-luke-8" : "flex-col gap-luke-2",
        )}
        data-place={beside ? MENU_DETAIL.BESIDE : undefined}
      >
        <OneLine
          className={cn("luke-menu-item-label min-w-0", beside ? "flex-initial" : "flex-none")}
        >
          {action.label}
        </OneLine>
        <OneLine className={cn("luke-menu-item-detail", beside && "min-w-0 flex-[0_1000_auto]")}>
          {action.detail}
        </OneLine>
      </span>
      <ItemEnd action={action} />
    </>
  );
}

/** An item's button, with the card its action hangs beside it where it has one. */
function Carded({
  action,
  children,
}: {
  action: MenuAction;
  children: React.JSX.Element;
}): React.JSX.Element {
  if (action.card === undefined) return children;
  return (
    <Tooltip label={action.label} card={action.card} cardBeside>
      {children}
    </Tooltip>
  );
}

/**
 * One item, as a menu draws it: Base UI's menu item (`shadcn/dropdown-menu`)
 * as a button, reached by the menu's keys rather than by Tab: its glyph's
 * column, its label and any detail under it, and at its end its check or
 * hint. A setting is a checkbox item, which says whether it is on.
 */
export function MenuItem({
  action,
  onChoose,
  steered,
}: {
  action: MenuAction;
  onChoose: () => void;
  /** Where it stands among a field's pinned rows rather than in a menu. */
  steered?: SteeredMenuItem | undefined;
}): React.JSX.Element {
  // Note that a detail is heard after the label with a pause, because the two spans would otherwise run together.
  const heard = action.detail === undefined ? undefined : `${action.label}, ${action.detail}`;
  if (steered !== undefined) {
    return (
      <SteeredItem
        action={action}
        steered={steered}
        heard={heard}
        onChoose={onChoose}
        body={<ItemBody action={action} />}
      />
    );
  }
  const pressed = pulseOnPress(onChoose, PRESS_PULSE.QUIET);
  const shared = {
    nativeButton: true,
    // Note that a dimmed item is a disabled button outright, as it was,
    // rather than Base UI's focusable `aria-disabled` one, so neither the
    // keys (`useRovingKeys`) nor a press stop on it.
    render: <button type="button" disabled={action.disabled} />,
    ...rovingItem(),
    label: action.label,
    "aria-label": heard,
    className: "luke-menu-item",
    "aria-disabled": action.disabled === true ? true : undefined,
    "data-detail": secondLine(action) ? "true" : undefined,
    // Note that the item's press is the menu's alone to answer (`Menu`'s
    // `choose`), which closes it or leaves it standing, because Base UI's
    // own would take focus back to the item after the menu handed it on.
    closeOnClick: false,
    onClick: (event: BaseUIEvent<React.MouseEvent<HTMLElement>>) => {
      event.preventBaseUIHandler();
      pressed(event);
    },
  } as const;
  // A setting in a menu says whether it is on as a menu's check does.
  if (action.checked !== undefined) {
    return (
      <Carded action={action}>
        <DropdownMenuCheckboxItem {...shared} checked={action.checked}>
          <ItemBody action={action} />
        </DropdownMenuCheckboxItem>
      </Carded>
    );
  }
  return (
    <Carded action={action}>
      <DropdownMenuItem
        {...shared}
        variant={action.danger ? "destructive" : "default"}
        data-danger={action.danger ? "true" : undefined}
      >
        <ItemBody action={action} />
      </DropdownMenuItem>
    </Carded>
  );
}

/**
 * An item among a field's pinned rows: a button, or a switch for a setting,
 * drawn as a menu's row, that keeps a press from taking focus out of the
 * field, and that is dimmed rather than disabled where it does not apply
 * now, so it still hears the pointer that asks why. It stands in no menu,
 * so it is no Base UI item: the field holds the one highlight.
 */
function SteeredItem({
  action,
  steered,
  heard,
  onChoose,
  body,
}: {
  action: MenuAction;
  steered: SteeredMenuItem;
  heard: string | undefined;
  onChoose: () => void;
  body: React.ReactNode;
}): React.JSX.Element {
  const off = action.disabled === true;
  const opens = action.opens === true;
  const shared = {
    type: "button",
    id: steered.id,
    "aria-label": heard,
    "aria-disabled": off ? "true" : undefined,
    tabIndex: -1,
    // Note that the field holds the one highlight, which the pointer moves too, so the pointer lights nothing of its own.
    className: cn("luke-menu-item", DROPDOWN_MENU_ITEM, "data-highlighted:bg-secondary"),
    "data-steered": "true",
    "data-highlighted": steered.highlighted ? "true" : undefined,
    "data-variant": action.danger ? "destructive" : undefined,
    "data-danger": action.danger ? "true" : undefined,
    "data-detail": secondLine(action) ? "true" : undefined,
    onMouseDown: (event: React.MouseEvent) => event.preventDefault(),
    onMouseMove: off ? undefined : steered.onHover,
    onClick: off ? undefined : pulseOnPress(onChoose, PRESS_PULSE.QUIET),
  } as const;
  // A setting is a switch for the keyboard and the reader, whatever its end draws.
  if (action.checked !== undefined) {
    return (
      <Carded action={action}>
        <button {...shared} role="switch" aria-checked={action.checked}>
          {body}
        </button>
      </Carded>
    );
  }
  return (
    <Carded action={action}>
      <button
        {...shared}
        aria-haspopup={opens ? "listbox" : undefined}
        aria-expanded={opens ? steered.expanded === true : undefined}
      >
        {body}
      </button>
    </Carded>
  );
}

/**
 * A menu's rows, its heading and footer among them, scrolling inside its
 * surface where the room Base UI found for it cannot hold them all, the cut
 * edge fading as every scroller's does, so the surface keeps its edge,
 * corner, and shadow whole rather than being sliced by the window.
 */
function MenuRows({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <ScrollArea size={SCROLL_SIZE.CONTENT} fade={SCROLL_FADE.BOTH}>
      <div className="flex flex-col">{children}</div>
    </ScrollArea>
  );
}

/**
 * How far a submenu stands from its item so it stands a drop beside its
 * menu's edge: the item stands the menu's inset and edge inside it, read
 * from where both are drawn as the submenu is placed.
 */
function besideMenu(item: HTMLElement | null, side: string): number {
  const menu = item?.closest('[role="menu"]');
  if (item === null || menu === null || menu === undefined) return MENU_DROP;
  const inside = item.getBoundingClientRect();
  const edge = menu.getBoundingClientRect();
  const within = side === "left" ? inside.left - edge.left : edge.right - inside.right;
  return within + MENU_DROP;
}

/**
 * A submenu, beside its item: Base UI's submenu, its trigger the item, with
 * its glyph, its name, and the chevron that says it opens a menu beside it
 * rather than acting. It stands to the menu's right, or its left where the
 * window leaves no room, its first item level with the item that opened
 * it, or its last where the window's foot leaves no room below. Whether it
 * stands is the menu's (`open`), so resting on another item, Left, or
 * Escape closes it alone, fading out as its menu does (`DROPDOWN_MENU_SURFACE`
 * on Base UI's ending state), and a finger's arrival opens nothing: iOS plays a
 * tap's arrival as a hover and spends the tap on what comes in with it, so
 * the tap itself opens it, the keyboard taken into it.
 */
function Submenu({
  entry,
  open,
  layer,
  seen,
  leaving,
  surface,
  onOpen,
  onBack,
  onChoose,
}: {
  entry: MenuSubmenu;
  open: boolean;
  /** The layer its menu stands in, which it stands in too. */
  layer: MenuLayer;
  /** What can be seen of the window as its menu was hung, which it is held inside too. */
  seen: ReturnType<typeof seenRect>;
  leaving: boolean;
  /** The submenu's element, which the menu counts as its own when it hears a press. */
  surface: React.RefObject<HTMLDivElement | null>;
  onOpen: (focus: boolean) => void;
  /** Closes the submenu alone, focus back on the item that opened it. */
  onBack: () => void;
  onChoose: (action: MenuAction) => void;
}): React.JSX.Element {
  const trigger = useRef<HTMLDivElement | null>(null);
  const focusInto = useRef(false);
  // Note that the popup is held in state too, because Base UI's portal draws it a render after the submenu opens.
  const [popup, setPopup] = useState<HTMLDivElement | null>(null);
  const drawn = useCallback(
    (node: HTMLDivElement | null) => {
      surface.current = node;
      setPopup(node);
    },
    [surface],
  );
  // Note that the keyboard is taken into the submenu once it stands, where it was opened by a press or Right.
  useEffect(() => {
    if (!open || popup === null || !focusInto.current) return;
    focusInto.current = false;
    itemsOf(popup)[0]?.focus();
  }, [open, popup]);
  // Note that a press or Right on an item whose submenu the pointer already
  // opened takes the keyboard in at once, because the submenu stands drawn
  // and nothing renders again to take it there.
  const enter = () => {
    if (open && popup !== null) {
      itemsOf(popup)[0]?.focus();
      return;
    }
    focusInto.current = true;
    onOpen(true);
  };
  const roving = useRovingKeys<HTMLDivElement>({ stop: ROVING_STOP.NONE });
  const keyDown = (event: BaseUIEvent<React.KeyboardEvent<HTMLDivElement>>) => {
    if (event.key === "Escape" || event.key === "ArrowLeft") {
      event.preventDefault();
      event.stopPropagation();
      event.preventBaseUIHandler();
      onBack();
      trigger.current?.focus();
      return;
    }
    if (!roving.onKeyDown(event)) return;
    event.stopPropagation();
    event.preventBaseUIHandler();
  };
  return (
    <DropdownMenuSub open={open} onOpenChange={() => undefined}>
      <DropdownMenuSubTrigger
        ref={trigger}
        nativeButton
        render={<button type="button" />}
        openOnHover={false}
        label={entry.label}
        className="luke-menu-item"
        {...rovingItem()}
        data-open={open ? "true" : undefined}
        endClassName={endSlot(false, false)}
        onPointerEnter={(event) => {
          if (event.pointerType !== "touch") onOpen(false);
        }}
        onClick={pulseOnPress((event: BaseUIEvent<React.MouseEvent<HTMLElement>>) => {
          // Note that Base UI's own press would take focus back to the item after it went into the submenu.
          event.preventBaseUIHandler();
          enter();
        }, PRESS_PULSE.QUIET)}
        onKeyDown={(event: BaseUIEvent<React.KeyboardEvent<HTMLElement>>) => {
          if (event.key !== "ArrowRight") return;
          event.preventDefault();
          event.stopPropagation();
          event.preventBaseUIHandler();
          enter();
        }}
      >
        <MenuGlyph>{entry.icon}</MenuGlyph>
        <OneLine className="luke-menu-item-label min-w-0 flex-1">{entry.label}</OneLine>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent
        ref={drawn}
        className="luke-menu"
        aria-label={entry.label}
        layer={layer}
        side="right"
        align="start"
        sideOffset={({ side }) => besideMenu(trigger.current, side)}
        alignOffset={-MENU_INSET}
        collisionAvoidance={BESIDE_OR_ACROSS}
        collisionBoundary={seen}
        collisionPadding={MENU_MARGIN}
        data-leaving={leaving ? "true" : undefined}
        inert={leaving}
        finalFocus={false}
        data-roving={roving["data-roving"]}
        onKeyDown={keyDown}
      >
        <MenuRows>
          {entry.items.map((action) => (
            <MenuItem key={action.label} action={action} onChoose={() => onChoose(action)} />
          ))}
        </MenuRows>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

/**
 * The menu itself, Base UI's menu (`shadcn/dropdown-menu`) drawn over the
 * window at the point it hangs from, held inside what can be seen of it. A
 * heading, where one is given, stands over the items, muted and pressed by
 * nothing: whose account the menu is about. A footer, where one is given,
 * stands under them on the same terms: who made what the menu is about.
 *
 * Base UI keys it: the arrows, Home, End, and a typed name move between the
 * items that apply now. What closes it is this menu's own, as before:
 * Escape and Tab hand focus back to the opener, a press elsewhere (but on
 * the opener, which closes it itself, or on an item's card) or the window
 * losing the keyboard or its size closes it where it stands, and a choice
 * closes it unless the item `stays`.
 */
export function Menu({
  label,
  menu,
  heading,
  footer,
  groups,
  openOnChecked = false,
  onClose,
}: {
  label: string;
  /** Where it hangs, and whether it is on its way out (`useMenu`'s `drawn`). */
  menu: DrawnMenu;
  heading?: React.ReactNode;
  footer?: React.ReactNode;
  groups: readonly (readonly MenuEntry[])[];
  /** Whether it opens on its checked item, as a pop-up opens on its value, rather than on its first. */
  openOnChecked?: boolean;
  /** Closes the menu, handing focus back to its opener where nothing else has taken it. */
  onClose: (returnFocus: boolean) => void;
}): React.JSX.Element {
  const { id, placement, opener, leaving, ref: hold } = menu;
  const element = useRef<HTMLDivElement | null>(null);
  // Note that the popup is held in state too, because Base UI's portal draws it a render after the menu's own.
  const [popup, setPopup] = useState<HTMLDivElement | null>(null);
  const drawn = useCallback(
    (node: HTMLDivElement | null) => {
      element.current = node;
      setPopup(node);
      hold(node);
    },
    [hold],
  );
  const [submenu, setSubmenu] = useState<string | undefined>(undefined);
  // Note that the keys walk the items the menu draws, and the tab order is Base UI's, since Tab closes a menu.
  const roving = useRovingKeys<HTMLDivElement>({ stop: ROVING_STOP.NONE });
  const submenuElement = useRef<HTMLDivElement | null>(null);
  // Opened again while it was leaving, the menu stands with no submenu, as one opened anew does.
  const [wasLeaving, setWasLeaving] = useState(leaving);
  if (wasLeaving !== leaving) {
    setWasLeaving(leaving);
    if (!leaving) setSubmenu(undefined);
  }
  const anchor = useMemo(() => pointAt(placement.x, placement.y), [placement]);
  // Note that what can be seen is read once as the menu is hung, because a
  // rectangle new on every render would have Base UI place the menu again
  // on every render, and every placing renders it again.
  const seen = useMemo(() => seenRect(), [placement]);
  const layer = layerOf(opener);

  // Focus lands on the first item, or the checked one where it opens on
  // that, as the menu stands, and again as it is opened while it was
  // leaving.
  useEffect(() => {
    if (leaving || popup === null) return;
    const items = itemsOf(popup);
    const checked = openOnChecked
      ? items.find((item) => item.getAttribute("aria-checked") === "true")
      : undefined;
    (checked ?? items[0])?.focus();
  }, [popup, leaving, openOnChecked]);

  // Note that a press on the opener is left to the opener, because the
  // button's own press is what closes the menu it opened; that a press on
  // an item's card is the menu's own, the card its item's words to read and
  // select; and that a menu leaving hears nothing, since it has closed already.
  useEffect(() => {
    if (leaving) return;
    const pressed = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (element.current?.contains(target) || submenuElement.current?.contains(target)) return;
      if (onItemCard(target, [element.current, submenuElement.current])) return;
      if (opener.contains(target)) return;
      onClose(false);
    };
    const leave = () => onClose(false);
    document.addEventListener("pointerdown", pressed, true);
    window.addEventListener("blur", leave);
    window.addEventListener("resize", leave);
    return () => {
      document.removeEventListener("pointerdown", pressed, true);
      window.removeEventListener("blur", leave);
      window.removeEventListener("resize", leave);
    };
  }, [onClose, opener, leaving]);

  const keyDown = (event: BaseUIEvent<React.KeyboardEvent<HTMLDivElement>>) => {
    // The menu is the nearest open layer, so Escape closes it alone and
    // leaves whatever it was opened over open.
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose(true);
      return;
    }
    // Note that Tab hands focus back before the browser moves it, because
    // the browser's own move then goes on from the opener to its neighbour.
    if (event.key === "Tab") {
      event.stopPropagation();
      onClose(true);
      return;
    }
    // Walking the menu's own items leaves a submenu the pointer opened behind.
    if (!roving.onKeyDown(event)) return;
    event.preventBaseUIHandler();
    setSubmenu(undefined);
  };

  // Note that a value a filter toggles leaves the menu standing, so several are chosen in one visit.
  const choose = (action: MenuAction) => {
    if (action.stays !== true) onClose(true);
    action.onSelect();
  };
  // Resting on another of the menu's own items closes the submenu, as a
  // system menu's does; resting on the submenu's items keeps it.
  const pointerOver = (event: React.PointerEvent<HTMLDivElement>) => {
    const item = event.target instanceof Element ? event.target.closest(MENU_ITEM) : null;
    if (item === null || item.closest('[role="menu"]') !== element.current) return;
    if (item.getAttribute("aria-haspopup") === "menu") return;
    setSubmenu(undefined);
  };

  return (
    <DropdownMenu open={!leaving} modal={false}>
      <DropdownMenuContent
        ref={drawn}
        id={id}
        className="luke-menu"
        aria-label={label}
        layer={layer}
        anchor={anchor}
        side={placement.grow === MENU_GROW.UP ? "top" : "bottom"}
        align={placement.align === MENU_ALIGN.END ? "end" : "start"}
        sideOffset={0}
        collisionBoundary={seen}
        collisionAvoidance={HELD_INSIDE}
        collisionPadding={MENU_MARGIN}
        data-leaving={leaving ? "true" : undefined}
        inert={leaving}
        finalFocus={false}
        data-roving={roving["data-roving"]}
        onKeyDown={keyDown}
        onPointerOver={pointerOver}
      >
        <MenuRows>
          {heading === undefined ? null : (
            <>
              <div
                className="luke-menu-heading flex flex-col gap-luke-2 px-row-inset py-luke-4 text-caption leading-[inherit]"
                role="none"
              >
                {heading}
              </div>
              <DropdownMenuSeparator className="luke-menu-rule" />
            </>
          )}
          {groups.map((group, index) => (
            <Fragment key={group[0]?.label}>
              {index > 0 ? <DropdownMenuSeparator className="luke-menu-rule" /> : null}
              {group.map((entry) =>
                "items" in entry ? (
                  <Submenu
                    key={entry.label}
                    entry={entry}
                    open={submenu === entry.label && !leaving}
                    layer={layer}
                    seen={seen}
                    leaving={leaving}
                    surface={submenuElement}
                    onOpen={() => setSubmenu(entry.label)}
                    onBack={() => setSubmenu(undefined)}
                    onChoose={choose}
                  />
                ) : (
                  <MenuItem key={entry.label} action={entry} onChoose={() => choose(entry)} />
                ),
              )}
            </Fragment>
          ))}
          {footer === undefined ? null : (
            <>
              <DropdownMenuSeparator className="luke-menu-rule" />
              <div
                className="luke-menu-footer flex flex-col gap-luke-2 px-row-inset py-luke-4 text-caption leading-[inherit] text-muted-foreground"
                role="none"
              >
                {footer}
              </div>
            </>
          )}
        </MenuRows>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
