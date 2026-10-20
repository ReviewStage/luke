import { ArrowDownIcon, ArrowLeftIcon, ArrowRightIcon, ArrowUpIcon } from "@luke/ui";
import { createContext, type ReactNode, useContext } from "react";
import { coarsePointerNow } from "../coarse-pointer.js";
import type { MenuAction, MenuEntry } from "./action-menu.js";

/**
 * row-moves.tsx -- Move up and Move down in the menu of a row that is dragged to another place in its list, and Move left and Move right in a tab's, under a finger.
 *
 * A finger cannot drag a row or a tab to another place, as a mouse does
 * (`use-row-drag.ts`, `use-tab-drag.ts`): a finger moving on a list scrolls
 * it, and a finger held still on the row opens its menu (`useMenu`'s long
 * press). So that menu offers the move one place either way, under a finger
 * alone, and lands it by the same move a drop makes. A mouse keeps its drag
 * and its menu as they were. The pointer is asked as the menu is drawn,
 * never kept, as `coarse-pointer.ts` asks it.
 *
 * A list hands each row its place through `RowPlaced`, so the row's menu,
 * drawn far below in the row's own component, reads it without a prop
 * threaded through every kind of row. A row standing in no list that
 * reorders, or in one that draws only some of its rows, reads none.
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
 * apply from where it stands; none with a mouse, which drags it, or for a
 * row in no list that reorders.
 */
export function rowMoveActions(
  place: RowPlace | undefined,
  run: RowRun = ROW_RUN.DOWN,
): MenuAction[] {
  if (place === undefined || !coarsePointerNow()) return [];
  const { at, count, onMove } = place;
  const along = run === ROW_RUN.ALONG;
  const back: MenuAction = {
    label: along ? "Move left" : "Move up",
    icon: along ? <ArrowLeftIcon /> : <ArrowUpIcon />,
    onSelect: () => onMove(at, at - 1),
  };
  const on: MenuAction = {
    label: along ? "Move right" : "Move down",
    icon: along ? <ArrowRightIcon /> : <ArrowDownIcon />,
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
