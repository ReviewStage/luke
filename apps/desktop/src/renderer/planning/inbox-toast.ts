/**
 * inbox-toast.ts -- says in the window's toast that an inbox item opened while the window was focused away from its plan's Inbox, with a View that opens that Inbox, until the item no longer waits or the Inbox is shown.
 *
 * Main decides which items the window hears (`main/agent-notices.ts`): one
 * for each item that opens, and only while the window is focused, the OS's
 * notification saying it while the window is behind. The toast says what
 * the notification would, the plan's name on its second line, and its View
 * does what the notification's click does. It stands until it is dismissed
 * or has nothing left to ask: once the item stops waiting, answered here
 * or elsewhere or taken back by its agent, or once its plan's Inbox is on
 * screen, where the item itself stands. Several may open in one read, so
 * each waits for room rather than pushing out an earlier one.
 */

import { useEffect, useRef } from "react";
import type { AppInboxPlan } from "#shared/messages/app-state";
import { TOAST_TONE, useToast, useWithdrawToast } from "../toast";

/** What an opened item's toast offers, to open its plan's Inbox. */
const VIEW_LABEL = "View";

/**
 * Says each item main hands the window, `view` opening that plan's Inbox,
 * and withdraws it as it leaves `waiting`, main's word on what waits, or as
 * `shownInbox`, the plan whose Inbox is on screen, comes to hold it.
 */
export function useInboxToasts(
  view: (planId: string) => void,
  waiting: readonly AppInboxPlan[],
  shownInbox: string | null,
): void {
  const toast = useToast();
  const withdraw = useWithdrawToast();
  // Read through a ref, because the caller hands a new closure each render
  // and the subscription is owed to the window, not to a render.
  const viewing = useRef(view);
  viewing.current = view;
  useEffect(
    () =>
      window.sidecar.onInboxItemOpened(({ planId, itemId, words, detail }) =>
        toast({
          words,
          detail,
          waits: true,
          persists: true,
          subject: itemId,
          tone: TOAST_TONE.ASK,
          action: { label: VIEW_LABEL, onPress: () => viewing.current(planId) },
        }),
      ),
    [toast],
  );
  // Note that only an item seen to leave what waits is withdrawn, because
  // what waits may reach the window after the toast for the item does.
  const was = useRef(waiting);
  useEffect(() => {
    const now = new Set(waiting.flatMap((plan) => plan.items));
    for (const plan of was.current) {
      for (const itemId of plan.items) if (!now.has(itemId)) withdraw(itemId);
    }
    was.current = waiting;
    const shown = waiting.find((plan) => plan.planId === shownInbox);
    for (const itemId of shown?.items ?? []) withdraw(itemId);
  }, [waiting, shownInbox, withdraw]);
}
