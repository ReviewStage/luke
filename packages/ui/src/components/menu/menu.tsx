import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckIcon, ChevronRightIcon } from "../../face/glyphs.js";
import { useDisclosure } from "../../use-disclosure.js";

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
  /** A muted second line under the label, such as who shares a workspace, which a reader hears after it. */
  detail?: string | undefined;
  onSelect: () => void;
  /** Drawn red: the action cannot be taken back. */
  danger?: boolean;
  /** Printed muted at the item's end: the shortcut that takes the same action, as the app draws it. */
  hint?: React.ReactNode;
  /** Drawn dimmed and not chosen: the action does not apply now. */
  disabled?: boolean;
  /** A setting rather than an action: whether it is on, a check at the item's end saying so. */
  checked?: boolean;
}

/** An item that opens a menu of its own beside it rather than acting. */
export interface MenuSubmenu {
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

/** A menu drawn: standing open, or on its way out, and the element its exit is waited on. */
export interface DrawnMenu extends OpenMenu {
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
function dropBelow(button: HTMLElement): MenuPlacement {
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
 * no point of its own, under what was clicked from its start.
 */
export function atPointer(event: React.MouseEvent<HTMLElement>): MenuPlacement {
  if (event.clientX === 0 && event.clientY === 0) return dropBelowStart(event.currentTarget);
  return { x: event.clientX, y: event.clientY, align: MENU_ALIGN.START };
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
 * `contextMenu`, a right-click's handler that hangs it at the pointer and
 * hands focus back to `opener` where one is given, the ⋯ or the row the
 * keyboard reaches the menu from, else to what was clicked; and `keyMenu`,
 * the same row's key handler, which hangs it under the row from its start
 * on the menu key or ⇧F10, for a row with no ⋯ to reach it by.
 */
export function useMenu(shown: boolean) {
  const [menu, setMenu] = useState<OpenMenu | undefined>(undefined);
  const [standing, setStanding] = useState(false);
  if (standing && !shown) setStanding(false);
  const { mounted, leaving, ref } = useDisclosure(standing);
  const opener = useRef<HTMLElement | null>(null);
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
    mounted && menu !== undefined ? { ...menu, leaving, ref } : undefined;
  const trigger = (place: (button: HTMLElement) => MenuPlacement = dropBelow) => ({
    "aria-haspopup": "menu" as const,
    "aria-expanded": standing,
    onClick: (event: React.MouseEvent<HTMLElement>) => {
      if (standing) close(true);
      else show(place(event.currentTarget), event.currentTarget);
    },
  });
  const contextMenu =
    (opener?: React.RefObject<HTMLElement | null>) => (event: React.MouseEvent<HTMLElement>) => {
      event.preventDefault();
      show(atPointer(event), opener?.current ?? event.currentTarget);
    };
  const keyMenu = (event: React.KeyboardEvent<HTMLElement>) => {
    if (!opensMenu(event)) return;
    event.preventDefault();
    show(dropBelowStart(event.currentTarget), event.currentTarget);
  };
  return { open: standing ? menu : undefined, drawn, show, close, trigger, contextMenu, keyMenu };
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

/**
 * Moves focus between the items of the menu the key was heard on, its own
 * and not a submenu's, by a navigation key (Up, Down, Home, End), passing
 * over every item that does not apply now; answers whether the key was one.
 */
export function moveMenuFocus(event: React.KeyboardEvent<HTMLElement>): boolean {
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

/** What an item prints at its end: a setting's check while it is on, its hint, or nothing. */
function ItemEnd({ action }: { action: MenuAction }): React.JSX.Element | null {
  if (action.checked === true) {
    return (
      <span className="luke-menu-item-end">
        <CheckIcon />
      </span>
    );
  }
  if (action.hint === undefined) return null;
  return <span className="luke-menu-item-hint">{action.hint}</span>;
}

/**
 * One item, as a menu draws it, reached by the menu's keys (`moveMenuFocus`)
 * rather than by Tab: its glyph's column, its label and any detail under it,
 * and at its end its check or hint.
 */
export function MenuItem({
  action,
  onChoose,
}: {
  action: MenuAction;
  onChoose: () => void;
}): React.JSX.Element {
  const label = <span className="luke-menu-item-label">{action.label}</span>;
  const body = (
    <>
      <span className="luke-menu-item-glyph">{action.icon}</span>
      {action.detail === undefined ? (
        label
      ) : (
        <span className="luke-menu-item-copy">
          {label}
          <span className="luke-menu-item-detail">{action.detail}</span>
        </span>
      )}
      <ItemEnd action={action} />
    </>
  );
  // Note that a detail is heard after the label with a pause, because the two spans would otherwise run together.
  const heard = action.detail === undefined ? undefined : `${action.label}, ${action.detail}`;
  // A setting in a menu says whether it is on as a menu's check does.
  if (action.checked !== undefined) {
    return (
      <button
        type="button"
        role="menuitemcheckbox"
        aria-checked={action.checked}
        aria-label={heard}
        tabIndex={-1}
        className="luke-menu-item"
        data-detail={action.detail === undefined ? undefined : "true"}
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
      role="menuitem"
      aria-label={heard}
      tabIndex={-1}
      className="luke-menu-item"
      data-danger={action.danger ? "true" : undefined}
      data-detail={action.detail === undefined ? undefined : "true"}
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
      className="luke-menu-item"
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
      <span className="luke-menu-item-glyph">{entry.icon}</span>
      <span className="luke-menu-item-label">{entry.label}</span>
      <span className="luke-menu-item-end">
        <ChevronRightIcon />
      </span>
    </button>
  );
}

/**
 * A submenu, beside its item: to the menu's right, or its left where the
 * window leaves no room, its first item level with the item that opened it,
 * or its last where the window's foot leaves no room below, as at an
 * account's menu in a sidebar's corner.
 *
 * Note that it is portalled to the body beside the menu rather than drawn
 * inside the menu's element, because the surface's entrance animates a
 * transform, and a transformed box is the containing block of every fixed
 * box within it: a submenu inside would be placed against the menu instead
 * of the window, and land in the menu's own scroll box, scrolling the menu's
 * items out of sight as it took focus. React still bubbles its events
 * through the menu, so its keys pass the menu on their way out; it keeps its
 * own arrows, Left, and Escape, and leaves Tab to the menu, which closes
 * both. It leaves with the menu, fading as the menu does.
 */
function Submenu({
  open,
  layer,
  surface,
  leaving,
  onChoose,
  onBack,
}: {
  open: OpenSubmenu;
  /** The layer its menu stands in, which it stands in too. */
  layer: MenuLayer;
  /** The submenu's element, which the menu counts as its own when it hears a press. */
  surface: React.RefObject<HTMLDivElement | null>;
  leaving: boolean;
  onChoose: (action: MenuAction) => void;
  /** Closes the submenu alone, focus back on the item that opened it. */
  onBack: () => void;
}): React.JSX.Element {
  const { entry, anchor, focus } = open;
  const rows = entry.items.length;
  const [at, setAt] = useState<{ left: number; top: number } | undefined>(undefined);

  // Note that it is placed again as its rows change, because its owner may
  // draw it more while it stands, as a list of members does as it arrives,
  // and a taller submenu would run past the window's foot where it stood.
  useLayoutEffect(() => {
    const drawn = surface.current;
    const menu = anchor.closest('[role="menu"]');
    if (drawn === null || menu === null) return;
    const { width, height } = drawn.getBoundingClientRect();
    const beside = menu.getBoundingClientRect();
    const opener = anchor.getBoundingClientRect();
    const right = beside.right + MENU_DROP;
    const left =
      right + width > window.innerWidth - MENU_MARGIN ? beside.left - MENU_DROP - width : right;
    const down = opener.top - MENU_INSET;
    const top =
      down + height > window.innerHeight - MENU_MARGIN ? opener.bottom + MENU_INSET - height : down;
    setAt({
      left: clamp(left, MENU_MARGIN, window.innerWidth - width - MENU_MARGIN),
      top: clamp(top, MENU_MARGIN, window.innerHeight - height - MENU_MARGIN),
    });
  }, [anchor, surface, rows]);

  const placed = at !== undefined;
  useEffect(() => {
    if (placed && focus) surface.current?.querySelector<HTMLElement>(MENU_ITEM)?.focus();
  }, [placed, focus, surface]);

  const keyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" || event.key === "ArrowLeft") {
      event.preventDefault();
      event.stopPropagation();
      onBack();
      return;
    }
    if (moveMenuFocus(event)) event.stopPropagation();
  };

  return (
    <div
      ref={surface}
      className="luke-menu"
      role="menu"
      aria-label={entry.label}
      data-layer={layer}
      data-placed={String(placed)}
      data-leaving={leaving ? "true" : undefined}
      inert={leaving}
      style={at ?? { left: 0, top: 0 }}
      onKeyDown={keyDown}
    >
      {entry.items.map((action) => (
        <MenuItem key={action.label} action={action} onChoose={() => onChoose(action)} />
      ))}
    </div>
  );
}

/**
 * The menu itself, drawn over the window at the point it hangs from. It is
 * measured before it is painted, so it is drawn once and where it fits. A
 * heading, where one is given, stands over the items, muted and pressed by
 * nothing: whose account the menu is about. A footer, where one is given,
 * stands under them on the same terms: who made what the menu is about.
 */
export function Menu({
  label,
  menu,
  heading,
  footer,
  groups,
  onClose,
}: {
  label: string;
  /** Where it hangs, and whether it is on its way out (`useMenu`'s `drawn`). */
  menu: DrawnMenu;
  heading?: React.ReactNode;
  footer?: React.ReactNode;
  groups: readonly (readonly MenuEntry[])[];
  /** Closes the menu, handing focus back to its opener where nothing else has taken it. */
  onClose: (returnFocus: boolean) => void;
}): React.JSX.Element {
  const { placement, opener, leaving, ref: hold } = menu;
  const element = useRef<HTMLDivElement | null>(null);
  const drawn = useCallback(
    (node: HTMLDivElement | null) => {
      element.current = node;
      hold(node);
    },
    [hold],
  );
  const [at, setAt] = useState<{ left: number; top: number } | undefined>(undefined);
  const [submenu, setSubmenu] = useState<OpenSubmenu | undefined>(undefined);
  const submenuElement = useRef<HTMLDivElement | null>(null);
  // Opened again while it was leaving, the menu stands with no submenu, as one opened anew does.
  const [wasLeaving, setWasLeaving] = useState(leaving);
  if (wasLeaving !== leaving) {
    setWasLeaving(leaving);
    if (!leaving) setSubmenu(undefined);
  }

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

  // Focus lands on the first item as the menu is placed, and again as it is
  // opened while it was leaving.
  const placed = at !== undefined;
  useEffect(() => {
    if (placed && !leaving) element.current?.querySelector<HTMLElement>(MENU_ITEM)?.focus();
  }, [placed, leaving]);

  // Note that a press on the opener is left to the opener, because the
  // button's own press is what closes the menu it opened; and that a menu
  // leaving hears nothing, since it has closed already.
  useEffect(() => {
    if (leaving) return;
    const pressed = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (element.current?.contains(target) || submenuElement.current?.contains(target)) return;
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

  const keyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
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
      onClose(true);
      return;
    }
    // Walking the menu's own items leaves a submenu the pointer opened behind.
    if (moveMenuFocus(event)) setSubmenu(undefined);
  };

  const choose = (action: MenuAction) => {
    onClose(true);
    action.onSelect();
  };
  // Note that an open submenu draws its entry from this render's groups, because its owner may redraw them while it stands.
  const submenuNow =
    submenu === undefined
      ? undefined
      : {
          ...submenu,
          entry:
            groups
              .flat()
              .find(
                (entry): entry is MenuSubmenu =>
                  "items" in entry && entry.label === submenu.entry.label,
              ) ?? submenu.entry,
        };
  // Resting on another of the menu's own items closes the submenu, as a
  // system menu's does; resting on the submenu's items keeps it. Note that
  // the submenu is read as it stands now rather than as this render drew it,
  // because moving from one submenu's item to another's opens the second on
  // the pointer's entering it, heard before this, with no render between.
  const pointerOver = (event: React.PointerEvent<HTMLDivElement>) => {
    const item = event.target instanceof Element ? event.target.closest(MENU_ITEM) : null;
    if (item === null || item.closest('[role="menu"]') !== event.currentTarget) return;
    setSubmenu((standing) =>
      standing === undefined || standing.anchor === item ? standing : undefined,
    );
  };

  return createPortal(
    <div
      ref={drawn}
      className="luke-menu"
      role="menu"
      aria-label={label}
      data-layer={layerOf(opener)}
      data-placed={String(placed)}
      data-leaving={leaving ? "true" : undefined}
      inert={leaving}
      style={at ?? { left: placement.x, top: placement.y }}
      onKeyDown={keyDown}
      onPointerOver={pointerOver}
    >
      {heading === undefined ? null : (
        <>
          <div className="luke-menu-heading" role="none">
            {heading}
          </div>
          <hr className="luke-menu-rule" />
        </>
      )}
      {groups.map((group, index) => (
        <Fragment key={group[0]?.label}>
          {index > 0 ? <hr className="luke-menu-rule" /> : null}
          {group.map((entry) =>
            "items" in entry ? (
              <SubmenuItem
                key={entry.label}
                entry={entry}
                open={submenu?.entry.label === entry.label}
                onOpen={(anchor, focus) => setSubmenu({ entry, anchor, focus })}
              />
            ) : (
              <MenuItem key={entry.label} action={entry} onChoose={() => choose(entry)} />
            ),
          )}
        </Fragment>
      ))}
      {footer === undefined ? null : (
        <>
          <hr className="luke-menu-rule" />
          <div className="luke-menu-footer" role="none">
            {footer}
          </div>
        </>
      )}
      {submenu === undefined
        ? null
        : createPortal(
            <Submenu
              key={submenu.entry.label}
              open={submenuNow ?? submenu}
              layer={layerOf(opener)}
              surface={submenuElement}
              leaving={leaving}
              onChoose={choose}
              onBack={() => {
                setSubmenu(undefined);
                submenu.anchor.focus();
              }}
            />,
            document.body,
          )}
    </div>,
    document.body,
  );
}
