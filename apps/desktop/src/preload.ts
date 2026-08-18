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
  cancelSignIn: invoke(channels.cancelSignIn),
  signOut: invoke(channels.signOut),
  deleteAccount: invoke(channels.deleteAccount),
  setExpanded: invoke(channels.setExpanded),
  setPointerInterception: (interceptsPointer) => {
    ipcRenderer.send(channels.setPointerInterception, interceptsPointer);
  },
  requestMicrophone: invoke(channels.requestMicrophone),
  getMicrophoneRoute: invoke(channels.microphoneRoute),
  openMicrophoneSettings: () => ipcRenderer.send(channels.openMicrophoneSettings),
  setProviderApiKey: invoke(channels.setProviderApiKey),
  updateSetting: invoke(channels.updateSetting),
  updateSettingEntry: invoke(channels.updateSettingEntry),
  openProviderApiKeys: (providerId) => {
    ipcRenderer.send(channels.openProviderApiKeys, providerId);
  },
  resetSettings: invoke(channels.resetSettings),
  connectGoogleCalendar: invoke(channels.connectGoogleCalendar),
  cancelGoogleCalendarSignIn: () => {
    ipcRenderer.send(channels.cancelGoogleCalendarSignIn);
  },
  reopenGoogleCalendarSignIn: () => {
    ipcRenderer.send(channels.reopenGoogleCalendarSignIn);
  },
  removeCalendarAccount: invoke(channels.removeCalendarAccount),
  setCalendarSelected: invoke(channels.setCalendarSelected),
  connectLinear: invoke(channels.connectLinear),
  cancelLinearSignIn: () => {
    ipcRenderer.send(channels.cancelLinearSignIn);
  },
  reopenLinearSignIn: () => {
    ipcRenderer.send(channels.reopenLinearSignIn);
  },
  disconnectLinear: invoke(channels.disconnectLinear),
  checkForUpdates: invoke(channels.checkForUpdates),
  openLatestRelease: () => ipcRenderer.send(channels.openLatestRelease),
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
  openIssue: invoke(channels.openIssue),
  sendFeedback: invoke(channels.sendFeedback),
  summonFeedback: invoke(channels.summonFeedback),
  focusPanel: () => ipcRenderer.send(channels.focusPanel),
  requestRealtimeCredential: invoke(channels.requestRealtimeCredential),
  requestRealtimeDiagnostics: invoke(channels.requestRealtimeDiagnostics),
  requestHostedUsage: invoke(channels.requestHostedUsage),
  notifyReady: () => ipcRenderer.send(channels.rendererReady),
  quit: () => ipcRenderer.send(channels.quit),
  onLifecycle: subscribe(channels.lifecycle),
  onDisplayChanged: subscribe(channels.displayChanged),
  onSettingsChanged: subscribe(channels.settingsChanged),
  onAccountChanged: subscribe(channels.accountChanged),
  onUpdateChanged: subscribe(channels.updateChanged),
  onSessionsChanged: subscribe(channels.sessionsChanged),
  onNoticeAsksChanged: subscribe(channels.noticeAsksChanged),
  onWorkspaceProjectsChanged: subscribe(channels.workspaceProjectsChanged),
  onIssuesChanged: subscribe(channels.issuesChanged),
  onCalendarsChanged: subscribe(channels.calendarsChanged),
  onMeetingQuietChanged: subscribe(channels.meetingQuietChanged),
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
