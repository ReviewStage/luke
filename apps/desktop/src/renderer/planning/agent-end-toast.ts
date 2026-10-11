/**
 * agent-end-toast.ts -- says in the window's toast that a coding agent's turn ended while the window was focused elsewhere in it, with a View that opens the agent.
 *
 * Main decides which ends the window hears (`main/agent-notices.ts`): one
 * for each turn, and only while the window is focused, the OS's
 * notification saying it while the window is behind. The toast says what
 * the notification would, but the plan's name, and its View does what the
 * notification's click does.
 */

import { useEffect, useRef } from "react";
import { TOAST_TONE, useToast } from "../toast";

/** What an agent's end offers, to open the agent it was. */
const VIEW_LABEL = "View";

/** Says each agent's end main hands the window, `view` opening the plan on that agent's tab. */
export function useAgentEndToasts(view: (planId: string, agentId: string) => void): void {
  const toast = useToast();
  // Read through a ref, because the caller hands a new closure each render
  // and the subscription is owed to the window, not to a render.
  const viewing = useRef(view);
  viewing.current = view;
  useEffect(
    () =>
      window.sidecar.onAgentEnded(({ planId, agentId, words, failed }) =>
        toast({
          words,
          tone: failed ? TOAST_TONE.FAILED : TOAST_TONE.DONE,
          action: { label: VIEW_LABEL, onPress: () => viewing.current(planId, agentId) },
        }),
      ),
    [toast],
  );
}
