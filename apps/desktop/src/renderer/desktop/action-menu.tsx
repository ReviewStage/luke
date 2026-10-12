import { CheckIcon, ChevronRightIcon } from "lucide-react";
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { KeyedCommand } from "#shared/shortcuts";
import { ShortcutGlyphs } from "../tooltip";

/**
 * action-menu.tsx -- the window's own drop-down menu: a plan's actions, a repository's, a side panel tab's, and the account's.
 *
 * The one menu the plan's ⋯ and right-click, a repository header's ⋯ and
 * right-click, a tab's right-click, and the sidebar's account row draw, whose
 * items the empty side panel also lists as buttons of their own. It is
 * drawn here rather than asked of the system so that every door draws it
 * the same way and an action can be drawn red. It behaves as a system menu
 * does: focus on its first item, the arrow keys
 * between items, and Escape, Tab, a press elsewhere, or the window losing
 * the keyboard closing it with focus back where it was. An item that does
 * not apply now is drawn dimmed and passed over, as a system menu's is. An
 * item may open a submenu beside it instead of acting, as a system menu's
 * does: resting on it, pressing it, or Right opens it, Left or Escape in it
 * closes it alone, and resting on another item closes it.
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
/** The menu's own padding around its items, `--menu-inset`, which a submenu rises by so its first item is level with its opener. */
const MENU_INSET = 4;
/** The gap between a button and the menu dropped from it. */
export const MENU_DROP = 4;
/** The items the menu's keys move between: every one that applies now, a setting's as an action's. */
const MENU_ITEM = ':is([role="menuitem"], [role="menuitemcheckbox"]):not(:disabled)';

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
  onSelect: () => void;
  /** Drawn red: the action cannot be taken back. */
  danger?: boolean;
  /** The shortcut that takes the same action, printed muted at the item's end. */
  command?: KeyedCommand;
  /** Drawn dimmed and not chosen: the action does not apply now. */
  disabled?: boolean;
  /** A setting rather than an action: whether it is on, a check at the item's end saying so. */
  checked?: boolean;
}

/** An item that opens a menu of its own beside it rather than acting. */
interface MenuSubmenu {
  label: string;
  icon?: React.JSX.Element;
  items: readonly MenuAction[];
}

/** One line of a menu: an action, or a submenu of them. */
export type MenuEntry = MenuAction | MenuSubmenu;

/** A submenu standing open: its item, the item's button it stands beside, and whether it takes focus. */
interface OpenSubmenu {
  entry: MenuSubmenu;
  anchor: HTMLElement;
  focus: boolean;
}

/** A menu standing open: where it hangs, and the control that opened it, which takes focus back. */
export interface OpenMenu {
  placement: MenuPlacement;
  opener: HTMLElement;
}

/** Where a menu dropped from a button hangs: under it, its right edge on the button's. */
export function dropBelow(button: HTMLElement): MenuPlacement {
  const bounds = button.getBoundingClientRect();
  return { x: bounds.right, y: bounds.bottom + MENU_DROP, align: MENU_ALIGN.END };
}

/** Where a menu raised from a button at the window's foot hangs: over it, its left edge on the button's. */
export function riseAbove(button: HTMLElement): MenuPlacement {
  const bounds = button.getBoundingClientRect();
  return { x: bounds.left, y: bounds.top - MENU_DROP, align: MENU_ALIGN.START, grow: MENU_GROW.UP };
}

/** Where a right-click's menu hangs: at the pointer, growing rightward from it. */
export function atPointer(event: React.MouseEvent): MenuPlacement {
  return { x: event.clientX, y: event.clientY, align: MENU_ALIGN.START };
}

/**
 * One control's menu: where it hangs while it stands, the door that opens it
 * from an element, which takes focus back when it closes by key, and the
 * close. A menu does not outlive the surface it stands on, so it is taken
 * down in the render that finds the surface off screen.
 */
export function useActionMenu(shown: boolean) {
  const [open, setOpen] = useState<OpenMenu | undefined>(undefined);
  if (open !== undefined && !shown) setOpen(undefined);
  const opener = useRef<HTMLElement | null>(null);
  const close = useCallback((returnFocus: boolean) => {
    setOpen(undefined);
    if (returnFocus) opener.current?.focus();
  }, []);
  const show = useCallback((placement: MenuPlacement, element: HTMLElement) => {
    opener.current = element;
    setOpen({ placement, opener: element });
  }, []);
  return { open: shown ? open : undefined, show, close };
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(value, high));
}

/** The item a navigation key moves to from the focused one, or nothing for any other key. */
function itemAfter(key: string, at: number, count: number): number | undefined {
  switch (key) {
    case "ArrowDown":
      return (at + 1) % count;
    case "ArrowUp":
      return (at <= 0 ? count : at) - 1;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return undefined;
  }
}

