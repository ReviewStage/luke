import type { BaseUIEvent } from "@base-ui/react/types";
import {
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "../../cn.js";
import { isComposingKey } from "../../composing-key.js";
import { cssCustomProperties } from "../../css.js";
import { CheckIcon, ChevronRightIcon } from "../../face/glyphs.js";
import { PRESS_PULSE, pulseOnPress } from "../../press-pulse.js";
import { ReplayWords } from "../../session-replay-marks.js";
import {
  DROPDOWN_MENU_ITEM,
  DROPDOWN_MENU_ITEM_LIT,
  DROPDOWN_MENU_RULE,
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
import {
  askedStyleWidth,
  POPOVER_WIDTH,
  type PopoverWidth,
} from "../anchored-popover/anchored-popover.js";
import { OneLine } from "../one-line/one-line.js";
import { ROVING_STOP, rovingItem, useRovingKeys } from "../roving-keys/roving-keys.js";
import { SCROLL_FADE, SCROLL_SIZE, ScrollArea } from "../scroll-area/scroll-area.js";
import { SwitchMark } from "../switch/switch.js";
import { hintedControlOf, Tooltip } from "../tooltip/hint.js";
import { MENU_LINE, type MenuLine, menuCut } from "./menu-cut.js";
import { MenuReplayUnmasked } from "./menu-replay.js";
import { inNarrowRoom, MenuSheetFrame } from "./menu-sheet.js";
import { MenuGlyph } from "./menu-surface.js";
import { useSubmenuAim } from "./submenu-aim.js";
import { useTouchHold } from "./touch-hold.js";

export const MENU_ALIGN = {
  START: "start",
  END: "end",
} as const;

type MenuAlign = (typeof MENU_ALIGN)[keyof typeof MENU_ALIGN];

const MENU_GROW = {
  DOWN: "down",
  UP: "up",
} as const;

type MenuGrow = (typeof MENU_GROW)[keyof typeof MENU_GROW];

const MENU_MARGIN = 8;
const MENU_INSET = 4;
export const MENU_ITEM_MARK = {
  CHECK: "check",
  SWITCH: "switch",
} as const;

export type MenuItemMark = (typeof MENU_ITEM_MARK)[keyof typeof MENU_ITEM_MARK];

export const MENU_DETAIL = {
  UNDER: "under",
  BESIDE: "beside",
} as const;

export type MenuDetailPlace = (typeof MENU_DETAIL)[keyof typeof MENU_DETAIL];

export const MENU_DROP = 4;
const MENU_ITEM =
  ':is([role="menuitem"], [role="menuitemcheckbox"]):not(:disabled, [aria-disabled="true"])';
const BESIDE_OR_ACROSS = { side: "flip", align: "flip", fallbackAxisSide: "none" } as const;
const HELD_INSIDE = { side: "shift", align: "shift", fallbackAxisSide: "none" } as const;

export interface MenuPlacement {
  x: number;
  y: number;
  align: MenuAlign;
  grow?: MenuGrow;
  button?: ButtonBox;
}

export const MENU_KEEPS_CLEAR = { "data-menu-keeps-clear": "" } as const;

export type MenuKeyMatch = (event: React.KeyboardEvent) => boolean;

export interface MenuAction {
  label: string;
  key?: string | number | undefined;
  icon?: React.JSX.Element;
  detail?: string | undefined;
  tag?: React.ReactNode;
  detailPlace?: MenuDetailPlace | undefined;
  onSelect: () => void;
  danger?: boolean;
  hint?: React.ReactNode;
  pressedBy?: MenuKeyMatch | undefined;
  disabled?: boolean;
  checked?: boolean | undefined;
  mark?: MenuItemMark | undefined;
  opens?: boolean | undefined;
  stays?: boolean | undefined;
  card?: React.ReactNode;
  replayMasked?: boolean | undefined;
}

export interface SteeredMenuItem {
  id: string;
  highlighted: boolean;
  onHover: () => void;
  expanded?: boolean | undefined;
}

export interface MenuSubmenu {
  label: string;
  replayMasked?: boolean | undefined;
  icon?: React.JSX.Element;
  items: readonly MenuAction[];
  hint?: React.ReactNode;
  pressedBy?: MenuKeyMatch | undefined;
}

export interface MenuPanelDoors {
  readonly back: () => void;
  readonly close: () => void;
  readonly entered: boolean;
}

export interface MenuPanel {
  label: string;
  replayMasked?: boolean | undefined;
  icon?: React.JSX.Element;
  hint?: React.ReactNode;
  width?: number | PopoverWidth | undefined;
  panel: (doors: MenuPanelDoors) => React.ReactNode;
}

export type MenuEntry = MenuAction | MenuSubmenu | MenuPanel;

function isPanel(entry: MenuEntry): entry is MenuPanel {
  return "panel" in entry;
}

function entryKey(entry: MenuEntry): string | number {
  return "onSelect" in entry ? (entry.key ?? entry.label) : entry.label;
}

function groupKey(group: readonly MenuEntry[]): string | number | undefined {
  const first = group[0];
  return first === undefined ? undefined : entryKey(first);
}

export interface MenuSubject {
  readonly mark?: React.ReactNode;
  readonly name: string;
  readonly detail?: string | undefined;
}

export interface OpenMenu {
  placement: MenuPlacement;
  opener: HTMLElement;
}

export interface DrawnMenu extends OpenMenu {
  id: string;
  leaving: boolean;
  ref: (element: HTMLElement | null) => void;
}

const MENU_LAYER = {
  WINDOW: "window",
  DIALOG: "dialog",
} as const;

type MenuLayer = (typeof MENU_LAYER)[keyof typeof MENU_LAYER];

function layerOf(opener: HTMLElement): MenuLayer {
  return opener.closest('[aria-modal="true"]') === null ? MENU_LAYER.WINDOW : MENU_LAYER.DIALOG;
}

interface ButtonBox {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function spanOf(bounds: DOMRect): ButtonBox {
  return { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom };
}

export function dropBelow(button: HTMLElement): MenuPlacement {
  const bounds = button.getBoundingClientRect();
  return {
    x: bounds.right,
    y: bounds.bottom + MENU_DROP,
    align: MENU_ALIGN.END,
    button: spanOf(bounds),
  };
}

export function dropBelowStart(button: HTMLElement): MenuPlacement {
  const bounds = button.getBoundingClientRect();
  return {
    x: bounds.left,
    y: bounds.bottom + MENU_DROP,
    align: MENU_ALIGN.START,
    button: spanOf(bounds),
  };
}

export function riseAbove(button: HTMLElement): MenuPlacement {
  const bounds = button.getBoundingClientRect();
  return {
    x: bounds.left,
    y: bounds.top - MENU_DROP,
    align: MENU_ALIGN.START,
    grow: MENU_GROW.UP,
    button: spanOf(bounds),
  };
}

export function riseAboveEnd(button: HTMLElement): MenuPlacement {
  const bounds = button.getBoundingClientRect();
  return {
    x: bounds.right,
    y: bounds.top - MENU_DROP,
    align: MENU_ALIGN.END,
    grow: MENU_GROW.UP,
    button: spanOf(bounds),
  };
}

export function atPointer(
  event: React.MouseEvent<HTMLElement>,
  place: (element: HTMLElement) => MenuPlacement = dropBelowStart,
): MenuPlacement {
  if (event.clientX === 0 && event.clientY === 0) return place(event.currentTarget);
  return { x: event.clientX, y: event.clientY, align: MENU_ALIGN.START };
}

export interface ContextMenuProps {
  onContextMenu: (event: React.MouseEvent<HTMLElement>) => void;
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onTouchEnd: (event: React.TouchEvent<HTMLElement>) => void;
  "data-long-press": "";
}

export const NO_CONTEXT_MENU = {
  "data-no-context-menu": "",
  onContextMenu: (event: React.MouseEvent<HTMLElement>) => event.stopPropagation(),
} as const;

export interface ContextMenuCarrier<T extends HTMLElement> {
  onContextMenu?: React.MouseEventHandler<T> | undefined;
  onPointerDown?: React.PointerEventHandler<T> | undefined;
  onTouchEnd?: React.TouchEventHandler<T> | undefined;
}

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

export function opensMenu(event: React.KeyboardEvent): boolean {
  return event.key === "ContextMenu" || (event.shiftKey && event.key === "F10");
}

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

function pointAt(x: number, y: number): { getBoundingClientRect: () => DOMRect } {
  const box = { x, y, left: x, top: y, right: x, bottom: y, width: 0, height: 0 };
  return { getBoundingClientRect: () => ({ ...box, toJSON: () => box }) };
}

function roomOf(y: number, grow: MenuGrow | undefined, seen: SeenRect): number {
  return grow === MENU_GROW.UP ? y - seen.y - MENU_MARGIN : seen.y + seen.height - MENU_MARGIN - y;
}

function settledOf(
  placement: MenuPlacement,
  size: { width: number; height: number },
  seen: SeenRect,
): MenuPlacement {
  const { button } = placement;
  if (size.height <= roomOf(placement.y, placement.grow, seen) || button === undefined) {
    return placement;
  }
  const flipped =
    placement.grow === MENU_GROW.UP
      ? { y: button.bottom + MENU_DROP, grow: MENU_GROW.DOWN }
      : { y: button.top - MENU_DROP, grow: MENU_GROW.UP };
  if (size.height <= roomOf(flipped.y, flipped.grow, seen)) return { ...placement, ...flipped };
  if (placement.align === MENU_ALIGN.END) {
    const end = button.left - MENU_DROP;
    return end - size.width >= seen.x + MENU_MARGIN ? { ...placement, x: end } : placement;
  }
  const start = button.right + MENU_DROP;
  return start + size.width <= seen.x + seen.width - MENU_MARGIN
    ? { ...placement, x: start }
    : placement;
}

interface SeenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function seenRect(): SeenRect {
  const seen = visibleViewport();
  let bottom = seen.bottom;
  for (const bar of document.querySelectorAll("[data-menu-keeps-clear]")) {
    const box = bar.getBoundingClientRect();
    if (box.height === 0 || bar.closest("[inert]") !== null) continue;
    if (box.top > (seen.top + seen.bottom) / 2 && box.top < bottom) bottom = box.top;
  }
  return { x: seen.left, y: seen.top, width: seen.right - seen.left, height: bottom - seen.top };
}

function itemsOf(menu: HTMLElement): HTMLElement[] {
  return [...menu.querySelectorAll<HTMLElement>(MENU_ITEM)].filter(
    (item) => item.closest('[role="menu"]') === menu,
  );
}

function keyedEntryOf(
  groups: readonly (readonly MenuEntry[])[],
  event: React.KeyboardEvent,
  menu: HTMLElement | null,
): MenuAction | MenuSubmenu | undefined {
  const target = event.target instanceof Element ? event.target : null;
  if (menu === null || target?.closest('[role="menu"]') !== menu) return undefined;
  return groups
    .flat()
    .find(
      (entry): entry is MenuAction | MenuSubmenu =>
        !isPanel(entry) &&
        !("disabled" in entry && entry.disabled === true) &&
        entry.pressedBy?.(event) === true,
    );
}

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

function endSlot(afterHint: boolean, setting: boolean): string {
  return cn(
    "ui-menu-item-end grid size-menu-glyph flex-none place-items-center text-muted-foreground [&>svg]:size-menu-glyph [&>svg]:flex-none [&>svg]:text-inherit [&>svg.settings-chevron]:size-menu-chevron",
    !afterHint && "ml-auto",
    setting && "text-foreground",
  );
}

function ItemEnd({ action }: { action: MenuAction }): React.JSX.Element | null {
  const hint =
    action.hint === undefined ? null : <span className="ui-menu-item-hint">{action.hint}</span>;
  if (action.mark === MENU_ITEM_MARK.SWITCH && action.checked !== undefined) {
    return (
      <>
        {hint}
        <span className={cn("ui-menu-item-switch flex flex-none", hint === null && "ml-auto")}>
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

function secondLine(action: MenuAction): boolean {
  return action.detail !== undefined && action.detailPlace !== MENU_DETAIL.BESIDE;
}

function ItemWords({
  masked,
  children,
}: {
  masked?: boolean | undefined;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <ReplayWords unmasked={useContext(MenuReplayUnmasked)} masked={masked}>
      {children}
    </ReplayWords>
  );
}

function ItemBody({
  action,
  column = true,
}: {
  action: MenuAction;
  column?: boolean;
}): React.JSX.Element {
  const beside = action.detailPlace === MENU_DETAIL.BESIDE;
  const glyph =
    column || action.icon !== undefined ? (
      <MenuGlyph masked={action.replayMasked}>{action.icon}</MenuGlyph>
    ) : null;
  if (action.detail === undefined) {
    return (
      <>
        {glyph}
        {action.tag === undefined ? (
          <OneLine className="ui-menu-item-label min-w-0 flex-1" words={action.label}>
            <ItemWords masked={action.replayMasked}>{action.label}</ItemWords>
          </OneLine>
        ) : (
          <span className="ui-menu-item-tagged flex min-w-0 flex-1 items-center gap-ui-8">
            <OneLine className="ui-menu-item-label min-w-0" words={action.label}>
              <ItemWords masked={action.replayMasked}>{action.label}</ItemWords>
            </OneLine>
            {action.tag}
          </span>
        )}
        <ItemEnd action={action} />
      </>
    );
  }
  return (
    <>
      {glyph}
      <span
        className={cn(
          "ui-menu-item-copy flex min-w-0 flex-1",
          beside ? "flex-row items-baseline gap-ui-8" : "flex-col gap-ui-2",
        )}
        data-place={beside ? MENU_DETAIL.BESIDE : undefined}
      >
        <OneLine
          className={cn("ui-menu-item-label min-w-0", beside ? "flex-initial" : "flex-none")}
          words={action.label}
        >
          <ItemWords masked={action.replayMasked}>{action.label}</ItemWords>
        </OneLine>
        <OneLine
          className={cn("ui-menu-item-detail", beside && "min-w-0 flex-[0_1000_auto]")}
          words={action.detail}
        >
          <ItemWords masked={action.replayMasked}>{action.detail}</ItemWords>
        </OneLine>
      </span>
      <ItemEnd action={action} />
    </>
  );
}

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

export function MenuItem({
  action,
  onChoose,
  steered,
}: {
  action: MenuAction;
  onChoose: () => void;
  steered?: SteeredMenuItem | undefined;
}): React.JSX.Element {
  const heard = action.detail === undefined ? undefined : `${action.label}, ${action.detail}`;
  if (steered !== undefined) {
    return (
      <SteeredItem
        action={action}
        steered={steered}
        heard={heard}
        onChoose={onChoose}
        body={<ItemBody action={action} column={false} />}
      />
    );
  }
  const pressed = pulseOnPress(onChoose, PRESS_PULSE.QUIET);
  const shared = {
    nativeButton: true,
    render: <button type="button" disabled={action.disabled} />,
    ...rovingItem(),
    label: action.label,
    "aria-label": heard,
    className: "ui-menu-item",
    "aria-disabled": action.disabled === true ? true : undefined,
    "data-detail": secondLine(action) ? "true" : undefined,
    closeOnClick: false,
    onClick: (event: BaseUIEvent<React.MouseEvent<HTMLElement>>) => {
      event.preventBaseUIHandler();
      pressed(event);
    },
  } as const;
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
    className: cn("ui-menu-item", DROPDOWN_MENU_ITEM, "data-highlighted:bg-secondary"),
    "data-steered": "true",
    "data-highlighted": steered.highlighted ? "true" : undefined,
    "data-variant": action.danger ? "destructive" : undefined,
    "data-danger": action.danger ? "true" : undefined,
    "data-detail": secondLine(action) ? "true" : undefined,
    onMouseDown: (event: React.MouseEvent) => event.preventDefault(),
    onMouseMove: off ? undefined : steered.onHover,
    onClick: off ? undefined : pulseOnPress(onChoose, PRESS_PULSE.QUIET),
  } as const;
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

function kindOf(line: Element): MenuLine["kind"] {
  if (line.tagName === "HR" || line.getAttribute("role") === "separator") return MENU_LINE.RULE;
  return line.getAttribute("role")?.startsWith("menuitem") === true
    ? MENU_LINE.ITEM
    : MENU_LINE.NOTE;
}

function linesOf(column: Element): MenuLine[] {
  const top = column.getBoundingClientRect().top;
  return [...column.children].flatMap((line) => {
    const box = line.getBoundingClientRect();
    if (box.height === 0) return [];
    return [{ top: box.top - top, bottom: box.bottom - top, kind: kindOf(line) }];
  });
}

function lengthsOf(style: CSSStyleDeclaration, names: readonly string[]): number {
  return names.reduce(
    (sum, name) => sum + (Number.parseFloat(style.getPropertyValue(name)) || 0),
    0,
  );
}

function cutRows(area: HTMLElement): void {
  const popup = area.parentElement;
  const column = area.firstElementChild;
  if (popup === null || column === null) return;
  popup.style.maxHeight = "";
  const shape = getComputedStyle(popup);
  const chrome = lengthsOf(shape, [
    "padding-top",
    "padding-bottom",
    "border-top-width",
    "border-bottom-width",
  ]);
  const room = Number.parseFloat(shape.maxHeight) - chrome;
  const fade = Number.parseFloat(getComputedStyle(area).getPropertyValue("--ui-scroll-fade"));
  if (!Number.isFinite(room) || !Number.isFinite(fade)) return;
  const cut = menuCut(linesOf(column), column.getBoundingClientRect().height, room, fade);
  if (cut !== undefined) popup.style.maxHeight = `${cut + chrome}px`;
}

function MenuRows({ children }: { children: React.ReactNode }): React.JSX.Element {
  const area = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const scroller = area.current;
    const column = scroller?.firstElementChild;
    if (scroller === null || column === null || column === undefined) return undefined;
    cutRows(scroller);
    if (!("ResizeObserver" in globalThis)) return undefined;
    const resized = new ResizeObserver(() => cutRows(scroller));
    if (scroller.parentElement !== null) resized.observe(scroller.parentElement);
    resized.observe(column);
    return () => resized.disconnect();
  }, []);
  return (
    <ScrollArea ref={area} size={SCROLL_SIZE.CONTENT} fade={SCROLL_FADE.BOTH}>
      <div className="flex flex-col">{children}</div>
    </ScrollArea>
  );
}

function besideMenu(item: HTMLElement | null, side: string): number {
  const menu = item?.closest('[role="menu"]');
  if (item === null || menu === null || menu === undefined) return MENU_DROP;
  const inside = item.getBoundingClientRect();
  const edge = menu.getBoundingClientRect();
  const within = side === "left" ? inside.left - edge.left : edge.right - inside.right;
  return within + MENU_DROP;
}

function Submenu({
  entry,
  open,
  entering = false,
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
  entering?: boolean;
  layer: MenuLayer;
  seen: SeenRect;
  leaving: boolean;
  surface: React.RefObject<HTMLDivElement | null>;
  onOpen: () => void;
  onBack: () => void;
  onChoose: (action: MenuAction) => void;
}): React.JSX.Element {
  const trigger = useRef<HTMLDivElement | null>(null);
  const focusInto = useRef(entering);
  const [popup, setPopup] = useState<HTMLDivElement | null>(null);
  const drawn = useCallback(
    (node: HTMLDivElement) => {
      surface.current = node;
      setPopup(node);
      return () => {
        if (surface.current === node) surface.current = null;
        setPopup(null);
      };
    },
    [surface],
  );
  useEffect(() => {
    if (!open || popup === null || !focusInto.current) return;
    focusInto.current = false;
    itemsOf(popup)[0]?.focus();
  }, [open, popup]);
  const enter = () => {
    if (open && popup !== null) {
      itemsOf(popup)[0]?.focus();
      return;
    }
    focusInto.current = true;
    onOpen();
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
    <DropdownMenuSub open={open}>
      <DropdownMenuSubTrigger
        ref={trigger}
        openOnHover={false}
        nativeButton
        render={<button type="button" />}
        label={entry.label}
        className="ui-menu-item"
        {...rovingItem()}
        data-open={open ? "true" : undefined}
        {...{ [SUBMENU_ITEM_ATTRIBUTE]: entry.label }}
        endClassName={endSlot(entry.hint !== undefined, false)}
        onClick={pulseOnPress((event: BaseUIEvent<React.MouseEvent<HTMLElement>>) => {
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
        <OneLine className="ui-menu-item-label min-w-0 flex-1" words={entry.label}>
          <ItemWords masked={entry.replayMasked}>{entry.label}</ItemWords>
        </OneLine>
        {entry.hint === undefined ? null : <span className="ui-menu-item-hint">{entry.hint}</span>}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent
        ref={drawn}
        className="ui-menu"
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
            <MenuItem key={entryKey(action)} action={action} onChoose={() => onChoose(action)} />
          ))}
        </MenuRows>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

const PANEL_ATTRIBUTE = "data-menu-panel";

const SUBMENU_ITEM_ATTRIBUTE = "data-menu-submenu";

function namedItemOf(
  menu: HTMLElement | null,
  attribute: typeof PANEL_ATTRIBUTE | typeof SUBMENU_ITEM_ATTRIBUTE,
  label: string,
): HTMLElement | undefined {
  if (menu === null) return undefined;
  return [...menu.querySelectorAll<HTMLElement>(`[${attribute}]`)].find(
    (item) => item.getAttribute(attribute) === label,
  );
}

const PANEL_CONTROL = 'button, [href], [tabindex]:not([tabindex="-1"])';

function focusInto(panel: HTMLElement): void {
  if (panel.contains(document.activeElement)) return;
  const start =
    panel.querySelector<HTMLElement>('input:not([type="hidden"]), textarea') ??
    panel.querySelector<HTMLElement>(PANEL_CONTROL) ??
    panel;
  start.focus({ preventScroll: true });
}

function leftLeaves(target: EventTarget): boolean {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    return target.value === "";
  }
  return !(target instanceof HTMLElement && target.isContentEditable);
}

interface PanelPlace {
  left: number;
  top: number;
}

function panelPlace(
  item: DOMRect,
  menu: DOMRect,
  size: { width: number; height: number },
  seen: SeenRect,
): PanelPlace {
  const right = seen.x + seen.width - MENU_MARGIN;
  const bottom = seen.y + seen.height - MENU_MARGIN;
  const after = menu.right + MENU_DROP;
  const before = menu.left - MENU_DROP - size.width;
  const x = after + size.width <= right || before < seen.x + MENU_MARGIN ? after : before;
  const down = item.top - MENU_INSET;
  const y = down + size.height <= bottom ? down : item.bottom + MENU_INSET - size.height;
  return {
    left: Math.max(seen.x + MENU_MARGIN, Math.min(x, right - size.width)),
    top: Math.max(seen.y + MENU_MARGIN, Math.min(y, bottom - size.height)),
  };
}

const PANEL_LAYER =
  "ui-menu-panel fixed isolate z-menu data-[layer=dialog]:z-menu-over-dialog data-[leaving=true]:pointer-events-none data-[leaving=true]:animate-menu-leave";

function PanelItem({
  entry,
  open,
  controls,
  onEnter,
}: {
  entry: MenuPanel;
  open: boolean;
  controls: string;
  onEnter: () => void;
}): React.JSX.Element {
  return (
    <DropdownMenuItem
      nativeButton
      render={<button type="button" />}
      {...rovingItem()}
      label={entry.label}
      className="ui-menu-item"
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls={open ? controls : undefined}
      data-popup-open={open ? "" : undefined}
      {...{ [PANEL_ATTRIBUTE]: entry.label }}
      closeOnClick={false}
      onClick={pulseOnPress((event: BaseUIEvent<React.MouseEvent<HTMLElement>>) => {
        event.preventBaseUIHandler();
        onEnter();
      }, PRESS_PULSE.QUIET)}
      onKeyDown={(event: BaseUIEvent<React.KeyboardEvent<HTMLElement>>) => {
        if (event.key !== "ArrowRight") return;
        event.preventDefault();
        event.stopPropagation();
        event.preventBaseUIHandler();
        onEnter();
      }}
    >
      <ItemBody action={{ ...entry, opens: true, onSelect: () => undefined }} />
    </DropdownMenuItem>
  );
}

function MenuPanelLayer({
  entry,
  id,
  menu,
  opener,
  layer,
  seen,
  leaving,
  surface,
  entered,
  onBack,
  onClose,
}: {
  entry: MenuPanel;
  id: string;
  menu: HTMLElement | null;
  opener: HTMLElement;
  layer: MenuLayer;
  seen: SeenRect;
  leaving: boolean;
  surface: React.RefObject<HTMLDivElement | null>;
  entered: boolean;
  onBack: () => void;
  onClose: (returnFocus: boolean) => void;
}): React.ReactPortal {
  const box = useRef<HTMLDivElement | null>(null);
  const [place, setPlace] = useState<PanelPlace | undefined>(undefined);
  const drawn = useCallback(
    (node: HTMLDivElement) => {
      box.current = node;
      surface.current = node;
      return () => {
        if (surface.current === node) surface.current = null;
      };
    },
    [surface],
  );
  useLayoutEffect(() => {
    const panel = box.current;
    if (panel === null || menu === null) return undefined;
    const measure = () => {
      const item = namedItemOf(menu, PANEL_ATTRIBUTE, entry.label);
      if (item === undefined) return;
      const { width, height } = panel.getBoundingClientRect();
      const next = panelPlace(
        item.getBoundingClientRect(),
        menu.getBoundingClientRect(),
        { width, height },
        seen,
      );
      setPlace((last) => (last?.left === next.left && last.top === next.top ? last : next));
    };
    measure();
    if (!("ResizeObserver" in globalThis)) return undefined;
    const resized = new ResizeObserver(measure);
    resized.observe(panel);
    resized.observe(menu);
    return () => resized.disconnect();
  }, [menu, entry.label, seen]);
  const [enteredFirst] = useState(entered);
  useEffect(() => {
    if (enteredFirst && box.current !== null) focusInto(box.current);
  }, [enteredFirst]);
  const doors = useMemo(
    () => ({ back: onBack, close: () => onClose(true), entered: enteredFirst }),
    [onBack, onClose, enteredFirst],
  );
  return createPortal(
    // biome-ignore lint/a11y/useSemanticElements: a panel beside its menu holds a list and its search, not a form's fields, so it is no `<fieldset>`.
    <div
      ref={drawn}
      id={id}
      role="group"
      aria-label={entry.label}
      className={PANEL_LAYER}
      data-layer={layer}
      data-leaving={leaving ? "true" : undefined}
      inert={leaving}
      style={{
        left: place?.left ?? 0,
        top: place?.top ?? 0,
        width: askedStyleWidth(entry.width ?? POPOVER_WIDTH.REGULAR),
        ...cssCustomProperties({ "--ui-popover-room": `${seen.height - 2 * MENU_MARGIN}px` }),
      }}
      onPointerEnter={(event) => {
        if (event.pointerType !== "touch" && box.current !== null) focusInto(box.current);
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.defaultPrevented || isComposingKey(event)) return;
        if (event.key !== "Escape" && !(event.key === "ArrowLeft" && leftLeaves(event.target))) {
          return;
        }
        event.preventDefault();
        onBack();
      }}
      onBlur={(event) => {
        const left = event.relatedTarget;
        if (leaving || !(left instanceof Node)) return;
        if (box.current?.contains(left) || menu?.contains(left) || opener.contains(left)) return;
        if (onItemCard(left, [menu, box.current])) return;
        onClose(false);
      }}
    >
      {entry.panel(doors)}
    </div>,
    document.body,
  );
}

const MENU_HEADING =
  "ui-menu-heading flex flex-col gap-ui-2 px-row-inset py-ui-4 text-caption leading-[inherit]";

const MENU_FOOTER =
  "ui-menu-footer flex flex-col gap-ui-2 px-row-inset py-ui-4 text-caption leading-[inherit] text-muted-foreground";

interface MenuProps {
  label: string;
  menu: DrawnMenu;
  subject?: MenuSubject | undefined;
  heading?: React.ReactNode;
  footer?: React.ReactNode;
  groups: readonly (readonly MenuEntry[])[];
  openOnChecked?: boolean;
  openOn?: string | undefined;
  onClose: (returnFocus: boolean) => void;
  replayUnmasked?: boolean | undefined;
}

function FloatingMenu({
  label,
  menu,
  heading,
  footer,
  groups,
  openOnChecked = false,
  openOn,
  onClose,
}: MenuProps): React.JSX.Element {
  const { id, placement, opener, leaving, ref: hold } = menu;
  const element = useRef<HTMLDivElement | null>(null);
  const [popup, setPopup] = useState<HTMLDivElement | null>(null);
  const drawn = useCallback(
    (node: HTMLDivElement | null) => {
      element.current = node;
      setPopup(node);
      hold(node);
    },
    [hold],
  );
  const [submenu, setSubmenu] = useState<string | undefined>(openOn);
  const roving = useRovingKeys<HTMLDivElement>({ stop: ROVING_STOP.NONE });
  const submenuElement = useRef<HTMLDivElement | null>(null);
  const panelElement = useRef<HTMLDivElement | null>(null);
  const panelId = useId();
  const [panelEntered, setPanelEntered] = useState(false);
  const [wasLeaving, setWasLeaving] = useState(leaving);
  if (wasLeaving !== leaving) {
    setWasLeaving(leaving);
    if (!leaving) setSubmenu(openOn);
  }
  const seen = useMemo(() => seenRect(), [placement]);
  const [settled, setSettled] = useState<
    { placement: MenuPlacement; hung: MenuPlacement } | undefined
  >();
  const hung = settled?.placement === placement ? settled.hung : placement;
  const anchor = useMemo(() => pointAt(hung.x, hung.y), [hung]);
  useLayoutEffect(() => {
    if (popup === null || settled?.placement === placement) return;
    const { width, height } = popup.getBoundingClientRect();
    setSettled({ placement, hung: settledOf(placement, { width, height }, seen) });
  }, [popup, placement, settled, seen]);
  const layer = layerOf(opener);
  const panel = groups
    .flat()
    .find((entry): entry is MenuPanel => isPanel(entry) && entry.label === submenu);
  const panelStands = useRef(false);
  panelStands.current = panel !== undefined && !leaving;
  const aim = useSubmenuAim(
    panel === undefined ? submenuElement : panelElement,
    submenu !== undefined && !leaving,
  );

  useEffect(() => {
    if (leaving || popup === null) return;
    const items = itemsOf(popup);
    const checked = openOnChecked
      ? items.find((item) => item.getAttribute("aria-checked") === "true")
      : undefined;
    (checked ?? items[0])?.focus();
  }, [popup, leaving, openOnChecked]);

  useEffect(() => {
    if (leaving) return;
    const pressed = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      const own = [element.current, submenuElement.current, panelElement.current];
      if (own.some((surface) => surface?.contains(target) === true)) return;
      if (onItemCard(target, own)) return;
      if (opener.contains(target)) return;
      onClose(false);
    };
    const leave = () => onClose(false);
    const away = () => {
      if (!panelStands.current) onClose(false);
    };
    document.addEventListener("pointerdown", pressed, true);
    window.addEventListener("blur", away);
    window.addEventListener("resize", leave);
    return () => {
      document.removeEventListener("pointerdown", pressed, true);
      window.removeEventListener("blur", away);
      window.removeEventListener("resize", leave);
    };
  }, [onClose, opener, leaving]);

  const keyDown = (event: BaseUIEvent<React.KeyboardEvent<HTMLDivElement>>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose(true);
      return;
    }
    if (event.key === "Tab") {
      event.stopPropagation();
      onClose(true);
      return;
    }
    const keyed = keyedEntryOf(groups, event, element.current);
    if (keyed !== undefined) {
      event.preventDefault();
      event.stopPropagation();
      event.preventBaseUIHandler();
      if ("items" in keyed)
        namedItemOf(element.current, SUBMENU_ITEM_ATTRIBUTE, keyed.label)?.click();
      else choose(keyed);
      return;
    }
    if (!roving.onKeyDown(event)) return;
    event.preventBaseUIHandler();
    setSubmenu(undefined);
  };

  const choose = (action: MenuAction) => {
    if (action.stays !== true) onClose(true);
    action.onSelect();
  };
  const pointerOver = (event: React.PointerEvent<HTMLDivElement>) => {
    const item = event.target instanceof Element ? event.target.closest(MENU_ITEM) : null;
    if (item === null || item.closest('[role="menu"]') !== element.current) return;
    const submenuOf = item.getAttribute(SUBMENU_ITEM_ATTRIBUTE) ?? undefined;
    const opens = item.getAttribute(PANEL_ATTRIBUTE) ?? submenuOf;
    if (opens !== undefined && event.pointerType === "touch") return;
    aim(
      () => {
        const holds = panelElement.current?.contains(document.activeElement) === true;
        if (opens !== submenu && holds && item instanceof HTMLElement) item.focus();
        if (opens !== submenu) setPanelEntered(false);
        setSubmenu(opens);
      },
      submenuOf === undefined ? undefined : item,
    );
  };
  const enterPanel = (label: string) => {
    if (submenu === label && panelElement.current !== null) {
      focusInto(panelElement.current);
      return;
    }
    setPanelEntered(true);
    setSubmenu(label);
  };
  const backFromPanel = useCallback((label: string) => {
    setSubmenu((standing) => (standing === label ? undefined : standing));
    namedItemOf(element.current, PANEL_ATTRIBUTE, label)?.focus();
  }, []);
  const panelBack = useMemo(
    () => (panel === undefined ? () => undefined : () => backFromPanel(panel.label)),
    [panel, backFromPanel],
  );

  return (
    <DropdownMenu open={!leaving} modal={false}>
      <DropdownMenuContent
        ref={drawn}
        id={id}
        className="ui-menu"
        aria-label={label}
        layer={layer}
        anchor={anchor}
        side={hung.grow === MENU_GROW.UP ? "top" : "bottom"}
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
              <div className={MENU_HEADING} role="none">
                {heading}
              </div>
              <DropdownMenuSeparator className="ui-menu-rule" />
            </>
          )}
          {groups.map((group, index) => (
            <Fragment key={groupKey(group)}>
              {index > 0 ? <DropdownMenuSeparator className="ui-menu-rule" /> : null}
              {group.map((entry) =>
                isPanel(entry) ? (
                  <PanelItem
                    key={entry.label}
                    entry={entry}
                    open={submenu === entry.label && !leaving}
                    controls={panelId}
                    onEnter={() => enterPanel(entry.label)}
                  />
                ) : "items" in entry ? (
                  <Submenu
                    key={entry.label}
                    entry={entry}
                    open={submenu === entry.label && !leaving}
                    entering={openOn === entry.label}
                    layer={layer}
                    seen={seen}
                    leaving={leaving}
                    surface={submenuElement}
                    onOpen={() => setSubmenu(entry.label)}
                    onBack={() =>
                      setSubmenu((standing) => (standing === entry.label ? undefined : standing))
                    }
                    onChoose={choose}
                  />
                ) : (
                  <MenuItem key={entryKey(entry)} action={entry} onChoose={() => choose(entry)} />
                ),
              )}
            </Fragment>
          ))}
          {footer === undefined ? null : (
            <>
              <DropdownMenuSeparator className="ui-menu-rule" />
              <div className={MENU_FOOTER} role="none">
                {footer}
              </div>
            </>
          )}
        </MenuRows>
      </DropdownMenuContent>
      {panel === undefined ? null : (
        <MenuPanelLayer
          key={panel.label}
          entry={panel}
          id={panelId}
          menu={popup}
          opener={opener}
          layer={layer}
          seen={seen}
          leaving={leaving}
          surface={panelElement}
          entered={panelEntered}
          onBack={panelBack}
          onClose={onClose}
        />
      )}
    </DropdownMenu>
  );
}

