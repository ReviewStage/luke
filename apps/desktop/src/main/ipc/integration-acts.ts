import type {
  IntegrationAccountView,
  IntegrationConnectView,
  IntegrationProviderParams,
  IntegrationRenameParams,
  IntegrationStatusesView,
  IntegrationStatusView,
  IntegrationToolsView,
} from "@luke/features/integration-view";
import { ACT, ACT_KIND } from "@luke/host/acts";
import type { Effect } from "effect";
import { ActRefused, type ActRows, type ActSender } from "../act-router";

/**
 * integration-acts.ts -- Settings' integration rows: the panel's asks of the host about the account's integrations.
 *
 * The one check this process makes is who asked: only a panel draws
 * Settings, so every row refuses the takeover and the hidden voice window.
 * What the service answers comes back as the panel's own answer; a Connect
 * answers whether the host sent the browser to sign in, and the address it
 * sent it to never crosses into a window. Nothing is held here.
 */
export interface IntegrationActsDependencies {
  host: {
    integrationsStatus(): Effect.Effect<IntegrationStatusesView>;
    integrationsConnect(params: IntegrationProviderParams): Effect.Effect<IntegrationConnectView>;
    integrationsCancel(params: IntegrationProviderParams): Effect.Effect<IntegrationStatusView>;
    integrationsDisconnect(params: IntegrationProviderParams): Effect.Effect<IntegrationStatusView>;
    integrationsTools(params: IntegrationProviderParams): Effect.Effect<IntegrationToolsView>;
    integrationsRename(params: IntegrationRenameParams): Effect.Effect<IntegrationAccountView>;
  };
}

type IntegrationActKind =
  | typeof ACT_KIND.INTEGRATIONS_STATUS
  | typeof ACT_KIND.INTEGRATIONS_CONNECT
  | typeof ACT_KIND.INTEGRATIONS_CANCEL
  | typeof ACT_KIND.INTEGRATIONS_DISCONNECT
  | typeof ACT_KIND.INTEGRATIONS_TOOLS
  | typeof ACT_KIND.INTEGRATIONS_RENAME;

/** The refusal a window that draws no Settings hears, in its kind's own words. */
function refuseUnlessPanel(kind: IntegrationActKind, sender: ActSender): void {
  if (!sender.panel) throw new ActRefused({ message: ACT[kind].refusal });
}

export function integrationActRows(
  dependencies: IntegrationActsDependencies,
): Pick<ActRows, IntegrationActKind> {
  const { host } = dependencies;
  return {
    [ACT_KIND.INTEGRATIONS_STATUS]: (_payload, sender) => {
      refuseUnlessPanel(ACT_KIND.INTEGRATIONS_STATUS, sender);
      return host.integrationsStatus();
    },
    [ACT_KIND.INTEGRATIONS_CONNECT]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.INTEGRATIONS_CONNECT, sender);
      return host.integrationsConnect(params);
    },
    [ACT_KIND.INTEGRATIONS_TOOLS]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.INTEGRATIONS_TOOLS, sender);
      return host.integrationsTools(params);
    },
    [ACT_KIND.INTEGRATIONS_CANCEL]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.INTEGRATIONS_CANCEL, sender);
      return host.integrationsCancel(params);
    },
    [ACT_KIND.INTEGRATIONS_DISCONNECT]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.INTEGRATIONS_DISCONNECT, sender);
      return host.integrationsDisconnect(params);
    },
    [ACT_KIND.INTEGRATIONS_RENAME]: (params, sender) => {
      refuseUnlessPanel(ACT_KIND.INTEGRATIONS_RENAME, sender);
      return host.integrationsRename(params);
    },
  };
}
