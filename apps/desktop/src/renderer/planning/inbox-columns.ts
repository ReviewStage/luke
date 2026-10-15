/**
 * inbox-columns.ts -- whether an Inbox shows its list and the item it reads side by side, or one at a time, by the room the Inbox itself has.
 *
 * An Inbox wide enough holds its list and the chosen item side by side, as a
 * mail app does. Narrower than {@link INBOX_SPLIT}, it shows one at a time,
 * as Linear's Inbox and GitHub's Primer list-and-detail do: the list, the
 * whole Inbox wide, and once a row is pressed, that item, the whole Inbox
 * wide, under a way back to the list, which Back's chord and Escape take as
 * well. The line is drawn by the Inbox's own width rather than the window's,
 * because the window's Inbox and a plan's own Inbox tab stand in columns of
 * their own, beside a sidebar, a side panel, or neither. An item stays open
 * across a resize only once a press opened it, so a narrowed Inbox lands on
 * its list rather than on the item it chose for itself, and one that
 * leaves the list gives the list back.
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
  /** The item alone, the whole Inbox wide, under a way back to the list. */
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
  /** Goes back from the item to the list, while the item stands alone. */
  readonly onBack: (() => void) | undefined;
}

/** Whether an Inbox this wide shows one column, given whether it did, so the line it crosses depends on the way it is crossed. */
function oneColumn(width: number, was: boolean): boolean {
  return width < (was ? INBOX_SPLIT.LEAVE : INBOX_SPLIT.ENTER);
}

/**
 * The Inbox's columns, measured as it resizes. An Inbox that measures
 * nothing is not laid out, and keeps the two columns it starts with. Going
 * one way or the other by a press hands the keyboard on, to the way back
 * once an item opens and to its row once the list is back; a resize does so
 * only where it hid the column holding the keyboard, so the keyboard is
 * never left in what cannot be seen. Note that the keyboard is moved before
 * the window paints, while the hidden control still holds it.
 */
export function useInboxColumns(chosen: string | undefined): InboxColumns {
  const [single, setSingle] = useState(false);
  const [opened, setOpened] = useState<string | undefined>(undefined);
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
  const shown: InboxColumnsShown = !single
    ? INBOX_COLUMNS.BOTH
    : opened !== undefined && opened === chosen
      ? INBOX_COLUMNS.ITEM
      : INBOX_COLUMNS.LIST;

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
    if (shown === INBOX_COLUMNS.ITEM) held.querySelector<HTMLElement>(".inbox-back")?.focus();
    if (shown !== INBOX_COLUMNS.LIST) return;
    const rows = held.querySelectorAll<HTMLElement>(".inbox-plans [data-item-id]");
    [...rows].find((row) => row.dataset.itemId === chosen)?.focus();
  }, [shown, chosen]);

  const back =
    shown === INBOX_COLUMNS.ITEM
      ? () => {
          pressed.current = true;
          setOpened(undefined);
        }
      : undefined;
  useAppCommand(APP_COMMAND.BACK, back);
  useAppCommand(APP_COMMAND.EXIT_INBOX, back);
  return {
    ref,
    shown,
    onOpen: (itemId) => {
      pressed.current = single;
      setOpened(itemId);
    },
    onBack: back,
  };
}
