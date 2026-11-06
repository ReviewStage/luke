import { useCallback, useEffect, useRef } from "react";

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
    held.current = undefined;
    latestOpen.current(link);
  }, []);
}
