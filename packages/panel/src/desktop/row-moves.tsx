import { APP_COMMAND } from "@repo/settings/shortcuts";
import { ArrowDownIcon, ArrowLeftIcon, ArrowRightIcon, ArrowUpIcon } from "@repo/ui";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { useAppCommand } from "../app-commands.js";
import type { MenuAction, MenuEntry } from "./action-menu.js";

export interface RowPlace {
  readonly at: number;
  readonly count: number;
  readonly onMove: (from: number, to: number) => void;
}

export const ROW_RUN = {
  DOWN: "down",
  ALONG: "along",
} as const;

export type RowRun = (typeof ROW_RUN)[keyof typeof ROW_RUN];

const RowPlaceContext = createContext<RowPlace | undefined>(undefined);

export function RowPlaced({
  place,
  children,
}: {
  place: RowPlace | undefined;
  children: ReactNode;
}): React.JSX.Element {
  return <RowPlaceContext.Provider value={place}>{children}</RowPlaceContext.Provider>;
}

export function useRowPlace(): RowPlace | undefined {
  return useContext(RowPlaceContext);
}

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

function destroys(group: readonly MenuEntry[] | undefined): boolean {
  return (
    group !== undefined &&
    group.length > 0 &&
    group.every((entry) => "danger" in entry && entry.danger === true)
  );
}

export function withRowMoves(
  groups: readonly (readonly MenuEntry[])[],
  place: RowPlace | undefined,
  run: RowRun = ROW_RUN.DOWN,
): readonly (readonly MenuEntry[])[] {
  const moves = rowMoveActions(place, run);
  if (moves.length === 0) return groups;
  if (run === ROW_RUN.ALONG) return [moves, ...groups];
  const last = groups.at(-1);
  return destroys(last) && last !== undefined
    ? [...groups.slice(0, -1), moves, last]
    : [...groups, moves];
}

const MOVE_LIST = "data-row-moves";

const MOVING_ROW = ":scope > li:not([data-leaving])";

const ROW_INDEX = "data-index";

const TYPING = "input, textarea, select, [contenteditable]";

export function useRowMoveKeys(move: ((from: number, to: number) => void) | undefined): {
  ref: (list: HTMLElement | null) => void;
  [MOVE_LIST]: "";
} {
  const [list, setList] = useState<HTMLElement | null>(null);
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (list === null) return;
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
    const drawnAt = rows.findIndex((row) => row.contains(control));
    const row = rows[drawnAt];
    if (row === undefined) return;
    const placed = row.getAttribute(ROW_INDEX);
    const at = placed === null ? drawnAt : Number(placed);
    if (at + by < 0 || (placed === null && at + by >= rows.length)) return;
    flushSync(() => move(at, at + by));
    if (control.isConnected && document.activeElement !== control) control.focus();
  };
  const offered = held && move !== undefined;
  useAppCommand(APP_COMMAND.MOVE_ROW_UP, offered ? () => step(-1) : undefined);
  useAppCommand(APP_COMMAND.MOVE_ROW_DOWN, offered ? () => step(1) : undefined);
  return { ref: setList, [MOVE_LIST]: "" };
}
