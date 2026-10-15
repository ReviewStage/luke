import { useCallback, useEffect, useRef } from "react";

/**
 * held-link.ts -- a Luke link the system hands the window while sign-in stands, held until the account is signed in.
 *
 * A link can launch the app before anyone is signed in, and the Plans tab
 * opens nothing behind the sign-in gate: its select is refused and the
 * link would be gone. So a link handed while the gate stands is held, the
 * latest one only, and opened the moment the gate gives way; one handed
 * after opens at once, and supersedes any still held.
 */

/** Opens a link's place now, or once the gate gives way where it stands. */
export function useLinkOpener<Link>(
  gated: boolean,
  open: (link: Link) => void,
): (link: Link) => void {
  const held = useRef<Link | undefined>(undefined);
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
  return useCallback((link: Link) => {
    if (latestGated.current) {
      held.current = link;
      return;
    }
    // Note that a link opened at once supersedes one still held, because the gate's giving way opens the held one only once its effect runs.
    held.current = undefined;
    latestOpen.current(link);
  }, []);
}