function startOf(list: HTMLElement, onChecked: boolean): HTMLElement | undefined {
  const items = itemsOf(list);
  const checked = onChecked
    ? items.find((item) => item.getAttribute("aria-checked") === "true")
    : undefined;
  return checked ?? items[0];
}

const SUBMENU_ATTRIBUTE = "data-submenu";

function SheetItem({
  action,
  submenu,
  onChoose,
}: {
  action: MenuAction;
  submenu?: string | undefined;
  onChoose: () => void;
}): React.JSX.Element {
  const heard = action.detail === undefined ? undefined : `${action.label}, ${action.detail}`;
  const shared = {
    type: "button",
    "aria-label": heard,
    disabled: action.disabled,
    className: cn("ui-menu-item", DROPDOWN_MENU_ITEM, DROPDOWN_MENU_ITEM_LIT),
    "data-variant": action.danger ? "destructive" : undefined,
    "data-danger": action.danger ? "true" : undefined,
    "data-detail": secondLine(action) ? "true" : undefined,
    [SUBMENU_ATTRIBUTE]: submenu,
    ...rovingItem(),
    onClick: pulseOnPress(onChoose, PRESS_PULSE.QUIET),
    onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (submenu === undefined || event.key !== "ArrowRight") return;
      event.preventDefault();
      onChoose();
    },
  } as const;
  const body = <ItemBody action={{ ...action, hint: undefined }} />;
  if (action.checked !== undefined) {
    return (
      <Carded action={action}>
        <button {...shared} role="menuitemcheckbox" aria-checked={action.checked}>
          {body}
        </button>
      </Carded>
    );
  }
  return (
    <Carded action={action}>
      <button
        {...shared}
        role="menuitem"
        aria-haspopup={submenu === undefined ? undefined : "menu"}
      >
        {body}
      </button>
    </Carded>
  );
}

