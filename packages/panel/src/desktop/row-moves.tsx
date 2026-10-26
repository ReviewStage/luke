import { APP_COMMAND } from "@luke/settings/shortcuts";
import { ArrowDownIcon, ArrowLeftIcon, ArrowRightIcon, ArrowUpIcon } from "@luke/ui";
import { createContext, useContext } from "react";
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
