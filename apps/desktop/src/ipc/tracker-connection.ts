import type { IpcMain, IpcMainEvent, IpcMainInvokeEvent } from "electron";
import type { LinearCredentials } from "../linear-credentials";
import type { LinearSignIn } from "../linear-oauth";
import type { createSettingsHandler } from "../settings-handler";
import type { SettingsStore } from "../settings-store";
import { channels } from "../shared/contracts";
import { CREDENTIAL_PROVIDER_ID } from "../shared/credential-providers";

export interface TrackerConnectionIpcDependencies {
  ipcMain: Pick<IpcMain, "on">;
  trustedSender: (event: IpcMainEvent | IpcMainInvokeEvent) => boolean;
  registerSetting: ReturnType<typeof createSettingsHandler>;
  settingsStore: SettingsStore;
  credentials: LinearCredentials;
  signIn: LinearSignIn;
  refresh: () => void;
}

export function registerTrackerConnectionIpc(dependencies: TrackerConnectionIpcDependencies): void {
  const { ipcMain, trustedSender, registerSetting, settingsStore, credentials, signIn, refresh } =
    dependencies;
  // The Linear sign-in runs whole inside `save`, exactly as the calendar's
  // does: the browser trip, the loopback redirect and the exchange all happen
  // in the main process, and the renderer's reply is the settings snapshot
  // alone. A refusal or a closed browser tab comes back as the reason the row
  // shows.
  registerSetting(channels.connectLinear, {
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
      if (!result.reason) refresh();
    },
    refusal: "Could not connect Linear on this system.",
  });

  ipcMain.on(channels.cancelLinearSignIn, (event) => {
    if (trustedSender(event)) signIn.cancel();
  });

  ipcMain.on(channels.reopenLinearSignIn, (event) => {
    if (trustedSender(event)) signIn.reopen();
  });

  registerSetting(channels.disconnectLinear, {
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
      if (!result.reason) refresh();
    },
    refusal: "Could not disconnect Linear on this system.",
  });
}
