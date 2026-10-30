/**
 * inbox-columns.ts -- whether an Inbox shows its list and the item it reads side by side, or one at a time, by the room the Inbox itself has.
 *
 * An Inbox wide enough holds its list and the chosen item side by side, as a
 * mail app does, the pane beside the list standing empty while nothing is
 * chosen. Narrower than {@link INBOX_SPLIT}, it shows one at a time, the
 * same in the window's Inbox, a task's own Inbox tab, and a phone's: the
 * item chosen, the whole Inbox wide, else the list. Nothing is chosen until
 * a row's press, a link, Next, or a thread started from its box chooses it, so an item is chosen
 * exactly when it is shown, and an Inbox that narrows, as a side panel opening
 * beside it narrows it, goes on showing the item it showed. Its way back,
 * which Back's chord and Escape take as well, chooses nothing, which stands
 * the list again. The line is drawn by the Inbox's own width rather than the
 * window's, because the window's Inbox and a task's own Inbox tab stand in
 * columns of their own, beside a sidebar, a side panel, or neither. A holder
 * hears whether the Inbox shows one column (`InboxChoosing`), as the window
 * does, so its history holds the list and the item as steps of their own by
 * this line rather than by the window's room, which is narrower.
 */

import { APP_COMMAND } from "@luke/settings/shortcuts";
import { TOOLBAR_LOOK } from "@luke/ui";
import type { VirtualRowsHandle } from "@luke/ui/virtual-rows";
import { type RefObject, useCallback, useLayoutEffect, useRef, useState } from "react";
import { useAppCommand } from "../app-commands.js";
import { useColumnSplit } from "../column-split.js";

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
  /** The item alone, the whole Inbox wide, under a way back to the list. */
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
  /** Holds a run of rows drawing only those near the view while it stands, so a row it leaves undrawn can be brought in; the answer lets it go. */
  readonly holdRun: (run: RefObject<VirtualRowsHandle | null>) => () => void;
  /** Brings the row of the item given into view, drawing it, and calls `then` once it is drawn; false where no run lists it. */
  readonly bringIn: (itemId: string, then: () => void) => boolean;
}

/** The list's rows' presses, kept as each row is drawn and dropped as it goes. */
export function useInboxRowPresses(): InboxRowPresses {
  const [presses] = useState(() => {
    const held = new Map<string, HTMLElement>();
    const refs = new Map<string, React.RefCallback<HTMLElement>>();
    const runs = new Set<RefObject<VirtualRowsHandle | null>>();
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
      holdRun: (run: RefObject<VirtualRowsHandle | null>) => {
        runs.add(run);
        return () => {
          runs.delete(run);
        };
      },
      bringIn: (itemId: string, then: () => void) =>
        [...runs].some((run) => run.current?.bringIn(itemId, then) === true),
    };
  });
  return presses;
}

/** What the Inbox is laid out by. */
export interface InboxColumns {
  /** The Inbox's own element, whose width draws the line. */
  readonly ref: React.RefCallback<HTMLElement>;
  readonly shown: InboxColumnsShown;
  /** Says a row was pressed, which hands the keyboard to the item it chose. */
  readonly onOpen: (itemId: string) => void;
  /** Says K or J stepped to another item, which hands the keyboard to its row while the list stands. */
  readonly onStep: () => void;
  /** Goes back from the item to the list, while the item stands alone. */
  readonly onBack: (() => void) | undefined;
  /** Says Show all turned off a filter that listed nothing, which hands the keyboard to the rows it lists. */
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

/** How the Inbox's holder chooses nothing, and hears whether it shows one column. */
export interface InboxChoosing {
  /** Chooses no item, which stands the list alone where the Inbox shows one column. */
  readonly onClear: () => void;
  /** Hears whether the Inbox shows one column, by its own width, so a holder's history steps between the list and the item exactly while they stand apart. */
  readonly onSingle?: ((single: boolean) => void) | undefined;
}

/** Which columns stand: both where split, else the item chosen, or the list while none is. */
function shownColumns(single: boolean, chosen: string | undefined): InboxColumnsShown {
  if (!single) return INBOX_COLUMNS.BOTH;
  return chosen === undefined ? INBOX_COLUMNS.LIST : INBOX_COLUMNS.ITEM;
}

/**
 * The Inbox's columns, measured as it resizes, for the item chosen. An Inbox that measures
 * nothing is not laid out, and keeps the two columns it starts with. Going
 * one way or the other by a press hands the keyboard on, to the item's bar
 * once an item opens and to its row once the list is back, or split, to the
 * row of the item a press opened from outside the list; a resize does so
 * only where it hid the column holding the keyboard, so the keyboard is
 * never left in what cannot be seen. K and J hand it to the row of the item
 * they step to while the list stands, so ↑↓ go on from there, and leave it
 * where it is while the item stands alone. Note that the keyboard is moved before
 * the window paints, while the hidden control still holds it.
 */
export function useInboxColumns(chosen: string | undefined, choosing: InboxChoosing): InboxColumns {
  // Note that the Inbox is neither one column nor split until it is measured, which lays it out split.
  const { ref: measure, single: measured } = useColumnSplit();
  const single = measured === true;
  // Note that Show all is counted, because it takes its own button away while what stands and what is chosen may stay as they were.
  const [showAlls, setShowAlls] = useState(0);
  const view = useRef<HTMLElement | null>(null);
  const pressed = useRef(false);
  const stepped = useRef(false);
  // Note that the way back chooses nothing, so the item it left is kept for the keyboard to land on its row.
  const left = useRef<string | undefined>(undefined);
  const rows = useInboxRowPresses();
  const ref = useCallback(
    (element: HTMLElement | null) => {
      view.current = element;
      return measure(element);
    },
    [measure],
  );
  const shown = shownColumns(single, chosen);
  const { onClear, onSingle } = choosing;
  useLayoutEffect(() => {
    onSingle?.(single);
  }, [single, onSingle]);

  useLayoutEffect(() => {
    const held = view.current;
    const step = stepped.current;
    stepped.current = false;
    const from = chosen ?? left.current;
    left.current = undefined;
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
    // Split, a press that opens an item from outside the list, as Next does, hands the keyboard to its row, and so do K and J,
    // its row brought into view and drawn first where the list draws only the rows near the view.
    const row = from === undefined ? undefined : rows.find(from);
    const broughtIn =
      row === undefined && from !== undefined && rows.bringIn(from, () => rows.find(from)?.focus());
    if (!handed) {
      row?.focus();
      return;
    }
    // An item chosen that the list holds no row for, as a link's missing item or one its scope leaves out, hands the keyboard to the first row instead, or to View options, the list's one steady control, where no row stands.
    if (!broughtIn) {
      (row ?? rows.first() ?? listHeadControl(held.querySelector(".inbox-tasks")))?.focus();
    }
    setShowAlls(0);
  }, [shown, chosen, showAlls, rows]);

  const back =
    shown === INBOX_COLUMNS.ITEM
      ? () => {
          pressed.current = true;
          left.current = chosen;
          onClear();
        }
      : undefined;
  useAppCommand(APP_COMMAND.BACK, back);
  useAppCommand(APP_COMMAND.INBOX_LIST, back);
  return {
    ref,
    shown,
    onOpen: (itemId) => {
      // Note that only a press that changes what stands is kept, since one that changes nothing draws nothing to hand the keyboard to, and a later resize would take it.
      pressed.current = itemId !== chosen;
    },
    onStep: () => {
      stepped.current = true;
    },
    onBack: back,
    onList: () => {
      pressed.current = true;
      setShowAlls((count) => count + 1);
    },
    rows,
  };
}
