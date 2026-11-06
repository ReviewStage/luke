import { type RefObject, useLayoutEffect, useRef } from "react";
import { SHELL_ROOM, type ShellRoom } from "../shell-room.js";

const FOCUSABLE =
  'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const CHOSEN = '[aria-current]:not([aria-current="false"])';

function firstIn(column: HTMLElement, selector: string): HTMLElement | undefined {
  return [...column.querySelectorAll<HTMLElement>(selector)].find(
    (each) => each.closest("[inert]") === null,
  );
}

function openerIn(list: HTMLElement, item: HTMLElement): HTMLElement | undefined {
  if (item.id === "") return undefined;
  return [...list.querySelectorAll<HTMLElement>("[aria-controls]")].find(
    (each) => each.getAttribute("aria-controls") === item.id && each.closest("[inert]") === null,
  );
}

function headingOf(column: HTMLElement): HTMLElement | undefined {
  const heading = firstIn(column, "h1, h2");
  if (heading !== undefined && !heading.hasAttribute("tabindex")) heading.tabIndex = -1;
  return heading;
}

function focusLost(hidden: HTMLElement): boolean {
  const active = document.activeElement;
  return active === null || active === document.body || hidden.contains(active);
}

export interface NarrowColumns {
  readonly list: string;
  readonly item: string;
}

const LIST_AND_ITEM: NarrowColumns = { list: ":scope > nav", item: ":scope > section" };

interface Shown {
  readonly room: ShellRoom;
  readonly listed: boolean;
}

function swapped(before: Shown | undefined, listed: boolean): boolean {
  if (before === undefined) return !listed;
  return before.listed !== listed || before.room !== SHELL_ROOM.NARROW;
}

export function useNarrowFocus(
  room: ShellRoom,
  listed: boolean,
  columns: NarrowColumns = LIST_AND_ITEM,
): RefObject<HTMLDivElement | null> {
  const screen = useRef<HTMLDivElement>(null);
  const was = useRef<Shown>(undefined);
  const handed = useRef<HTMLElement>(undefined);
  const left = useRef<HTMLElement>(undefined);
  useLayoutEffect(() => {
    const before = was.current;
    const now = { room, listed };
    const dropped = handed.current?.isConnected === false;
    if (room !== SHELL_ROOM.NARROW) {
      was.current = now;
      handed.current = undefined;
      return;
    }
    if (!swapped(before, listed) && !dropped) {
      was.current = now;
      return;
    }
    const root = screen.current;
    const list = root?.querySelector<HTMLElement>(columns.list);
    const item = root?.querySelector<HTMLElement>(columns.item);
    if (list === null || list === undefined || item === null || item === undefined) return;
    was.current = now;
    handed.current = undefined;
    const active = document.activeElement;
    if (!listed && active instanceof HTMLElement && list.contains(active)) left.current = active;
    if (!focusLost(listed ? item : list)) return;
    const back =
      left.current !== undefined &&
      list.contains(left.current) &&
      left.current.closest("[inert]") === null
        ? left.current
        : undefined;
    const target = listed
      ? (openerIn(list, item) ?? firstIn(list, CHOSEN) ?? back ?? firstIn(list, FOCUSABLE))
      : (firstIn(item, FOCUSABLE) ?? headingOf(item));
    if (listed) left.current = undefined;
    target?.focus();
    handed.current = target;
  });
  return screen;
}
