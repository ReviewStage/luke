import { contextBridge, ipcRenderer } from "electron";
import { type AppBridge, channels } from "./shared/contracts";

function invoke<T>(channel: string) {
  return (...args: unknown[]) => ipcRenderer.invoke(channel, ...args) as Promise<T>;
}

function subscribe<T>(channel: string) {
  return (callback: (payload: T) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: T) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  };
}

const bridge: AppBridge = {
  getBootstrap: invoke(channels.bootstrap),
  beginSignIn: invoke(channels.beginSignIn),
  signOut: invoke(channels.signOut),
  setExpanded: invoke(channels.setExpanded),
  setPointerInterception: (interceptsPointer) => {
    ipcRenderer.send(channels.setPointerInterception, interceptsPointer);
  },
  requestMicrophone: invoke(channels.requestMicrophone),
  openMicrophoneSettings: () => ipcRenderer.send(channels.openMicrophoneSettings),
  setProviderApiKey: invoke(channels.setProviderApiKey),
  setVoice: invoke(channels.setVoice),
  setVoiceSpeed: invoke(channels.setVoiceSpeed),
  openProviderApiKeys: (providerId) => {
    ipcRenderer.send(channels.openProviderApiKeys, providerId);
  },
  setShowInMenuBar: invoke(channels.setShowInMenuBar),
  setShowInDock: invoke(channels.setShowInDock),
  setShowOnAllDisplays: invoke(channels.setShowOnAllDisplays),
  setFormFactor: invoke(channels.setFormFactor),
  setDefaultWorkspaceProvider: invoke(channels.setDefaultWorkspaceProvider),
  setWorkspaceAgentDefault: invoke(channels.setWorkspaceAgentDefault),
  setWorkspaceProjectDefault: invoke(channels.setWorkspaceProjectDefault),
  setVoiceCaptions: invoke(channels.setVoiceCaptions),
  setVoiceHotkey: invoke(channels.setVoiceHotkey),
  setAskHotkey: invoke(channels.setAskHotkey),
  setStopHotkey: invoke(channels.setStopHotkey),
  setDuckOtherMedia: invoke(channels.setDuckOtherMedia),
  setVoiceExchangeActive: (active) => {
    ipcRenderer.send(channels.setVoiceExchange, active);
  },
  openSession: invoke(channels.openSession),
  openSessionChange: invoke(channels.openSessionChange),
  readSessionTranscript: invoke(channels.readSessionTranscript),
  sendSessionMessage: invoke(channels.sendSessionMessage),
  executeSessionControl: invoke(channels.executeSessionControl),
  requestSessionNotice: invoke(channels.requestSessionNotice),
  withdrawSessionNotice: invoke(channels.withdrawSessionNotice),
  createSessionWorkspace: invoke(channels.createSessionWorkspace),
  addWorkspaceAgent: invoke(channels.addWorkspaceAgent),
  executeIssueAction: invoke(channels.executeIssueAction),
  sendFeedback: invoke(channels.sendFeedback),
  summonFeedback: invoke(channels.summonFeedback),
  focusPanel: () => ipcRenderer.send(channels.focusPanel),
  requestRealtimeCredential: invoke(channels.requestRealtimeCredential),
  notifyReady: () => ipcRenderer.send(channels.rendererReady),
  quit: () => ipcRenderer.send(channels.quit),
  onLifecycle: subscribe(channels.lifecycle),
  onDisplayChanged: subscribe(channels.displayChanged),
  onSettingsChanged: subscribe(channels.settingsChanged),
  onAccountChanged: subscribe(channels.accountChanged),
  onSessionsChanged: subscribe(channels.sessionsChanged),
  onNoticeAsksChanged: subscribe(channels.noticeAsksChanged),
  onWorkspaceProjectsChanged: subscribe(channels.workspaceProjectsChanged),
  onIssuesChanged: subscribe(channels.issuesChanged),
  onVoiceHotkeyPress: subscribe(channels.voiceHotkeyPress),
  onVoiceHotkeyRelease: subscribe(channels.voiceHotkeyRelease),
  onVoiceHotkeyChanged: subscribe(channels.voiceHotkeyChanged),
  onAskHotkeyChanged: subscribe(channels.askHotkeyChanged),
  onStopHotkeyPress: subscribe(channels.stopHotkeyPress),
  onStopHotkeyChanged: subscribe(channels.stopHotkeyChanged),
  onOutputAudioChanged: subscribe(channels.outputAudioChanged),
  onAttentionSpeech: subscribe(channels.attentionSpeech),
};

contextBridge.exposeInMainWorld("sidecar", bridge);