/** The items of one menu, its own and not a submenu's within it, that the keys move between now. */
function itemsOf(menu: HTMLElement): HTMLElement[] {
  return [...menu.querySelectorAll<HTMLElement>(MENU_ITEM)].filter(
    (item) => item.closest('[role="menu"]') === menu,
  );
}

/** Moves focus between a menu's own items by a navigation key, answering whether the key was one. */
function moveFocus(event: React.KeyboardEvent<HTMLElement>): boolean {
  const items = itemsOf(event.currentTarget);
  const next = itemAfter(
    event.key,
    items.findIndex((item) => item.matches(":focus")),
    items.length,
  );
  if (next === undefined) return false;
  event.preventDefault();
  items[next]?.focus();
  return true;
}

/** What an item prints at its end: a setting's check while it is on, its shortcut, or nothing. */
function ItemEnd({ action }: { action: MenuAction }): React.JSX.Element | null {
  if (action.checked === true) return <CheckIcon aria-hidden="true" className="plan-menu-check" />;
  if (action.command === undefined) return null;
  return <ShortcutGlyphs command={action.command} className="plan-menu-end" />;
}

/** One item, as a menu draws it and as a list of the same offers outside a menu draws it. */
export function MenuItem({
  action,
  inMenu,
  onChoose,
}: {
  action: MenuAction;
  /** A menu's item, reached by the menu's keys, or else a button of its own in the page's order. */
  inMenu: boolean;
  onChoose: () => void;
}): React.JSX.Element {
  const body = (
    <>
      <span className="plan-menu-icon">{action.icon}</span>
      <span className="plan-menu-label">{action.label}</span>
      <ItemEnd action={action} />
    </>
  );
  // A setting in a menu says whether it is on as a menu's check does.
  if (inMenu && action.checked !== undefined) {
    return (
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={action.checked}
        tabIndex={-1}
        className="plan-menu-item"
        disabled={action.disabled}
        onClick={onChoose}
      >
        {body}
      </button>
    );
  }
  return (
    <button
      type="button"
      role={inMenu ? "menuitem" : undefined}
      tabIndex={inMenu ? -1 : undefined}
      className="plan-menu-item"
      data-danger={action.danger ? "true" : undefined}
      disabled={action.disabled}
      onClick={onChoose}
    >
      {body}
    </button>
  );
}

/**
 * A submenu's item: its glyph, its name, and the chevron that says it opens
 * a menu beside it rather than acting.
 */
function SubmenuItem({
  entry,
  open,
  onOpen,
}: {
  entry: MenuSubmenu;
  open: boolean;
  onOpen: (anchor: HTMLElement, focus: boolean) => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      className="plan-menu-item"
      aria-haspopup="menu"
      aria-expanded={open}
      data-open={open ? "true" : undefined}
      onPointerEnter={(event) => onOpen(event.currentTarget, false)}
      onClick={(event) => onOpen(event.currentTarget, true)}
      onKeyDown={(event) => {
        if (event.key !== "ArrowRight") return;
        event.preventDefault();
        onOpen(event.currentTarget, true);
      }}
    >
      <span className="plan-menu-icon">{entry.icon}</span>
      <span className="plan-menu-label">{entry.label}</span>
      <ChevronRightIcon aria-hidden="true" className="plan-menu-check" />
    </button>
  );
}

/**
 * A submenu, beside its item: to the menu's right, or its left where the
 * window leaves no room, its first item level with the item that opened it.
 * It stands inside the menu's own element, so a press in it is a press in the
 * menu and its keys pass the menu on their way out; it keeps its own arrows,
 * Left, and Escape, and leaves Tab to the menu, which closes both.
 */
function Submenu({
  open,
  onChoose,
  onBack,
}: {
  open: OpenSubmenu;
  onChoose: (action: MenuAction) => void;
  /** Closes the submenu alone, focus back on the item that opened it. */
  onBack: () => void;
}): React.JSX.Element {
  const { entry, anchor, focus } = open;
  const element = useRef<HTMLDivElement | null>(null);
  const [at, setAt] = useState<{ left: number; top: number } | undefined>(undefined);

  useLayoutEffect(() => {
    const drawn = element.current;
    const menu = anchor.closest('[role="menu"]');
    if (drawn === null || menu === null) return;
    const { width, height } = drawn.getBoundingClientRect();
    const beside = menu.getBoundingClientRect();
    const right = beside.right + MENU_DROP;
    const left =
      right + width > window.innerWidth - MENU_MARGIN ? beside.left - MENU_DROP - width : right;
    const top = anchor.getBoundingClientRect().top - MENU_INSET;
    setAt({
      left: clamp(left, MENU_MARGIN, window.innerWidth - width - MENU_MARGIN),
      top: clamp(top, MENU_MARGIN, window.innerHeight - height - MENU_MARGIN),
    });
  }, [anchor]);

  const placed = at !== undefined;
  useEffect(() => {
    if (placed && focus) element.current?.querySelector<HTMLElement>(MENU_ITEM)?.focus();
  }, [placed, focus]);

  const keyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" || event.key === "ArrowLeft") {
      event.preventDefault();
      event.stopPropagation();
      onBack();
      return;
    }
    if (moveFocus(event)) event.stopPropagation();
  };

  return (
    <div
      ref={element}
      className="plan-menu plan-submenu"
      role="menu"
      aria-label={entry.label}
      data-placed={String(placed)}
      style={at ?? { left: 0, top: 0 }}
      onKeyDown={keyDown}
    >
      {entry.items.map((action) => (
        <MenuItem key={action.label} action={action} inMenu onChoose={() => onChoose(action)} />
      ))}
    </div>
  );
}

