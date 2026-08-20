import { PRODUCT_EVENT, type RecordProductEvent } from "@sidecar/analytics";
import {
  CREDENTIAL_CONNECTION,
  CREDENTIAL_PROVIDERS,
  isCredentialProviderId,
} from "@sidecar/credentials";
import type { VoiceSource } from "@sidecar/settings";
import type { HostedUsageReader, RealtimeCredentialMinter } from "@sidecar/voice";
import type { UnparsedWireValue } from "@sidecar/wire";
import type { IpcMain, IpcMainEvent, IpcMainInvokeEvent } from "electron";
import { channels } from "#shared/contracts";
import { VOICE_SOURCE_COUNTED_AS } from "#shared/product-vocabulary";
import type { PanelManager } from "../window/panel-manager";

export interface VoiceRuntimeIpcDependencies {
  ipcMain: Pick<IpcMain, "handle" | "on">;
  trustedSender: (event: IpcMainEvent | IpcMainInvokeEvent) => boolean;
  panels: PanelManager;
  openExternal: (url: string) => Promise<void>;
  realtimeCredentials: () => RealtimeCredentialMinter | undefined;
  unavailableDiagnostics: () => ReturnType<RealtimeCredentialMinter["diagnostics"]>;
  hostedUsageReader: () => HostedUsageReader | undefined;
  /** Which credential the voice would run on, as the last applied policy decided. */
  voiceSource: () => VoiceSource;
  recordProductEvent: RecordProductEvent;
}

export function registerVoiceRuntimeIpc(dependencies: VoiceRuntimeIpcDependencies): void {
  const { ipcMain, trustedSender, panels } = dependencies;
  ipcMain.on(channels.setVoiceExchange, (event, active: UnparsedWireValue) => {
    if (!trustedSender(event) || (active !== true && active !== false)) return;
    const displayId = panels.displayIdFor(event.sender);
    if (displayId !== undefined) panels.setVoiceExchange(displayId, active);
  });
  ipcMain.on(channels.openMicrophoneSettings, (event) => {
    if (!trustedSender(event)) return;
    void dependencies.openExternal(
      "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
    );
  });
  ipcMain.on(channels.openProviderApiKeys, (event, providerId: UnparsedWireValue) => {
    if (!trustedSender(event) || !isCredentialProviderId(providerId)) return;
    // A provider connected by consent issues no key and publishes no page to
    // fetch one from, so there is nowhere to send anyone.
    const provider = CREDENTIAL_PROVIDERS[providerId];
    if (provider.connection !== CREDENTIAL_CONNECTION.KEY || !provider.apiKeysUrl) return;
    void dependencies.openExternal(provider.apiKeysUrl);
  });
  ipcMain.on(channels.focusPanel, (event) => {
    if (!trustedSender(event)) return;
    const displayId = panels.displayIdFor(event.sender);
    if (displayId !== undefined) panels.focusIfExpanded(displayId);
  });
  ipcMain.handle(channels.requestRealtimeCredential, async (event) => {
    if (!trustedSender(event)) throw new Error("Untrusted renderer");
    const credential = await dependencies.realtimeCredentials()?.mint();
    // A credential in hand is a call about to open; a refused mint is not one.
    if (credential) {
      dependencies.recordProductEvent(PRODUCT_EVENT.VOICE_CALL_START, {
        credential_source: VOICE_SOURCE_COUNTED_AS[dependencies.voiceSource()],
      });
    }
    return credential;
  });
  ipcMain.handle(channels.requestRealtimeDiagnostics, (event) => {
    if (!trustedSender(event)) throw new Error("Untrusted renderer");
    return (
      dependencies.realtimeCredentials()?.diagnostics() ?? dependencies.unavailableDiagnostics()
    );
  });
  ipcMain.handle(channels.requestHostedUsage, async (event) => {
    if (!trustedSender(event)) throw new Error("Untrusted renderer");
    return dependencies.hostedUsageReader()?.read();
  });
}
