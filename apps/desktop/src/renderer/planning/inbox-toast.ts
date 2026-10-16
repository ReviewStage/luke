/**
 * inbox-toast.ts -- says in the window's toast that an inbox item opened while the window was focused away from its plan's Inbox, with a View that opens that Inbox, until the item no longer waits or the Inbox is shown.
 *
 * Main decides which items the window hears (`@luke/host/agent-notices`): one
 * for each item that opens, and only while the window is focused, the OS's
 * notification saying it while the window is behind. The toast says what
 * the notification would, the plan's name on its second line, and its View
 * does what the notification's click does. It stands until it is dismissed
 * or has nothing left to ask: once the item stops waiting, answered here
 * or elsewhere or taken back by its agent, or once its plan's Inbox is on
 * screen, where the item itself stands. Several may open in one read, so
 * each waits for room rather than pushing out an earlier one.
 */

import type { AppInboxTask } from "@luke/host/app-state";
import { useEffect, useRef } from "react";
import { TOAST_TONE, useToast, useWithdrawToast } from "../toast";
import { appStateNow } from "../use-app-state";

/** What an opened item's toast offers, to open its plan's Inbox. */
const VIEW_LABEL = "View";

/**
 * Says each item main hands the window, `view` opening that plan's Inbox,
 * and withdraws it once `waiting`, main's word on what waits, no longer
 * holds it, or `shownInbox`, the plan whose Inbox is on screen, is its own.
 */
export function useInboxToasts(
  view: (planId: string) => void,
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
  // The items said and not yet withdrawn, each by its plan and the version
  // of main's document the window held as the toast arrived.
  const told = useRef(new Map<string, { planId: string; heard: number }>());
  useEffect(
    () =>
      window.luke.onInboxItemOpened(({ planId, itemId, words, detail }) => {
        told.current.set(itemId, { planId, heard: appStateNow()?.version ?? -1 });
        toast({
          words,
          detail,
          waits: true,
          persists: true,
          subject: itemId,
          tone: TOAST_TONE.ASK,
          action: { label: VIEW_LABEL, onPress: () => viewing.current(planId) },
        });
      }),
    [toast],
  );
  // Note that what waits withdraws a toast only from a version of main's
  // document newer than the one held as the toast arrived, because main
  // writes the item into what waits before it hands the window the toast,
  // so only a word that came after the toast and lacks the item says it no
  // longer waits; an older one may be drawn after the toast was said.
  useEffect(() => {
    const now = new Set(waiting.flatMap((plan) => plan.items.map((item) => item.id)));
    for (const [itemId, { planId, heard }] of told.current) {
      const gone = version > heard && !now.has(itemId);
      if (!gone && planId !== shownInbox) continue;
      withdraw(itemId);
      told.current.delete(itemId);
    }
  }, [waiting, version, shownInbox, withdraw]);
}
