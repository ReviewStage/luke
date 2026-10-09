import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AppCommand } from "#shared/shortcuts";
import { ShortcutGlyphs } from "../tooltip";

/**
 * action-menu.tsx -- the window's own drop-down menu: a plan's actions, and the side panel's tabs to open.
 *
 * The menu is drawn here rather than asked of the system so that every door
 * draws it the same way and Delete can be drawn red. It behaves as a system
 * menu does: focus on its first item, the arrow keys between items, and
 * Escape, Tab, a press elsewhere, or the window losing the keyboard closing
 * it with focus back where it was. An item that cannot be chosen now is drawn
 * dimmed and skipped by the keys, the way a system menu draws one.
 */

/** Which way from the point it hangs at a menu grows: rightward from it, or leftward to it. */
export const MENU_ALIGN = {
  START: "start",
  END: "end",
} as const;

type MenuAlign = (typeof MENU_ALIGN)[keyof typeof MENU_ALIGN];

/** The gap a menu keeps from the window's edges, in CSS pixels. */
const MENU_MARGIN = 8;
/** The gap between a button and the menu dropped from it. */
export const MENU_DROP = 4;
const MENU_ITEM = '[role="menuitem"]:not(:disabled)';

/** Where a menu hangs: a point in the window, and which way from it the menu grows. */
export interface MenuPlacement {
  x: number;
  y: number;
  align: MenuAlign;
}

export interface MenuAction {
  label: string;
  /** The glyph leading the label, drawn in a column every item keeps whether or not it has one. */
  icon?: React.JSX.Element;
  onSelect: () => void;
  /** Drawn red: the action cannot be taken back. */
  danger?: boolean;
  /** The shortcut that takes the same action, printed muted at the item's end. */
  command?: AppCommand;
  /** Why the item cannot be chosen now, printed muted at its end in the shortcut's place; the item is dimmed. */
  unavailable?: string;
}

/** A menu standing open: where it hangs, and the control that opened it, which takes focus back. */
export interface OpenMenu {
  placement: MenuPlacement;
  opener: HTMLElement;
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

/** What an item prints at its end: why it cannot be chosen, or its shortcut, or nothing. */
function ItemEnd({ action }: { action: MenuAction }): React.JSX.Element | null {
  if (action.unavailable !== undefined) {
    return <span className="plan-menu-end">{action.unavailable}</span>;
  }
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
  return (
    <button
      type="button"
      role={inMenu ? "menuitem" : undefined}
      tabIndex={inMenu ? -1 : undefined}
      className="plan-menu-item"
      data-danger={action.danger ? "true" : undefined}
      disabled={action.unavailable !== undefined}
      onClick={onChoose}
    >
      <span className="plan-menu-icon">{action.icon}</span>
      <span className="plan-menu-label">{action.label}</span>
      <ItemEnd action={action} />
    </button>
  );
}

/**
 * The menu itself, drawn over the window at the point it hangs from. It is
 * measured before it is painted, so it is drawn once and where it fits.
 */
export function ActionMenu({
  label,
  menu,
  groups,
  onClose,
}: {
  label: string;
  menu: OpenMenu;
  groups: readonly (readonly MenuAction[])[];
  /** Closes the menu, handing focus back to its opener where nothing else has taken it. */
  onClose: (returnFocus: boolean) => void;
}): React.JSX.Element {
  const { placement, opener } = menu;
  const element = useRef<HTMLDivElement | null>(null);
  const [at, setAt] = useState<{ left: number; top: number } | undefined>(undefined);

  useLayoutEffect(() => {
    const drawn = element.current;
    if (drawn === null) return;
    const { width, height } = drawn.getBoundingClientRect();
    const left = placement.align === MENU_ALIGN.END ? placement.x - width : placement.x;
    setAt({
      left: clamp(left, MENU_MARGIN, window.innerWidth - width - MENU_MARGIN),
      top: clamp(placement.y, MENU_MARGIN, window.innerHeight - height - MENU_MARGIN),
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
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>(MENU_ITEM)];
    const next = itemAfter(
      event.key,
      items.findIndex((item) => item.matches(":focus")),
      items.length,
    );
    if (next === undefined) return;
    event.preventDefault();
    items[next]?.focus();
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
    >
      {groups.map((group, index) => (
        <Fragment key={group[0]?.label}>
          {index > 0 ? <hr className="plan-menu-rule" /> : null}
          {group.map((action) => (
            <MenuItem
              key={action.label}
              action={action}
              inMenu
              onChoose={() => {
                onClose(true);
                action.onSelect();
              }}
            />
          ))}
        </Fragment>
      ))}
    </div>,
    document.body,
  );
}
