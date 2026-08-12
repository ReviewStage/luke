import type { NormalizedSession } from "@sidecar/core";
import { contextBridge, ipcRenderer } from "electron";
import type {
  AppBootstrap,
  AppBridge,
  DisplayDiagnostic,
  MicrophoneStatus,
  SettingsUpdateResult,
  WindowMode,
} from "./shared/contracts";
import { channels } from "./shared/contracts";
import type { CredentialProviderId } from "./shared/credential-providers";

const bridge: AppBridge = {
  getBootstrap: () => ipcRenderer.invoke(channels.bootstrap) as Promise<AppBootstrap>,
  setExpanded: (expanded: boolean, focus = false) =>
    ipcRenderer.invoke(channels.setExpanded, expanded, focus) as Promise<WindowMode>,
  setPointerInterception: (interceptsPointer: boolean) => {
    ipcRenderer.send(channels.setPointerInterception, interceptsPointer);
  },
  requestMicrophone: () =>
    ipcRenderer.invoke(channels.requestMicrophone) as Promise<MicrophoneStatus>,
  setProviderApiKey: (providerId: CredentialProviderId, apiKey: string | undefined) =>
    ipcRenderer.invoke(
      channels.setProviderApiKey,
      providerId,
      apiKey,
    ) as Promise<SettingsUpdateResult>,
  openProviderApiKeys: (providerId: CredentialProviderId) => {
    ipcRenderer.send(channels.openProviderApiKeys, providerId);
  },
  focusPanel: () => ipcRenderer.send(channels.focusPanel),
  notifyReady: () => ipcRenderer.send(channels.rendererReady),
  quit: () => ipcRenderer.send(channels.quit),
  onLifecycle: (callback: (eventName: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, eventName: string) => callback(eventName);
    ipcRenderer.on(channels.lifecycle, listener);
    return () => ipcRenderer.removeListener(channels.lifecycle, listener);
  },
  onDisplayChanged: (callback: (display: DisplayDiagnostic) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, display: DisplayDiagnostic) =>
      callback(display);
    ipcRenderer.on(channels.displayChanged, listener);
    return () => ipcRenderer.removeListener(channels.displayChanged, listener);
  },
  onSessionsChanged: (callback: (sessions: readonly NormalizedSession[]) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, sessions: readonly NormalizedSession[]) =>
      callback(sessions);
    ipcRenderer.on(channels.sessionsChanged, listener);
    return () => ipcRenderer.removeListener(channels.sessionsChanged, listener);
  },
};

contextBridge.exposeInMainWorld("sidecar", bridge);
