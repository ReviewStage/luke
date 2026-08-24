import { PRODUCT_EVENT, type RecordProductEvent } from "@sidecar/analytics";
import { CREDENTIAL_CONNECTION, CREDENTIAL_PROVIDERS } from "@sidecar/credentials";
import type { VoiceSource } from "@sidecar/settings";
import type { HostedUsageReader, RealtimeCredentialMinter } from "@sidecar/voice";
import type { IpcMain, IpcMainEvent, IpcMainInvokeEvent } from "electron";
import { BRIDGE } from "#shared/bridge";
import { VOICE_SOURCE_COUNTED_AS } from "#shared/product-vocabulary";
import { registerBridge } from "../register-bridge";
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
  const { panels } = dependencies;
  registerBridge(
    BRIDGE,
    {
      setVoiceExchangeActive(active, context) {
        const displayId = panels.displayIdFor(context.sender);
        if (displayId !== undefined) panels.setVoiceExchange(displayId, active);
        if (active) dependencies.recordProductEvent(PRODUCT_EVENT.VOICE_EXCHANGE, {});
      },
      openMicrophoneSettings: () =>
        dependencies.openExternal(
          "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
        ),
      openProviderApiKeys(providerId) {
        const provider = CREDENTIAL_PROVIDERS[providerId];
        if (provider.connection !== CREDENTIAL_CONNECTION.KEY || !provider.apiKeysUrl) return;
        void dependencies.openExternal(provider.apiKeysUrl);
      },
      focusPanel(context) {
        const displayId = panels.displayIdFor(context.sender);
        if (displayId !== undefined) panels.focusIfExpanded(displayId);
      },
      async requestRealtimeCredential() {
        const credential = await dependencies.realtimeCredentials()?.mint();
        if (credential) {
          dependencies.recordProductEvent(PRODUCT_EVENT.VOICE_CALL_START, {
            credential_source: VOICE_SOURCE_COUNTED_AS[dependencies.voiceSource()],
          });
        }
        return credential;
      },
      requestRealtimeDiagnostics: () =>
        dependencies.realtimeCredentials()?.diagnostics() ?? dependencies.unavailableDiagnostics(),
      requestHostedUsage: () => dependencies.hostedUsageReader()?.read(),
    },
    { ipcMain: dependencies.ipcMain, trustedSender: dependencies.trustedSender },
  );
}
