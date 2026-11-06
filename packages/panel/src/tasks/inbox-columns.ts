import { APP_COMMAND } from "@repo/settings/shortcuts";
import { TOOLBAR_LOOK } from "@repo/ui";
import { useVirtualRuns, type VirtualRowsHandle } from "@repo/ui/virtual-rows";
import { type RefObject, useCallback, useLayoutEffect, useRef, useState } from "react";
import { useAppCommand } from "../app-commands.js";
import { useColumnSplit } from "../column-split.js";
import { centerWithin, scrollerOf } from "../scroll-within.js";

export const INBOX_VIEW =
  "inbox-view @container grid min-h-0 flex-1 grid-cols-inbox data-[columns=item]:grid-cols-single data-[columns=list]:grid-cols-single [&>[hidden]]:hidden [&[data-columns=list]_.inbox-tasks]:border-r-0";

export const INBOX_VIEW_ITEMS =
  "inbox-view-items @container/inbox-item flex min-h-0 min-w-0 flex-col";

export const INBOX_COLUMNS = {
  BOTH: "both",
  LIST: "list",
  ITEM: "item",
} as const;

export type InboxColumnsShown = (typeof INBOX_COLUMNS)[keyof typeof INBOX_COLUMNS];

export interface InboxRowPresses {
  readonly hold: (itemId: string) => React.RefCallback<HTMLElement>;
  readonly find: (itemId: string) => HTMLElement | undefined;
  readonly first: () => HTMLElement | undefined;
  readonly itemOf: (element: EventTarget) => string | undefined;
  readonly holdRun: (run: RefObject<VirtualRowsHandle | null>) => () => void;
  readonly bringIn: (itemId: string, then: () => void) => boolean;
}

export function useInboxRowPresses(): InboxRowPresses {
  const runs = useVirtualRuns();
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
      holdRun: runs.hold,
      bringIn: runs.bringIn,
    };
  });
  return presses;
}

export interface InboxColumns {
  readonly ref: React.RefCallback<HTMLElement>;
  readonly shown: InboxColumnsShown;
  readonly onOpen: (itemId: string) => void;
  readonly onStep: () => void;
  readonly onBack: (() => void) | undefined;
  readonly onList: () => void;
  readonly rows: InboxRowPresses;
}

export const VIEW_OPTIONS = "View options";

const PHONE_HEAD_MORE = `.ui-toolbar[data-look="${TOOLBAR_LOOK.PHONE}"] > .ui-toolbar-actions button`;

export function listHeadControl(list: ParentNode | null): HTMLElement | null {
  return (
    list?.querySelector<HTMLElement>(`button[aria-label="${VIEW_OPTIONS}"]`) ??
    [...document.querySelectorAll<HTMLElement>(PHONE_HEAD_MORE)].find(
      (more) => more.closest("[hidden]") === null,
    ) ??
    null
  );
}

export interface InboxChoosing {
  readonly onClear: () => void;
  readonly onSingle?: ((single: boolean) => void) | undefined;
}

function listScroller(rows: InboxRowPresses): HTMLElement | undefined {
  const row = rows.first();
  return row === undefined ? undefined : scrollerOf(row);
}

function standsWithin(box: HTMLElement, row: HTMLElement): boolean {
  const outer = box.getBoundingClientRect();
  const inner = row.getBoundingClientRect();
  return inner.top >= outer.top && inner.bottom <= outer.bottom;
}

function shownColumns(single: boolean, chosen: string | undefined): InboxColumnsShown {
  if (!single) return INBOX_COLUMNS.BOTH;
  return chosen === undefined ? INBOX_COLUMNS.LIST : INBOX_COLUMNS.ITEM;
}

export function useInboxColumns(chosen: string | undefined, choosing: InboxChoosing): InboxColumns {
  const { ref: measure, single: measured } = useColumnSplit();
  const single = measured === true;
  const [showAlls, setShowAlls] = useState(0);
  const view = useRef<HTMLElement | null>(null);
  const pressed = useRef(false);
  const stepped = useRef(false);
  const left = useRef<string | undefined>(undefined);
  const scrolls = useRef(new Map<string, number>());
  const chosenLast = useRef<string | undefined>(chosen);
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
    const was = chosenLast.current;
    chosenLast.current = chosen;
    if (was === chosen || shown === INBOX_COLUMNS.ITEM) return;
    const list = listScroller(rows);
    if (list === undefined) return;
    if (was !== undefined) scrolls.current.set(was, list.scrollTop);
    if (chosen === undefined || pressed.current || stepped.current) return;
    const kept = scrolls.current.get(chosen);
    if (kept !== undefined) {
      list.scrollTop = kept;
      return;
    }
    const row = rows.find(chosen);
    if (row !== undefined && standsWithin(list, row)) return;
    if (!rows.bringIn(chosen, () => undefined) && row !== undefined) centerWithin(list, row);
  }, [chosen, shown, rows]);

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
    if (shown === INBOX_COLUMNS.ITEM) {
      if (handed) {
        held.querySelector<HTMLElement>(".inbox-view-items:not([hidden]) header button")?.focus();
      }
      return;
    }
    const row = from === undefined ? undefined : rows.find(from);
    const broughtIn =
      row === undefined && from !== undefined && rows.bringIn(from, () => rows.find(from)?.focus());
    if (!handed) {
      row?.focus();
      return;
    }
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