function SheetRows({
  groups,
  onChoose,
  onOpen,
}: {
  groups: readonly (readonly MenuEntry[])[];
  onChoose: (action: MenuAction) => void;
  onOpen: (label: string) => void;
}): React.JSX.Element {
  return (
    <>
      {groups.map((group, index) => (
        <Fragment key={groupKey(group)}>
          {index > 0 ? <hr className={cn("ui-menu-rule", DROPDOWN_MENU_RULE)} /> : null}
          {group.map((entry) =>
            !("onSelect" in entry) ? (
              <SheetItem
                key={entry.label}
                action={{ ...entry, opens: true, onSelect: () => undefined }}
                submenu={entry.label}
                onChoose={() => onOpen(entry.label)}
              />
            ) : (
              <SheetItem key={entryKey(entry)} action={entry} onChoose={() => onChoose(entry)} />
            ),
          )}
        </Fragment>
      ))}
    </>
  );
}

function SheetPanel({
  entry,
  onBack,
  onClose,
}: {
  entry: MenuPanel;
  onBack: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const box = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (box.current !== null) focusInto(box.current);
  }, []);
  return (
    // biome-ignore lint/a11y/useSemanticElements: a panel beside its menu holds a list and its search, not a form's fields, so it is no `<fieldset>`.
    <div
      ref={box}
      role="group"
      aria-label={entry.label}
      className="ui-menu-sheet-panel flex min-h-0 flex-col"
      onKeyDown={(event) => {
        if (event.defaultPrevented || event.key !== "ArrowLeft" || !leftLeaves(event.target)) {
          return;
        }
        event.preventDefault();
        onBack();
      }}
    >
      {entry.panel({ back: onBack, close: onClose, entered: true })}
    </div>
  );
}

