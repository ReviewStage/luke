import type { PlanMention } from "@luke/features/mention-link";
import { useCallback, useEffect, useRef } from "react";

/**
 * held-link.ts -- a Luke link the system hands the window while sign-in stands, held until the account is signed in.
 *
 * A link can launch the app before anyone is signed in, and the Plans tab
 * opens no plan behind the sign-in gate: its select is refused and the
 * link would be gone. So a link handed while the gate stands is held, the
 * latest one only, and opened the moment the gate gives way; one handed
 * after opens at once.
 */

/** Opens a link's plan now, or once the gate gives way where it stands. */
export function useLinkOpener(
  gated: boolean,
  open: (mention: PlanMention) => void,
): (mention: PlanMention) => void {
  const held = useRef<PlanMention | undefined>(undefined);
  const latestGated = useRef(gated);
  latestGated.current = gated;
  const latestOpen = useRef(open);
  latestOpen.current = open;
  useEffect(() => {
    const waiting = held.current;
    if (gated || waiting === undefined) return;
    held.current = undefined;
    latestOpen.current(waiting);
  }, [gated]);
  return useCallback((mention: PlanMention) => {
    if (latestGated.current) held.current = mention;
    else latestOpen.current(mention);
  }, []);
}
