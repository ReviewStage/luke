import type { IpcMain, IpcMainEvent, IpcMainInvokeEvent } from "electron";
import type { HostedUsageReader } from "../hosted-usage";
import type { PanelManager } from "../panel-manager";
import type { RealtimeCredentialMinter } from "../realtime-minter";
import { channels } from "../shared/contracts";
import { CREDENTIAL_PROVIDERS, isCredentialProviderId } from "../shared/credential-providers";

export interface VoiceRuntimeIpcDependencies {
  ipcMain: Pick<IpcMain, "handle" | "on">;
  trustedSender: (event: IpcMainEvent | IpcMainInvokeEvent) => boolean;
  panels: PanelManager;
  openExternal: (url: string) => Promise<unknown>;
  realtimeCredentials: () => RealtimeCredentialMinter | undefined;
  unavailableDiagnostics: () => ReturnType<RealtimeCredentialMinter["diagnostics"]>;
  hostedUsageReader: () => HostedUsageReader | undefined;
}

export function registerVoiceRuntimeIpc(dependencies: VoiceRuntimeIpcDependencies): void {
  const { ipcMain, trustedSender, panels } = dependencies;
  ipcMain.on(channels.setVoiceExchange, (event, active: unknown) => {
    if (!trustedSender(event) || typeof active !== "boolean") return;
    const displayId = panels.displayIdFor(event.sender);
    if (displayId !== undefined) panels.setVoiceExchange(displayId, active);
  });
  ipcMain.on(channels.openMicrophoneSettings, (event) => {
    if (!trustedSender(event)) return;
    void dependencies.openExternal(
      "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
    );
  });
  ipcMain.on(channels.openProviderApiKeys, (event, providerId: unknown) => {
    if (!trustedSender(event) || !isCredentialProviderId(providerId)) return;
    // A provider connected by consent issues no key and publishes no page to
    // fetch one from, so there is nowhere to send anyone.
    const apiKeysUrl = CREDENTIAL_PROVIDERS[providerId].apiKeysUrl;
    if (apiKeysUrl) void dependencies.openExternal(apiKeysUrl);
  });
  ipcMain.on(channels.focusPanel, (event) => {
    if (!trustedSender(event)) return;
    const displayId = panels.displayIdFor(event.sender);
    if (displayId !== undefined) panels.focusIfExpanded(displayId);
  });
  ipcMain.handle(channels.requestRealtimeCredential, async (event) => {
    if (!trustedSender(event)) throw new Error("Untrusted renderer");
    return dependencies.realtimeCredentials()?.mint();
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
