import type { AutomationFollow, AutomationFollowed } from "@luke/features/automation-view";
import { ACT_KIND } from "@luke/host/acts";
import { useEffect, useRef } from "react";
import { useAct } from "../act";

/**
 * use-followed-automations.ts -- a workspace's automations, or an automation's runs, followed for as long as the page drawing them stands.
 *
 * The page asks the host to follow what it draws and to let it go when it
 * stops; the host pushes it to this window each time it moves (over Neon
 * Realtime where the service seals it, read each minute where it does not),
 * and each push of what this page follows is handed to `take`. Nothing is
 * read here, and nothing on a clock.
 */
export function useFollowedAutomations(
  scope: AutomationFollow | undefined,
  take: (changed: AutomationFollowed) => void,
): void {
  const { act } = useAct();
  // Note that the newest `take` is called, so a page need not hold it still for the follow to stand.
  const taker = useRef(take);
  taker.current = take;
  const kind = scope?.kind;
  const id = scope?.id;
  useEffect(() => {
    if (kind === undefined || id === undefined) return;
    const followed: AutomationFollow = { kind, id };
    const unsubscribe = window.luke.onAutomations((changed) => {
      if (changed.scope.kind === kind && changed.scope.id === id) taker.current(changed);
    });
    act(ACT_KIND.AUTOMATIONS_FOLLOW, followed).catch(() => undefined);
    return () => {
      unsubscribe();
      act(ACT_KIND.AUTOMATIONS_UNFOLLOW, followed).catch(() => undefined);
    };
  }, [act, kind, id]);
}
