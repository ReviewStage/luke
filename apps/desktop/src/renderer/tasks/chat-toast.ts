/**
 * chat-toast.ts -- says in the window's toast that a chat message came to wait on the developer while the window was focused away from its workspace's Chat, with a View that opens Chat, until that Chat is shown.
 *
 * Main decides which messages the window hears (`@luke/host/agent-notices`):
 * one for each ask, direct message, or mention that comes to wait, and only
 * while the window is focused, the OS's notification saying it while the
 * window is behind. The toast says what the notification would, who and
 * why, the plan's name on its second line, and its View does what the
 * notification's click does. It stands until it is dismissed or Chat is on
 * screen on the workspace the message waits in, where the message itself
 * stands; Chat on another workspace leaves it standing. Several may come in one read,
 * so each waits for room rather than pushing out an earlier one.
 */

import { useEffect, useRef } from "react";
import { appBridge } from "../app-bridge";
import { TOAST_TONE, useToast, useWithdrawToast } from "../toast";

/** What a waiting message's toast offers, to open Chat. */
const VIEW_LABEL = "View";

/** Says each message main hands the window, `view` opening Chat, and withdraws each once its workspace's Chat is on screen. */
export function useChatToasts(view: () => void, shownIn: string | null): void {
  const toast = useToast();
  const withdraw = useWithdrawToast();
  // Read through a ref, because the caller hands a new closure each render
  // and the subscription is owed to the window, not to a render.
  const viewing = useRef(view);
  viewing.current = view;
  // Each message told, by its id, with the workspace whose chat it waits in.
  const told = useRef(new Map<string, string>());
  useEffect(
    () =>
      appBridge().onChatMessageWaiting(({ messageId, workspaceId, words, detail }) => {
        told.current.set(messageId, workspaceId);
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
    if (shownIn === null) return;
    for (const [messageId, workspaceId] of told.current) {
      if (workspaceId !== shownIn) continue;
      withdraw(messageId);
      told.current.delete(messageId);
    }
  }, [shownIn, withdraw]);
}
