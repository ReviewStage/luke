/**
 * inbox-columns.ts -- whether an Inbox shows its list and the item it reads side by side, or one at a time, by the room the Inbox itself has.
 *
 * An Inbox wide enough holds its list and the chosen item side by side, as a
 * mail app does. Narrower than {@link INBOX_SPLIT}, it shows one at a time,
 * and the one it shows is the item: the chosen one, the whole Inbox wide,
 * under a way back to the list, which Back's chord and Escape take as well,
 * so an Inbox holding one item is that item rather than a list of one row.
 * The list stands alone only once the way back was taken or Show all
 * pressed, or while nothing is chosen, and a row pressed there opens its
 * item again. In a narrow room, a phone's, the list is the place, so an
 * Inbox there opens on its list, and an item stands alone only once a row
 * is pressed or a link asks for it. An Inbox whose
 * list holds nothing but the item has no way back, there being no list worth
 * going back to. The line is drawn by the Inbox's own width rather than the
 * window's, because the window's Inbox and a task's own Inbox tab stand in
 * columns of their own, beside a sidebar, a side panel, or neither. An Inbox
 * narrowed keeps the item it shows, as Material's list-detail layout does,
 * and one that splits again forgets that the list was asked for, so it
 * narrows onto its item again. Whether the list was asked for is the
 * Inbox's own, unless its holder keeps it (`InboxListing`), as the window
 * keeps its Inbox's, so its history can go back to the list; such a holder
 * hears whether the Inbox shows one column too, so its history holds the
 * list and the item as steps of their own by this line rather than by the
 * window's room, which is narrower.
 */

import { APP_COMMAND } from "@luke/settings/shortcuts";
import { TOOLBAR_LOOK } from "@luke/ui";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useAppCommand } from "../app-commands.js";
import { useColumnSplit } from "../column-split.js";
import { usePhoneRoom } from "../stage-room.js";

/**
 * The Inbox's two columns, the list as wide as it was last dragged and the
 * item beside it, held to what the Inbox's own width leaves the pane, which
 * is why the Inbox is the container it measures; too narrow for both, the
 * list or the item stands alone the whole Inbox wide, and the list needs no
 * edge to part it from the item.
 */
export const INBOX_VIEW =
  "inbox-view @container grid min-h-0 flex-1 grid-cols-inbox data-[columns=item]:grid-cols-single data-[columns=list]:grid-cols-single [&>[hidden]]:hidden [&[data-columns=list]_.inbox-tasks]:border-r-0";

/** The chosen item's column, a container its bar answers (`inbox-item`). */
export const INBOX_VIEW_ITEMS =
  "inbox-view-items @container/inbox-item flex min-h-0 min-w-0 flex-col";

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

/** The list's rows' presses, each kept by the id of the item it opens through the row's ref. */
export interface InboxRowPresses {
  /** The ref of the row of the item given, the same one on every render. */
  readonly hold: (itemId: string) => React.RefCallback<HTMLElement>;
  readonly find: (itemId: string) => HTMLElement | undefined;
  /** The press highest in the list. */
  readonly first: () => HTMLElement | undefined;
  /** The item whose row's press is the element given, if it is one. */
  readonly itemOf: (element: EventTarget) => string | undefined;
}

/** The list's rows' presses, kept as each row is drawn and dropped as it goes. */
export function useInboxRowPresses(): InboxRowPresses {
  const [presses] = useState(() => {
    const held = new Map<string, HTMLElement>();
    const refs = new Map<string, React.RefCallback<HTMLElement>>();
    return {
      hold: (itemId: string) => {
        const known = refs.get(itemId);
        if (known !== undefined) return known;
        const ref = (element: HTMLElement | null) => {
          if (element !== null) {
            held.set(itemId, element);
            return;
          }
          // Note that a row gone takes its ref with it, so an Inbox left open keeps only the rows it draws.
          held.delete(itemId);
          refs.delete(itemId);
        };
        refs.set(itemId, ref);
        return ref;
      },
      find: (itemId: string) => held.get(itemId),
      first: () =>
        [...held.values()].reduce<HTMLElement | undefined>(
          (top, each) =>
            top === undefined ||
            each.compareDocumentPosition(top) & Node.DOCUMENT_POSITION_FOLLOWING
              ? each
              : top,
          undefined,
        ),
      itemOf: (element: EventTarget) => [...held].find(([, press]) => press === element)?.[0],
    };
  });
  return presses;
}

/** What the Inbox is laid out by. */
export interface InboxColumns {
  /** The Inbox's own element, whose width draws the line. */
  readonly ref: React.RefCallback<HTMLElement>;
  readonly shown: InboxColumnsShown;
  /** Says a row was pressed, which opens its item while the Inbox shows one column. */
  readonly onOpen: (itemId: string) => void;
  /** Says K or J stepped to another item, which hands the keyboard to its row while the list stands, as Chat's keys hand it to theirs. */
  readonly onStep: () => void;
  /** Goes back from the item to the list, while the item stands alone and the list holds more. */
  readonly onBack: (() => void) | undefined;
  /** Asks for the list, as Show all does turning off a filter that listed nothing, so the item then chosen does not stand in the rows' place. */
  readonly onList: () => void;
  /** The list's rows' presses, which the list keeps and a press handing the keyboard on finds. */
  readonly rows: InboxRowPresses;
}

/** What the list head's menu button is called, by which the list finds it. */
export const VIEW_OPTIONS = "View options";

/** The ⋯ of a phone's page header (`phone-head.tsx`, `Toolbar`'s phone look), the one standing on screen. */
const PHONE_HEAD_MORE = `.luke-toolbar[data-look="${TOOLBAR_LOOK.PHONE}"] > .luke-toolbar-actions button`;

