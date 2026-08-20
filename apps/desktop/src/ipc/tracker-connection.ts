import { ISSUE_TRACKER_ID, PRODUCT_EVENT, type RecordProductEvent } from "@sidecar/core";
import { Effect } from "effect";
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
  recordProductEvent: RecordProductEvent;
}

export function registerTrackerConnectionIpc(dependencies: TrackerConnectionIpcDependencies): void {
  const {
    ipcMain,
    trustedSender,
    registerSetting,
    settingsStore,
    credentials,
    signIn,
    refresh,
    recordProductEvent,
  } = dependencies;
  registerSetting(channels.connectLinear, {
    validate() {
      return undefined;
    },
    save: () =>
      Effect.gen(function* () {
        const outcome = yield* signIn.signIn();
        if ("reason" in outcome) {
          return { settings: yield* settingsStore.snapshot(), reason: outcome.reason };
        }
        return yield* settingsStore.setGrant(CREDENTIAL_PROVIDER_ID.LINEAR, outcome);
      }),
    apply(result) {
      if (!result.reason) {
        refresh();
        recordProductEvent(PRODUCT_EVENT.TRACKER_CONNECT, {
          tracker_id: ISSUE_TRACKER_ID.LINEAR,
        });
      }
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
    save: () =>
      credentials.disconnect().pipe(
        Effect.flatMap(() => settingsStore.snapshot()),
        Effect.map((settings) => ({ settings })),
      ),
    apply(result) {
      if (!result.reason) refresh();
    },
    refusal: "Could not disconnect Linear on this system.",
  });
}
