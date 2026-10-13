/**
 * act-bridge.ts -- the act channel as a test reads it: what the window sent over `app:act`, each answered done.
 */

import { ACT_OUTCOME_STATUS, type Act, type ActOutcome } from "#shared/messages/acts";

/**
 * Installs the act channel on the window's bridge and answers the acts it
 * sent, in the order sent. Note that the rest of the bridge is kept as it
 * was, because a test may have installed another of its doors first.
 */
export function installActBridge(): Act[] {
  const sent: Act[] = [];
  const before: Partial<Window["sidecar"]> | undefined =
    "sidecar" in window ? window.sidecar : undefined;
  const act = (request: Act): Promise<ActOutcome> => {
    sent.push(request);
    return Promise.resolve({ status: ACT_OUTCOME_STATUS.DONE, value: undefined });
  };
  Object.defineProperty(window, "sidecar", { configurable: true, value: { ...before, act } });
  return sent;
}
