import { PRODUCT_EVENT, type RecordProductEvent } from "@sidecar/analytics";
import { CREDENTIAL_PROVIDER_ID } from "@sidecar/credentials";
import { ISSUE_TRACKER_ID } from "@sidecar/issues";
import type { LinearCredentials, LinearSignIn } from "@sidecar/trackers";
import type { IpcMain, IpcMainEvent, IpcMainInvokeEvent } from "electron";
import { BRIDGE } from "#shared/bridge";
import { registerBridge } from "../register-bridge";
import type { createSettingsHandler } from "../settings-handler";
import type { SettingsStore } from "../settings-store";

export interface TrackerConnectionIpcDependencies {
  ipcMain: Pick<IpcMain, "handle" | "on">;
  trustedSender: (event: IpcMainEvent | IpcMainInvokeEvent) => boolean;
  registerSetting: ReturnType<typeof createSettingsHandler>;
  settingsStore: SettingsStore;
  credentials: LinearCredentials;
  signIn: LinearSignIn;
  refresh: () => void;
  recordProductEvent: RecordProductEvent;
}

export function registerTrackerConnectionIpc(dependencies: TrackerConnectionIpcDependencies): void {
  const { registerSetting, settingsStore, credentials, signIn, refresh, recordProductEvent } =
    dependencies;
  // The Linear sign-in runs whole inside `save`, exactly as the calendar's
  // does: the browser trip, the loopback redirect and the exchange all happen
  // in the main process, and the renderer's reply is the settings snapshot
  // alone. A refusal or a closed browser tab comes back as the reason the row
  // shows.
  registerSetting(BRIDGE.connectLinear, {
    validate() {
      return undefined;
    },
    async save() {
      const outcome = await signIn.signIn();
      if ("reason" in outcome) {
        return { settings: await settingsStore.snapshot(), reason: outcome.reason };
      }
      return settingsStore.setGrant(CREDENTIAL_PROVIDER_ID.LINEAR, outcome);
    },
    apply(result) {
      // The board is a minute stale at worst, but a row that just connected
      // and shows nothing reads as a connection that failed.
      if (!result.reason) {
        refresh();
        recordProductEvent(PRODUCT_EVENT.TRACKER_CONNECT, {
          tracker_id: ISSUE_TRACKER_ID.LINEAR,
        });
      }
    },
    refusal: "Could not connect Linear on this system.",
  });

  registerBridge(
    BRIDGE,
    {
      cancelLinearSignIn: signIn.cancel.bind(signIn),
      reopenLinearSignIn: signIn.reopen.bind(signIn),
    },
    { ipcMain: dependencies.ipcMain, trustedSender: dependencies.trustedSender },
  );

  registerSetting(BRIDGE.disconnectLinear, {
    validate() {
      return undefined;
    },
    async save() {
      // Revoked with Linear as well as forgotten here, so disconnecting ends
      // the access rather than only losing sight of it.
      await credentials.disconnect();
      return { settings: await settingsStore.snapshot() };
    },
    apply(result) {
      // The roster is about a board Luke can no longer read, so it goes with
      // the grant rather than sitting there until the next pass.
      if (!result.reason) {
        refresh();
        recordProductEvent(PRODUCT_EVENT.TRACKER_DISCONNECT, {
          tracker_id: ISSUE_TRACKER_ID.LINEAR,
        });
      }
    },
    refusal: "Could not disconnect Linear on this system.",
  });
}