/**
 * The menu itself, drawn over the window at the point it hangs from. It is
 * measured before it is painted, so it is drawn once and where it fits. A
 * heading, where one is given, stands over the items, muted and pressed by
 * nothing: whose account the menu is about.
 */
export function ActionMenu({
  label,
  menu,
  heading,
  groups,
  onClose,
}: {
  label: string;
  menu: OpenMenu;
  heading?: React.ReactNode;
  groups: readonly (readonly MenuEntry[])[];
  /** Closes the menu, handing focus back to its opener where nothing else has taken it. */
  onClose: (returnFocus: boolean) => void;
}): React.JSX.Element {
  const { placement, opener } = menu;
  const element = useRef<HTMLDivElement | null>(null);
  const [at, setAt] = useState<{ left: number; top: number } | undefined>(undefined);
  const [submenu, setSubmenu] = useState<OpenSubmenu | undefined>(undefined);

  useLayoutEffect(() => {
    const drawn = element.current;
    if (drawn === null) return;
    const { width, height } = drawn.getBoundingClientRect();
    const left = placement.align === MENU_ALIGN.END ? placement.x - width : placement.x;
    const top = placement.grow === MENU_GROW.UP ? placement.y - height : placement.y;
    setAt({
      left: clamp(left, MENU_MARGIN, window.innerWidth - width - MENU_MARGIN),
      top: clamp(top, MENU_MARGIN, window.innerHeight - height - MENU_MARGIN),
    });
  }, [placement]);

  const placed = at !== undefined;
  useEffect(() => {
    if (placed) element.current?.querySelector<HTMLElement>(MENU_ITEM)?.focus();
  }, [placed]);

  // Note that a press on the opener is left to the opener, because the
  // button's own press is what closes the menu it opened.
  useEffect(() => {
    const pressed = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (element.current?.contains(target) || opener.contains(target)) return;
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
  }, [onClose, opener]);

  const keyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // The menu is the nearest open layer, so Escape closes it alone and
    // leaves the plan behind it open.
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose(true);
      return;
    }
    // Note that Tab hands focus back before the browser moves it, because
    // the browser's own move then goes on from the opener to its neighbour.
    if (event.key === "Tab") {
      onClose(true);
      return;
    }
    moveFocus(event);
  };

  const choose = (action: MenuAction) => {
    onClose(true);
    action.onSelect();
  };
  // Resting on another of the menu's own items closes the submenu, as a
  // system menu's does; resting on the submenu's items keeps it.
  const pointerOver = (event: React.PointerEvent<HTMLDivElement>) => {
    const item = event.target instanceof Element ? event.target.closest(MENU_ITEM) : null;
    if (submenu === undefined || item === null || item === submenu.anchor) return;
    if (item.closest('[role="menu"]') === event.currentTarget) setSubmenu(undefined);
  };

  return createPortal(
    <div
      ref={element}
      className="plan-menu"
      role="menu"
      aria-label={label}
      data-placed={String(placed)}
      style={at ?? { left: placement.x, top: placement.y }}
      onKeyDown={keyDown}
      onPointerOver={pointerOver}
    >
      {heading === undefined ? null : (
        <>
          <div className="plan-menu-heading" role="none">
            {heading}
          </div>
          <hr className="plan-menu-rule" />
        </>
      )}
      {groups.map((group, index) => (
        <Fragment key={group[0]?.label}>
          {index > 0 ? <hr className="plan-menu-rule" /> : null}
          {group.map((entry) =>
            "items" in entry ? (
              <SubmenuItem
                key={entry.label}
                entry={entry}
                open={submenu?.entry.label === entry.label}
                onOpen={(anchor, focus) => setSubmenu({ entry, anchor, focus })}
              />
            ) : (
              <MenuItem key={entry.label} action={entry} inMenu onChoose={() => choose(entry)} />
            ),
          )}
        </Fragment>
      ))}
      {submenu === undefined ? null : (
        <Submenu
          key={submenu.entry.label}
          open={submenu}
          onChoose={choose}
          onBack={() => {
            setSubmenu(undefined);
            submenu.anchor.focus();
          }}
        />
      )}
    </div>,
    document.body,
  );
}
