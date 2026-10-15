/**
 * inbox-columns.ts -- whether an Inbox shows its list and the item it reads side by side, or one at a time, by the room the Inbox itself has.
 *
 * An Inbox wide enough holds its list and the chosen item side by side, as a
 * mail app does. Narrower than {@link INBOX_SPLIT}, it shows one at a time,
 * and the one it shows is the item: the chosen one, the whole Inbox wide,
 * under a way back to the list, which Back's chord and Escape take as well,
 * so an Inbox holding one item is that item rather than a list of one row.
 * The list stands alone only once the way back was taken, or while nothing
 * is chosen, and a row pressed there opens its item again. An Inbox whose
 * list holds nothing but the item has no way back, there being no list worth
 * going back to. The line is drawn by the Inbox's own width rather than the
 * window's, because the window's Inbox and a plan's own Inbox tab stand in
 * columns of their own, beside a sidebar, a side panel, or neither. An Inbox
 * narrowed keeps the item it shows, as Material's list-detail layout does,
 * and one that splits again forgets that the list was asked for, so it
 * narrows onto its item again.
 */

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { APP_COMMAND } from "#shared/shortcuts";
import { useAppCommand } from "../app-commands";

/**
 * The Inbox's widths, in CSS pixels, between which it shows one column or
 * two. Narrower than `ENTER`, its list at its least width (300) would leave
 * the item beside it less than the 560 a question, a code card, and its
 * options read in (`inbox-list.tsx`); only wider than `LEAVE` does it split again, so an Inbox dragged
 * across the line does not split and join at every pixel.
 */
const INBOX_SPLIT = {
  ENTER: 860,
  LEAVE: 892,
} as const;

/** Which of the Inbox's columns stand. */
export const INBOX_COLUMNS = {
  /** The list and the item beside it. */
  BOTH: "both",
  /** The list alone, the whole Inbox wide. */
  LIST: "list",
  /** The item alone, the whole Inbox wide, under a way back to the list where the list holds more. */
  ITEM: "item",
} as const;

export type InboxColumnsShown = (typeof INBOX_COLUMNS)[keyof typeof INBOX_COLUMNS];

/** What the Inbox is laid out by. */
export interface InboxColumns {
  /** The Inbox's own element, whose width draws the line. */
  readonly ref: React.RefCallback<HTMLElement>;
  readonly shown: InboxColumnsShown;
  /** Says a row was pressed, which opens its item while the Inbox shows one column. */
  readonly onOpen: (itemId: string) => void;
  /** Goes back from the item to the list, while the item stands alone and the list holds more. */
  readonly onBack: (() => void) | undefined;
}

/** Whether an Inbox this wide shows one column, given whether it did, so the line it crosses depends on the way it is crossed. */
function oneColumn(width: number, was: boolean): boolean {
  return width < (was ? INBOX_SPLIT.LEAVE : INBOX_SPLIT.ENTER);
}

/** Which columns stand: both where split, else the item unless the list was asked for and is worth going back to, or nothing is chosen. */
function shownColumns(
  single: boolean,
  chosen: string | undefined,
  listAsked: boolean,
  backable: boolean,
): InboxColumnsShown {
  if (!single) return INBOX_COLUMNS.BOTH;
  if (chosen === undefined || (listAsked && backable)) return INBOX_COLUMNS.LIST;
  return INBOX_COLUMNS.ITEM;
}

/**
 * The Inbox's columns, measured as it resizes, for the item chosen and
 * whether the list holds more than it (`backable`). An Inbox that measures
 * nothing is not laid out, and keeps the two columns it starts with. Going
 * one way or the other by a press hands the keyboard on, to the item's bar
 * once an item opens and to its row once the list is back; a resize does so
 * only where it hid the column holding the keyboard, so the keyboard is
 * never left in what cannot be seen. Note that the keyboard is moved before
 * the window paints, while the hidden control still holds it.
 */
export function useInboxColumns(chosen: string | undefined, backable: boolean): InboxColumns {
  const [single, setSingle] = useState(false);
  const [listAsked, setListAsked] = useState(false);
  const view = useRef<HTMLElement | null>(null);
  const pressed = useRef(false);
  const ref = useCallback((element: HTMLElement | null) => {
    view.current = element;
    if (element === null) return undefined;
    const measure = () => {
      const width = element.getBoundingClientRect().width;
      if (width > 0) setSingle((was) => oneColumn(width, was));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // Note that an Inbox split again forgets the list was asked for, so narrowing it lands on its item.
  if (!single && listAsked) setListAsked(false);
  const shown = shownColumns(single, chosen, listAsked, backable);

  useLayoutEffect(() => {
    const held = view.current;
    if (held === null) return;
    const focused = document.activeElement;
    const stranded =
      focused instanceof HTMLElement &&
      held.contains(focused) &&
      focused.closest("[hidden]") !== null;
    if (!pressed.current && !stranded) return;
    pressed.current = false;
    // The item's bar leads with its way back, or with its crumbs where it has none.
    if (shown === INBOX_COLUMNS.ITEM) {
      held.querySelector<HTMLElement>(".inbox-view-items:not([hidden]) header button")?.focus();
    }
    if (shown !== INBOX_COLUMNS.LIST) return;
    const rows = held.querySelectorAll<HTMLElement>(".inbox-plans [data-item-id]");
    [...rows].find((row) => row.dataset.itemId === chosen)?.focus();
  }, [shown, chosen]);

  const back =
    shown === INBOX_COLUMNS.ITEM && backable
      ? () => {
          pressed.current = true;
          setListAsked(true);
        }
      : undefined;
  useAppCommand(APP_COMMAND.BACK, back);
  useAppCommand(APP_COMMAND.EXIT_INBOX, back);
  return {
    ref,
    shown,
    onOpen: () => {
      pressed.current = single;
      setListAsked(false);
    },
    onBack: back,
  };
}
