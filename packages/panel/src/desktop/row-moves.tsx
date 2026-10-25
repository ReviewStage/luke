import { APP_COMMAND } from "@luke/settings/shortcuts";
import { ArrowDownIcon, ArrowLeftIcon, ArrowRightIcon, ArrowUpIcon } from "@luke/ui";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { useAppCommand } from "../app-commands.js";
import type { MenuAction, MenuEntry } from "./action-menu.js";

/**
 * row-moves.tsx -- Move up and Move down in the menu of a row that is dragged to another place in its list, and Move left and Move right in a tab's, for every pointer; and ⇧⌘↑ and ⇧⌘↓ for the row that has the keyboard.
 *
 * A finger cannot drag a row or a tab to another place, as a mouse does
 * (`use-row-drag.ts`, `use-tab-drag.ts`): a finger moving on a list scrolls
 * it, and a finger held still on the row opens its menu (`useMenu`'s long
 * press). A keyboard drags nothing at all. So every row's menu offers the
 * move one place either way, whatever the pointer, and lands it by the
 * same move a drop makes, its chord at the item's end.
 *
 * A list hands each row its place through `RowPlaced`, so the row's menu,
 * drawn far below in the row's own component, reads it without a prop
 * threaded through every kind of row. A row standing in no list that
 * reorders, or in one that draws only some of its rows, reads none.
 *
 * The chords are the window's own commands (`MOVE_ROW_UP`, `MOVE_ROW_DOWN`),
 * offered by the list while one of its rows has the keyboard
 * (`useRowMoveKeys`), as the tab strip offers its own while a tab does.
 */

/** Where a row stands in a list that reorders: its place, how many rows the list has, and the move a drop makes. */
export interface RowPlace {
  readonly at: number;
  readonly count: number;
  readonly onMove: (from: number, to: number) => void;
}

/** Which way the rows run: down a list, or along a tab strip. */
export const ROW_RUN = {
  DOWN: "down",
  ALONG: "along",
} as const;

export type RowRun = (typeof ROW_RUN)[keyof typeof ROW_RUN];

const RowPlaceContext = createContext<RowPlace | undefined>(undefined);

/** Hands the row inside it its place in its list, which its menu offers to move it from. */
export function RowPlaced({
  place,
  children,
}: {
  place: RowPlace | undefined;
  children: ReactNode;
}): React.JSX.Element {
  return <RowPlaceContext.Provider value={place}>{children}</RowPlaceContext.Provider>;
}

/** The place the list around this row handed it, if it stands in one that reorders. */
export function useRowPlace(): RowPlace | undefined {
  return useContext(RowPlaceContext);
}

/**
 * The menu's items that move the row one place either way, those that
 * apply from where it stands; none for a row in no list that reorders.
 */
function rowMoveActions(place: RowPlace | undefined, run: RowRun = ROW_RUN.DOWN): MenuAction[] {
  if (place === undefined) return [];
  const { at, count, onMove } = place;
  const along = run === ROW_RUN.ALONG;
  const back: MenuAction = {
    label: along ? "Move left" : "Move up",
    icon: along ? <ArrowLeftIcon /> : <ArrowUpIcon />,
    command: along ? APP_COMMAND.MOVE_TAB_LEFT : APP_COMMAND.MOVE_ROW_UP,
    onSelect: () => onMove(at, at - 1),
  };
  const on: MenuAction = {
    label: along ? "Move right" : "Move down",
    icon: along ? <ArrowRightIcon /> : <ArrowDownIcon />,
    command: along ? APP_COMMAND.MOVE_TAB_RIGHT : APP_COMMAND.MOVE_ROW_DOWN,
    onSelect: () => onMove(at, at + 1),
  };
  return [...(at > 0 ? [back] : []), ...(at < count - 1 ? [on] : [])];
}

/** `groups` with the row's moves as a group of their own before them, where it has any. */
export function withRowMoves(
  groups: readonly (readonly MenuEntry[])[],
  place: RowPlace | undefined,
  run: RowRun = ROW_RUN.DOWN,
): readonly (readonly MenuEntry[])[] {
  const moves = rowMoveActions(place, run);
  return moves.length === 0 ? groups : [moves, ...groups];
}

/** What a list that moves its rows wears, so a row's focus is read by the list it stands directly in and not one of the lists nested in its rows. */
const MOVE_LIST = "data-row-moves";

/** A list's rows that move; one on its way out (`ListMotion`) is no longer one of them, as `use-row-drag.ts` counts them. */
const MOVING_ROW = ":scope > li:not([data-leaving])";

/** A press of a key in what is typed into belongs to the field, so a row's own name being edited keeps ⇧⌘↑ for its text. */
const TYPING = "input, textarea, select, [contenteditable]";

/**
 * Offers ⇧⌘↑ and ⇧⌘↓ while a row of the list has the keyboard, moving that
 * row one place by the same move a drop makes, and keeping it focused so the
 * chord can be pressed again. The list wears what this returns. `move` is the
 * list's move; none, for a list whose rows stay put, offers nothing.
 *
 * Note that the move is drawn before focus is put back, because moving the
 * focused row in the document takes the focus from it, as the tab strip's
 * step finds (`tabs.tsx`).
 */
export function useRowMoveKeys(move: ((from: number, to: number) => void) | undefined): {
  ref: (list: HTMLElement | null) => void;
  [MOVE_LIST]: "";
} {
  const [list, setList] = useState<HTMLElement | null>(null);
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (list === null) return;
    // Note that only a target whose nearest moving list is this one counts, because a section's own tasks stand in a list inside the section's row.
    const ownTarget = (target: EventTarget | null) =>
      target instanceof Element && target.closest(`[${MOVE_LIST}]`) === list;
    const focusIn = (event: FocusEvent) => {
      if (!ownTarget(event.target)) return;
      setHeld(!(event.target instanceof Element && event.target.matches(TYPING)));
    };
    const focusOut = (event: FocusEvent) => {
      if (ownTarget(event.target)) setHeld(false);
    };
    list.addEventListener("focusin", focusIn);
    list.addEventListener("focusout", focusOut);
    return () => {
      list.removeEventListener("focusin", focusIn);
      list.removeEventListener("focusout", focusOut);
    };
  }, [list]);
  const step = (by: -1 | 1) => {
    const control = document.activeElement;
    if (list === null || move === undefined || !(control instanceof HTMLElement)) return;
    const rows = [...list.querySelectorAll<HTMLElement>(MOVING_ROW)];
    const at = rows.findIndex((row) => row.contains(control));
    if (at < 0 || at + by < 0 || at + by >= rows.length) return;
    flushSync(() => move(at, at + by));
    if (control.isConnected && document.activeElement !== control) control.focus();
  };
  const offered = held && move !== undefined;
  useAppCommand(APP_COMMAND.MOVE_ROW_UP, offered ? () => step(-1) : undefined);
  useAppCommand(APP_COMMAND.MOVE_ROW_DOWN, offered ? () => step(1) : undefined);
  return { ref: setList, [MOVE_LIST]: "" };
}
