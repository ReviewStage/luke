/**
 * agent-end-toast.ts -- says in the window's toast that a coding agent's turn ended while the window was focused elsewhere in it, with a View that opens the agent, for the news's hold or until that agent is seen.
 *
 * Main decides which ends the window hears (`@luke/host/agent-notices`): one
 * for each turn, and only while the window is focused, the OS's
 * notification saying it while the window is behind. The toast says what
 * the notification would, the plan's name on its second line, or the
 * automation's for an agent with no plan, and its View does what the
 * notification's click does: the plan on the agent's tab, or the agent's own
 * page. It stands for the news's hold and leaves by itself, since the
 * agent's unseen dot goes on saying it, and goes sooner with that dot: once
 * the agent's tab is shown, by any route, the toast has nothing left to
 * say. Several
 * agents may end in one read, so each end waits for room rather than
 * pushing out an earlier one, whose View would go with it.
 */

import { useEffect, useRef } from "react";
import { appBridge } from "../app-bridge";
import { TOAST_HOLD, TOAST_TONE, useToast, useWithdrawToast } from "../toast";

/** What an agent's end offers, to open the agent it was. */
const VIEW_LABEL = "View";

/** Where an agent stands to be opened: its plan, on its tab, or its own page where it has no plan. */
export interface AgentPlace {
  readonly taskId: string | null;
  readonly agentId: string;
}

/**
 * Says each agent's end main hands the window, `view` opening where that
 * agent stands, and withdraws it as the agent leaves `unseen`, the agents
 * main says ended unseen.
 */
export function useAgentEndToasts(
  view: (place: AgentPlace) => void,
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
      appBridge().onAgentEnded(({ taskId, agentId, words, detail, failed }) =>
        toast({
          words,
          detail,
          waits: true,
          hold: TOAST_HOLD.NEWS,
          subject: agentId,
          tone: failed ? TOAST_TONE.FAILED : TOAST_TONE.DONE,
          action: { label: VIEW_LABEL, onPress: () => viewing.current({ taskId, agentId }) },
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
