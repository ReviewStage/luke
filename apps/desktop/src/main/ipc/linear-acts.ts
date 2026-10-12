import type { LinearConnectView, LinearStatusView } from "@sidecar/hosted/linear-view";
import type { Effect } from "effect";
import { ACT, ACT_KIND } from "#shared/messages/acts";
import { ActRefused, type ActRows, type ActSender } from "../act-router";

/**
 * linear-acts.ts -- Settings' Linear row: the panel's asks of the host about the account's Linear connection.
 *
 * The one check this process makes is who asked: only a panel draws
 * Settings, so every row refuses the takeover and the hidden voice window.
 * What the service answers comes back as the panel's own answer; a Connect
 * answers whether the host sent the browser to sign in, and the address it
 * sent it to never crosses into a window. Nothing is held here.
 */
export interface LinearActsDependencies {
  host: {
    linearStatus(): Effect.Effect<LinearStatusView>;
    linearConnect(): Effect.Effect<LinearConnectView>;
    linearDisconnect(): Effect.Effect<LinearStatusView>;
  };
}

type LinearActKind =
  | typeof ACT_KIND.LINEAR_STATUS
  | typeof ACT_KIND.LINEAR_CONNECT
  | typeof ACT_KIND.LINEAR_DISCONNECT;

/** The refusal a window that draws no Settings hears, in its kind's own words. */
function refuseUnlessPanel(kind: LinearActKind, sender: ActSender): void {
  if (!sender.panel) throw new ActRefused({ message: ACT[kind].refusal });
}

export function linearActRows(dependencies: LinearActsDependencies): Pick<ActRows, LinearActKind> {
  const { host } = dependencies;
  return {
    [ACT_KIND.LINEAR_STATUS]: (_payload, sender) => {
      refuseUnlessPanel(ACT_KIND.LINEAR_STATUS, sender);
      return host.linearStatus();
    },
    [ACT_KIND.LINEAR_CONNECT]: (_payload, sender) => {
      refuseUnlessPanel(ACT_KIND.LINEAR_CONNECT, sender);
      return host.linearConnect();
    },
    [ACT_KIND.LINEAR_DISCONNECT]: (_payload, sender) => {
      refuseUnlessPanel(ACT_KIND.LINEAR_DISCONNECT, sender);
      return host.linearDisconnect();
    },
  };
}