/**
 * The list head's View options button, the list's one steady control,
 * which chooses what it lists; or, on a phone, whose header holds View
 * options in its ⋯ (the window's Inbox's own head, or a task's header over
 * its Inbox tab), that ⋯, never the search's field, whose focus would
 * raise a phone's keyboard.
 */
export function listHeadControl(list: ParentNode | null): HTMLElement | null {
  return (
    list?.querySelector<HTMLElement>(`button[aria-label="${VIEW_OPTIONS}"]`) ??
    [...document.querySelectorAll<HTMLElement>(PHONE_HEAD_MORE)].find(
      (more) => more.closest("[hidden]") === null,
    ) ??
    null
  );
}

/** Whether the list was asked for, kept by the Inbox's holder rather than the Inbox, and the way to ask for it or give it up. */
export interface InboxListing {
  readonly asked: boolean;
  readonly onAsk: (asked: boolean) => void;
  /** Hears whether the Inbox shows one column, by its own width, so a holder's history steps between the list and the item exactly while they stand apart. */
  readonly onSingle?: ((single: boolean) => void) | undefined;
}

/** Whether the list was asked for, held by the Inbox itself where its holder keeps none: asked from the start in a narrow room, where the list is the place. */
function useListing(kept: InboxListing | undefined): InboxListing {
  const phone = usePhoneRoom();
  const [asked, setAsked] = useState(phone);
  return kept ?? { asked, onAsk: setAsked };
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
 * once an item opens and to its row once the list is back, or split, to the
 * row of the item a press opened from outside the list; a resize does so
 * only where it hid the column holding the keyboard, so the keyboard is
 * never left in what cannot be seen. K and J hand it to the row of the item
 * they step to while the list stands, so ↑↓ go on from there, and leave it
 * where it is while the item stands alone. Note that the keyboard is moved before
 * the window paints, while the hidden control still holds it. `kept` is
 * whether the list was asked for where the holder keeps it.
 */
export function useInboxColumns(
  chosen: string | undefined,
  backable: boolean,
  kept?: InboxListing,
): InboxColumns {
  // Note that the Inbox is neither one column nor split until it is measured, which lays it out split.
  const { ref: measure, single: measured } = useColumnSplit();
  const single = measured === true;
  const { asked: listAsked, onAsk: setListAsked } = useListing(kept);
  // Note that Show all is counted, because it takes its own button away while what stands and what is chosen may stay as they were.
  const [showAlls, setShowAlls] = useState(0);
  const view = useRef<HTMLElement | null>(null);
  const pressed = useRef(false);
  const stepped = useRef(false);
  const rows = useInboxRowPresses();
  const ref = useCallback(
    (element: HTMLElement | null) => {
      view.current = element;
      return measure(element);
    },
    [measure],
  );
  // Note that an Inbox measured split forgets the list was asked for, so narrowing it lands on its
  // item; one not yet measured keeps it, since the list a holder kept may be what it narrows onto.
  const split = measured === false;
  useLayoutEffect(() => {
    if (split && listAsked) setListAsked(false);
  }, [split, listAsked, setListAsked]);
  const shown = shownColumns(single, chosen, listAsked, backable);
  const onSingle = kept?.onSingle;
  useLayoutEffect(() => {
    onSingle?.(single);
  }, [single, onSingle]);

  useLayoutEffect(() => {
    const held = view.current;
    const step = stepped.current;
    stepped.current = false;
    if (held === null) return;
    const focused = document.activeElement;
    const stranded =
      focused instanceof HTMLElement &&
      held.contains(focused) &&
      focused.closest("[hidden]") !== null;
    const handed = pressed.current || stranded || showAlls > 0;
    if (!handed && !step) return;
    pressed.current = false;
    // The item's bar leads with its way back, or with its crumbs where it has none; K and J, stepping from the item, leave the keyboard there.
    if (shown === INBOX_COLUMNS.ITEM) {
      if (handed) {
        held.querySelector<HTMLElement>(".inbox-view-items:not([hidden]) header button")?.focus();
      }
      return;
    }
    // Split, a press that opens an item from outside the list, as Next does, hands the keyboard to its row, and so do K and J.
    const row = chosen === undefined ? undefined : rows.find(chosen);
    if (!handed) {
      row?.focus();
      return;
    }
    // An item chosen that the list holds no row for, as a link's missing item or one its scope leaves out, hands the keyboard to the first row instead, or to View options, the list's one steady control, where no row stands.
    (row ?? rows.first() ?? listHeadControl(held.querySelector(".inbox-tasks")))?.focus();
    setShowAlls(0);
  }, [shown, chosen, showAlls, rows]);

  const back =
    shown === INBOX_COLUMNS.ITEM && backable
      ? () => {
          pressed.current = true;
          setListAsked(true);
        }
      : undefined;
  useAppCommand(APP_COMMAND.BACK, back);
  useAppCommand(APP_COMMAND.INBOX_LIST, back);
  return {
    ref,
    shown,
    onOpen: (itemId) => {
      // Note that only a press that changes what stands is kept, since one that changes nothing draws nothing to hand the keyboard to, and a later resize would take it.
      pressed.current = itemId !== chosen || shown === INBOX_COLUMNS.LIST;
      setListAsked(false);
    },
    onStep: () => {
      stepped.current = true;
    },
    onBack: back,
    onList: () => {
      pressed.current = true;
      // Note that a split Inbox shows its list already, so only one column asks for it.
      if (single) setListAsked(true);
      setShowAlls((count) => count + 1);
    },
    rows,
  };
}
