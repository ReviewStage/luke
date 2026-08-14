import type {
  AttentionSpeech,
  NormalizedSession,
  ProviderControlResult,
  ProviderMessageResult,
  RealtimeConnection,
  RealtimeVoice,
  RealtimeVoiceSpeed,
  SessionIdentity,
  TrackedIssue,
  TrackerActionResult,
} from "@sidecar/core";
import { contextBridge, ipcRenderer } from "electron";
import type {
  AppBootstrap,
  AppBridge,
  DisplayDiagnostic,
  IssueActionAsk,
  MicrophoneStatus,
  SessionOpenResult,
  SettingsUpdateResult,
  VoiceHotkeyState,
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
  openMicrophoneSettings: () => ipcRenderer.send(channels.openMicrophoneSettings),
  setProviderApiKey: (providerId: CredentialProviderId, apiKey: string | undefined) =>
    ipcRenderer.invoke(
      channels.setProviderApiKey,
      providerId,
      apiKey,
    ) as Promise<SettingsUpdateResult>,
  setVoice: (voice: RealtimeVoice) =>
    ipcRenderer.invoke(channels.setVoice, voice) as Promise<SettingsUpdateResult>,
  setVoiceSpeed: (speed: RealtimeVoiceSpeed) =>
    ipcRenderer.invoke(channels.setVoiceSpeed, speed) as Promise<SettingsUpdateResult>,
  openProviderApiKeys: (providerId: CredentialProviderId) => {
    ipcRenderer.send(channels.openProviderApiKeys, providerId);
  },
  setShowInMenuBar: (show: boolean) =>
    ipcRenderer.invoke(channels.setShowInMenuBar, show) as Promise<SettingsUpdateResult>,
  setShowInDock: (show: boolean) =>
    ipcRenderer.invoke(channels.setShowInDock, show) as Promise<SettingsUpdateResult>,
  setVoiceCaptions: (enabled: boolean) =>
    ipcRenderer.invoke(channels.setVoiceCaptions, enabled) as Promise<SettingsUpdateResult>,
  setVoiceHotkey: (accelerator: string | undefined) =>
    ipcRenderer.invoke(channels.setVoiceHotkey, accelerator) as Promise<SettingsUpdateResult>,
  openSession: (identity: SessionIdentity) =>
    ipcRenderer.invoke(channels.openSession, identity) as Promise<SessionOpenResult>,
  sendSessionMessage: (identity: SessionIdentity, text: string) =>
    ipcRenderer.invoke(
      channels.sendSessionMessage,
      identity,
      text,
    ) as Promise<ProviderMessageResult>,
  executeSessionControl: (identity: SessionIdentity, controlId: string) =>
    ipcRenderer.invoke(
      channels.executeSessionControl,
      identity,
      controlId,
    ) as Promise<ProviderControlResult>,
  executeIssueAction: (action: IssueActionAsk) =>
    ipcRenderer.invoke(channels.executeIssueAction, action) as Promise<TrackerActionResult>,
  focusPanel: () => ipcRenderer.send(channels.focusPanel),
  requestRealtimeCredential: () =>
    ipcRenderer.invoke(channels.requestRealtimeCredential) as Promise<
      RealtimeConnection | undefined
    >,
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
  onIssuesChanged: (callback: (issues: readonly TrackedIssue[] | undefined) => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      issues: readonly TrackedIssue[] | undefined,
    ) => callback(issues);
    ipcRenderer.on(channels.issuesChanged, listener);
    return () => ipcRenderer.removeListener(channels.issuesChanged, listener);
  },
  onVoiceHotkeyPress: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on(channels.voiceHotkeyPress, listener);
    return () => ipcRenderer.removeListener(channels.voiceHotkeyPress, listener);
  },
  onVoiceHotkeyRelease: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on(channels.voiceHotkeyRelease, listener);
    return () => ipcRenderer.removeListener(channels.voiceHotkeyRelease, listener);
  },
  onVoiceHotkeyChanged: (callback: (state: VoiceHotkeyState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: VoiceHotkeyState) =>
      callback(state);
    ipcRenderer.on(channels.voiceHotkeyChanged, listener);
    return () => ipcRenderer.removeListener(channels.voiceHotkeyChanged, listener);
  },
  onAskHotkeyChanged: (callback: (accelerator: string | undefined) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, accelerator: string | undefined) =>
      callback(accelerator);
    ipcRenderer.on(channels.askHotkeyChanged, listener);
    return () => ipcRenderer.removeListener(channels.askHotkeyChanged, listener);
  },
  onAttentionSpeech: (callback: (speech: readonly AttentionSpeech[]) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, speech: readonly AttentionSpeech[]) =>
      callback(speech);
    ipcRenderer.on(channels.attentionSpeech, listener);
    return () => ipcRenderer.removeListener(channels.attentionSpeech, listener);
  },
};

contextBridge.exposeInMainWorld("sidecar", bridge);
