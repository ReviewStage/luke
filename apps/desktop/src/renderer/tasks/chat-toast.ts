/**
 * chat-toast.ts -- says in the window's toast that a chat message came to wait on the developer while the window was focused away from the Chat it is read in, with a View that opens its workspace's Chat.
 *
 * Main decides which messages the window hears (`@luke/host/agent-notices`):
 * one for each ask, direct message, or mention that comes to wait, and only
 * while the window is focused, the OS's notification saying it while the
 * window is behind. The toast says what the notification would, who and
 * why, the plan's name on its second line, and its View does what the
 * notification's click does. It stands as an opened inbox item's does,
 * leaving by itself, and goes at once where the Chat the message is read in
 * comes on screen: its workspace's Chat, or its task's Chat tab where it
 * waits in the plan's channel. Chat elsewhere leaves it standing. Several
 * may come in one read, so each waits for room rather than pushing out an
 * earlier one.
 */

import type { ChatShown } from "@luke/host/acts";
import { useEffect, useRef } from "react";
import { appBridge } from "../app-bridge";
import { TOAST_HOLD, TOAST_TONE, useToast, useWithdrawToast } from "../toast";

/** What a waiting message's toast offers, to open Chat. */
const VIEW_LABEL = "View";

/**
 * How many told messages are kept to withdraw. Note that the oldest is let
 * go past it, because a toast leaves by itself and the stack says nothing
 * when, so a long-lived window would otherwise keep every message it was
 * ever told; one let go long ago has left, and one that has not, three
 * standing and the rest waiting their turn, still leaves on its own hold.
 */
const TOLD_BOUND = 100;

/** Where a message waits: its workspace, and its plan where it waits in a plan's channel. */
interface WaitsIn {
  readonly workspaceId: string;
  readonly planId: string | null;
}

/** Says each message main hands the window, `view` opening its workspace's Chat, and withdraws each once the Chat it is read in is on screen. */
export function useChatToasts(view: (workspaceId: string) => void, shown: ChatShown | null): void {
  const toast = useToast();
  const withdraw = useWithdrawToast();
  // Read through a ref, because the caller hands a new closure each render
  // and the subscription is owed to the window, not to a render.
  const viewing = useRef(view);
  viewing.current = view;
  // Each message told, by its id, with where it waits.
  const told = useRef(new Map<string, WaitsIn>());
  useEffect(
    () =>
      appBridge().onChatMessageWaiting(
        ({ messageId, workspaceId, planId: taskId, words, detail }) => {
          told.current.set(messageId, { workspaceId, planId: taskId });
          const oldest = told.current.keys().next().value;
          if (told.current.size > TOLD_BOUND && oldest !== undefined) told.current.delete(oldest);
          toast({
            words,
            detail,
            waits: true,
            hold: TOAST_HOLD.NEWS,
            subject: messageId,
            tone: TOAST_TONE.ASK,
            action: { label: VIEW_LABEL, onPress: () => viewing.current(workspaceId) },
          });
        },
      ),
    [toast],
  );
  const shownWorkspace = shown?.workspaceId;
  const shownTask = shown?.planId ?? null;
  useEffect(() => {
    if (shownWorkspace === undefined) return;
    for (const [messageId, waits] of told.current) {
      if (waits.workspaceId !== shownWorkspace) continue;
      if (shownTask !== null && waits.planId !== shownTask) continue;
      withdraw(messageId);
      told.current.delete(messageId);
    }
  }, [shownWorkspace, shownTask, withdraw]);
}
