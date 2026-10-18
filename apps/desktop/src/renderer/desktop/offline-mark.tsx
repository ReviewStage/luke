import { useAppState } from "@luke/panel/use-app-state";
import { WifiOffIcon } from "lucide-react";
import { Tooltip } from "../tooltip";

/**
 * offline-mark.tsx -- the pill that says this Mac is offline, in the sidebar's foot or, while the sidebar is folded or the sign-in stands, in the title bar.
 *
 * Every surface still fails on its own while the network is gone, each as
 * its read could not be done; the pill says once why, where the window keeps
 * its own state, beside a release on its way in (`sidebar-foot.tsx`). It
 * reads the document's `network` slice, which main keeps from the
 * platform's answer, and draws nothing while the Mac is online. It is a
 * status rather than a press, so it is announced as one, and a sidebar too
 * narrow for its word draws its glyph alone and still names it.
 */

/** What the pill's hint says: why reads are failing, and that nothing needs doing. */
const OFFLINE_HINT = "You're offline. Luke will catch up as soon as you reconnect.";

/** Whether main last found the Mac offline: what the pill, and the room the title bar makes for it, answer. */
export function useOffline(): boolean {
  return useAppState()?.network.online === false;
}

/** The offline pill, or nothing while the Mac is online. */
export function OfflineMark(): React.JSX.Element | null {
  if (!useOffline()) return null;
  return (
    <Tooltip label={OFFLINE_HINT}>
      <span className="offline-mark" role="status" aria-label="Offline">
        <WifiOffIcon aria-hidden="true" />
        <span className="offline-mark-word">Offline</span>
      </span>
    </Tooltip>
  );
}
