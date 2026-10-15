/**
 * chat-toast.ts -- says in the window's toast that a chat message came to wait on the developer while the window was focused away from its Chat, with a View that opens Chat, until Chat is shown.
 *
 * Main decides which messages the window hears (`main/agent-notices.ts`):
 * one for each ask, direct message, or mention that comes to wait, and only
 * while the window is focused, the OS's notification saying it while the
 * window is behind. The toast says what the notification would, who and
 * why, the plan's name on its second line, and its View does what the
 * notification's click does. It stands until it is dismissed or Chat is on
 * screen, where the message itself stands. Several may come in one read,
 * so each waits for room rather than pushing out an earlier one.
 */

import { useEffect, useRef } from "react";
import { appBridge } from "../app-bridge";
import { TOAST_TONE, useToast, useWithdrawToast } from "../toast";

/** What a waiting message's toast offers, to open Chat. */
const VIEW_LABEL = "View";

/** Says each message main hands the window, `view` opening Chat, and withdraws every one once Chat is on screen. */
export function useChatToasts(view: () => void, chatShown: boolean): void {
  const toast = useToast();
  const withdraw = useWithdrawToast();
  // Read through a ref, because the caller hands a new closure each render
  // and the subscription is owed to the window, not to a render.
  const viewing = useRef(view);
  viewing.current = view;
  const told = useRef(new Set<string>());
  useEffect(
    () =>
      appBridge().onChatMessageWaiting(({ messageId, words, detail }) => {
        told.current.add(messageId);
        toast({
          words,
          detail,
          waits: true,
          persists: true,
          subject: messageId,
          tone: TOAST_TONE.ASK,
          action: { label: VIEW_LABEL, onPress: () => viewing.current() },
        });
      }),
    [toast],
  );
  useEffect(() => {
    if (!chatShown) return;
    for (const messageId of told.current) withdraw(messageId);
    told.current.clear();
  }, [chatShown, withdraw]);
}