function MenuSheet({
  label,
  menu,
  subject,
  heading,
  footer,
  groups,
  openOnChecked = false,
  openOn,
  onClose,
  replayUnmasked = false,
}: MenuProps): React.JSX.Element {
  const { id, opener, leaving, ref: hold } = menu;
  const [opened, setOpened] = useState<string | undefined>(openOn);
  const page = groups
    .flat()
    .find(
      (entry): entry is MenuSubmenu | MenuPanel => !("onSelect" in entry) && entry.label === opened,
    );
  const backTo = useRef<string | undefined>(undefined);
  const [wasLeaving, setWasLeaving] = useState(leaving);
  if (wasLeaving !== leaving) {
    setWasLeaving(leaving);
    if (!leaving) setOpened(openOn);
  }
  const roving = useRovingKeys<HTMLDivElement>({ stop: ROVING_STOP.NONE });
  const [list, setList] = useState<HTMLDivElement | null>(null);
  const start = useRef<HTMLElement | null>(null);
  const away = () => onClose(false);
  const listed = useCallback(
    (node: HTMLDivElement | null) => {
      setList(node);
      roving.ref(node);
      start.current = node === null ? null : (startOf(node, openOnChecked) ?? null);
    },
    [roving.ref, openOnChecked],
  );
  useEffect(() => {
    if (list === null || leaving) return;
    const back =
      opened === undefined && backTo.current !== undefined
        ? [...list.querySelectorAll<HTMLElement>(`[${SUBMENU_ATTRIBUTE}]`)].find(
            (row) => row.getAttribute(SUBMENU_ATTRIBUTE) === backTo.current,
          )
        : undefined;
    backTo.current = undefined;
    (back ?? startOf(list, openOnChecked && opened === undefined))?.focus({ preventScroll: true });
  }, [list, opened, leaving, openOnChecked]);

  useEffect(() => {
    if (list === null || leaving) return;
    const now = document.activeElement;
    if (now instanceof HTMLElement && now !== document.body && now.isConnected) return;
    (startOf(list, false) ?? list.closest<HTMLElement>(".ui-dialog"))?.focus({
      preventScroll: true,
    });
  });

  const back = () => {
    backTo.current = page?.label;
    setOpened(undefined);
  };
  const choose = (action: MenuAction) => {
    if (action.stays !== true) onClose(true);
    action.onSelect();
  };
  const keyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (page !== undefined && event.key === "ArrowLeft") {
      event.preventDefault();
      back();
      return;
    }
    roving.onKeyDown(event);
  };
  const title = subject?.name ?? label;
  const name = page?.label ?? title;
  const detail = page === undefined ? subject?.detail : title;
  const headUnmasked = replayUnmasked && subject === undefined && page?.replayMasked !== true;
  return (
    <MenuSheetFrame
      open={!leaving}
      opener={opener}
      initialFocus={start}
      hold={hold}
      name={name}
      detail={detail}
      replayUnmasked={headUnmasked}
      mark={subject?.mark}
      back={page === undefined ? undefined : { label: title, onBack: back }}
      onAway={away}
    >
      {page !== undefined && isPanel(page) ? (
        <SheetPanel key={page.label} entry={page} onBack={back} onClose={() => onClose(true)} />
      ) : (
        <ScrollArea size={SCROLL_SIZE.CONTENT} fade={SCROLL_FADE.BOTH}>
          <div
            ref={listed}
            id={id}
            role="menu"
            aria-label={page?.label ?? label}
            className="ui-menu-sheet-rows"
            data-roving={roving["data-roving"]}
            onKeyDown={keyDown}
            onFocus={roving.onFocus}
          >
            {page === undefined ? (
              <>
                {heading === undefined ? null : (
                  <div className={MENU_HEADING} role="none">
                    {heading}
                  </div>
                )}
                <SheetRows groups={groups} onChoose={choose} onOpen={setOpened} />
                {footer === undefined ? null : (
                  <div className={MENU_FOOTER} role="none">
                    {footer}
                  </div>
                )}
              </>
            ) : (
              <SheetRows groups={[page.items]} onChoose={choose} onOpen={setOpened} />
            )}
          </div>
        </ScrollArea>
      )}
    </MenuSheetFrame>
  );
}

export function Menu(props: MenuProps): React.JSX.Element {
  const { placement } = props.menu;
  const sheet = useMemo(() => inNarrowRoom(), [placement]);
  return (
    <MenuReplayUnmasked.Provider value={props.replayUnmasked === true}>
      {sheet ? <MenuSheet {...props} /> : <FloatingMenu {...props} />}
    </MenuReplayUnmasked.Provider>
  );
}
