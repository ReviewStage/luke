/**
 * inbox-toast.ts -- says in the window's toast that inbox items opened while the window was focused away from their task's Inbox, with a View that opens a task's Inbox, for the news's hold or until the items no longer wait or their Inbox is shown.
 *
 * Main decides which items the window hears (`@luke/host/agent-notices`):
 * those each read found opened, handed over together, and only while the
 * window is focused, the OS's notification saying them while the window is
 * behind. One item's toast says what the notification would, the task's
 * name on its second line, and its View does what the notification's click
 * does. Items that opened together are one toast saying how many, under
 * the tasks they wait in, its View opening the first's, so a reader hears
 * them once rather than only the last of a run of toasts. A toast stands for
 * the news's hold and leaves by itself, since the items go on waiting in
 * their plan's Inbox, or sooner once it has nothing left to ask: once none
 * of its items waits, answered here or elsewhere or taken back by its
 * agent, or once every one stands on the Inbox on screen. Several reads may
 * land in a row, so each toast waits for room rather than pushing out an
 * earlier one.
 */

import { andList, inboxArrivalWords } from "@luke/features/words";
import type { AppInboxTask } from "@luke/host/app-state";
import { STATUS_TONE } from "@luke/ui";
import { useEffect, useRef } from "react";
import { appBridge } from "../app-bridge.js";
import { TOAST_HOLD, useToast, useWithdrawToast } from "../toast.js";
import { appStateNow } from "../use-app-state.js";

/** What an opened item's toast offers, to open its task's Inbox. */
const VIEW_LABEL = "View";

/** One item a toast tells: the item, and the task whose Inbox it waits in. */
interface ToldItem {
  readonly itemId: string;
  readonly taskId: string;
}

/**
 * Says the items main hands the window together in one toast, `view`
 * opening a task's Inbox, and withdraws it once `waiting`, main's word on
 * what waits, holds none of them, or `shownInbox`, the task whose Inbox is
 * on screen, holds them all.
 */
export function useInboxToasts(
  view: (taskId: string) => void,
  waiting: readonly AppInboxTask[],
  /** The version of main's document `waiting` was read from. */
  version: number,
  shownInbox: string | null,
): void {
  const toast = useToast();
  const withdraw = useWithdrawToast();
  // Read through a ref, because the caller hands a new closure each render
  // and the subscription is owed to the window, not to a render.
  const viewing = useRef(view);
  viewing.current = view;
  // The toasts said and not yet withdrawn, each by its first item, with the
  // items it tells and the version of main's document the window held as
  // the toast arrived.
  const told = useRef(new Map<string, { items: readonly ToldItem[]; heard: number }>());
  useEffect(
    () =>
      appBridge().onInboxItemOpened(({ items }) => {
        const [first] = items;
        if (first === undefined) return;
        const one = items.length === 1;
        told.current.set(first.itemId, { items, heard: appStateNow()?.version ?? -1 });
        toast({
          words: one ? first.words : inboxArrivalWords(items.map((item) => item.words)),
          detail: one ? first.detail : andList([...new Set(items.map((item) => item.detail))]),
          waits: true,
          hold: TOAST_HOLD.NEWS,
          subject: first.itemId,
          tone: STATUS_TONE.ATTENTION,
          action: { label: VIEW_LABEL, onPress: () => viewing.current(first.taskId) },
        });
      }),
    [toast],
  );
  // Note that what waits withdraws a toast only from a version of main's
  // document newer than the one held as the toast arrived, because main
  // writes the items into what waits before it hands the window the toast,
  // so only a word that came after the toast and lacks them says they no
  // longer wait; an older one may be drawn after the toast was said.
  useEffect(() => {
    const now = new Set(waiting.flatMap((task) => task.items.map((item) => item.id)));
    for (const [subject, { items, heard }] of told.current) {
      const gone = version > heard && items.every((item) => !now.has(item.itemId));
      if (!gone && !items.every((item) => item.taskId === shownInbox)) continue;
      withdraw(subject);
      told.current.delete(subject);
    }
  }, [waiting, version, shownInbox, withdraw]);
}
