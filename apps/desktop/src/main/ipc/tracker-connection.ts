import type { IpcMain, IpcMainEvent, IpcMainInvokeEvent } from "electron";
import { BRIDGE } from "#shared/bridge";
import type { HostOperator } from "../gateway/host-operator";
import { type BridgeContext, registerBridge } from "../register-bridge";
import type { createSettingsHandler } from "../settings-handler";

/**
 * The Linear rows, proxied to the host that owns the grant: the consent
 * flow, the loopback redirect, the exchange, the renewal, and the revocation
 * all run there, and the renderer's reply is the settings snapshot alone.
 */
export interface TrackerConnectionIpcDependencies {
  ipcMain: Pick<IpcMain, "handle" | "on">;
  trustedSender: (event: IpcMainEvent | IpcMainInvokeEvent) => boolean;
  registerSetting: ReturnType<typeof createSettingsHandler>;
  host: HostOperator;
  reporterOf: (context: BridgeContext) => string;
}

export function registerTrackerConnectionIpc(dependencies: TrackerConnectionIpcDependencies): void {
  const { registerSetting, host, reporterOf } = dependencies;
  registerSetting(BRIDGE.connectLinear, {
    validate() {
      return undefined;
    },
    save: (_value, context) => host.connectLinear(reporterOf(context)),
    refusal: "Could not connect Linear on this system.",
  });
  registerBridge(
    BRIDGE,
    {
      cancelLinearSignIn: () => host.cancelLinearSignIn(),
      reopenLinearSignIn: () => host.reopenLinearSignIn(),
    },
    { ipcMain: dependencies.ipcMain, trustedSender: dependencies.trustedSender },
  );
  registerSetting(BRIDGE.disconnectLinear, {
    validate() {
      return undefined;
    },
    save: (_value, context) => host.disconnectLinear(reporterOf(context)),
    refusal: "Could not disconnect Linear on this system.",
  });
}
