/**
 * agent-end-toast.ts -- says in the window's toast that a coding agent's turn ended while the window was focused elsewhere in it, with a View that opens the agent, until that agent is seen.
 *
 * Main decides which ends the window hears (`main/agent-notices.ts`): one
 * for each turn, and only while the window is focused, the OS's
 * notification saying it while the window is behind. The toast says what
 * the notification would, the plan's name on its second line, and its View
 * does what the notification's click does. It stands until it is dismissed,
 * as the agent's unseen dot does, and goes with that dot: once the agent's
 * tab is shown, by any route, the toast has nothing left to say. Several
 * agents may end in one read, so each end waits for room rather than
 * pushing out an earlier one, whose View would go with it.
 */

import { useEffect, useRef } from "react";
import { TOAST_TONE, useToast, useWithdrawToast } from "../toast";

/** What an agent's end offers, to open the agent it was. */
const VIEW_LABEL = "View";

/**
 * Says each agent's end main hands the window, `view` opening the plan on
 * that agent's tab, and withdraws it as the agent leaves `unseen`, the
 * agents main says ended unseen.
 */
export function useAgentEndToasts(
  view: (planId: string, agentId: string) => void,
  unseen: readonly string[],
): void {
  const toast = useToast();
  const withdraw = useWithdrawToast();
  // Read through a ref, because the caller hands a new closure each render
  // and the subscription is owed to the window, not to a render.
  const viewing = useRef(view);
  viewing.current = view;
  useEffect(
    () =>
      window.sidecar.onAgentEnded(({ planId, agentId, words, detail, failed }) =>
        toast({
          words,
          detail,
          waits: true,
          persists: true,
          subject: agentId,
          tone: failed ? TOAST_TONE.FAILED : TOAST_TONE.DONE,
          action: { label: VIEW_LABEL, onPress: () => viewing.current(planId, agentId) },
        }),
      ),
    [toast],
  );
  // Note that only an agent seen to leave the list is withdrawn, because the
  // list may reach the window after the end it dots does.
  const dotted = useRef(unseen);
  useEffect(() => {
    for (const agentId of dotted.current) if (!unseen.includes(agentId)) withdraw(agentId);
    dotted.current = unseen;
  }, [unseen, withdraw]);
}
