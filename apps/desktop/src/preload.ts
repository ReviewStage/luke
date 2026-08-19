import { contextBridge, ipcRenderer } from "electron";
import { type AppBridge, channels } from "./shared/contracts";

/** One argument Electron's IPC layer can carry between processes. */
type IpcWireArgument =
  | string
  | number
  | boolean
  | null
  | readonly IpcWireArgument[]
  | { readonly [key: string]: IpcWireArgument };

function invokeMethod<Channel extends keyof AppBridge>(channel: string): AppBridge[Channel] {
  type Method = AppBridge[Channel];
  type MethodArguments = Parameters<Extract<Method, (...args: never) => void>>;
  type MethodResult = ReturnType<Extract<Method, (...args: never) => void>>;

  function method(...args: MethodArguments): MethodResult {
    // SAFETY: Electron serializes structured-clone values; each channel's AppBridge contract names the parameters.
    return ipcRenderer.invoke(channel, ...(args as IpcWireArgument[])) as MethodResult;
  }

  // SAFETY: method implements the AppBridge entry for this channel.
  return method as Method;
}

function subscribe<T>(channel: string) {
  return (callback: (payload: T) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: T) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  };
}

const bridge: AppBridge = {
  getBootstrap: invokeMethod<"getBootstrap">(channels.bootstrap),
  beginSignIn: invokeMethod<"beginSignIn">(channels.beginSignIn),
  cancelSignIn: invokeMethod<"cancelSignIn">(channels.cancelSignIn),
  signOut: invokeMethod<"signOut">(channels.signOut),
  deleteAccount: invokeMethod<"deleteAccount">(channels.deleteAccount),
  setExpanded: invokeMethod<"setExpanded">(channels.setExpanded),
  setPointerInterception: (interceptsPointer) => {
    ipcRenderer.send(channels.setPointerInterception, interceptsPointer);
  },
  requestMicrophone: invokeMethod<"requestMicrophone">(channels.requestMicrophone),
  getMicrophoneRoute: invokeMethod<"getMicrophoneRoute">(channels.microphoneRoute),
  openMicrophoneSettings: () => ipcRenderer.send(channels.openMicrophoneSettings),
  setProviderApiKey: invokeMethod<"setProviderApiKey">(channels.setProviderApiKey),
  updateSetting: invokeMethod<"updateSetting">(channels.updateSetting),
  updateSettingEntry: invokeMethod<"updateSettingEntry">(channels.updateSettingEntry),
  openProviderApiKeys: (providerId) => {
    ipcRenderer.send(channels.openProviderApiKeys, providerId);
  },
  resetSettings: invokeMethod<"resetSettings">(channels.resetSettings),
  connectGoogleCalendar: invokeMethod<"connectGoogleCalendar">(channels.connectGoogleCalendar),
  cancelGoogleCalendarSignIn: () => {
    ipcRenderer.send(channels.cancelGoogleCalendarSignIn);
  },
  reopenGoogleCalendarSignIn: () => {
    ipcRenderer.send(channels.reopenGoogleCalendarSignIn);
  },
  removeCalendarAccount: invokeMethod<"removeCalendarAccount">(channels.removeCalendarAccount),
  setCalendarSelected: invokeMethod<"setCalendarSelected">(channels.setCalendarSelected),
  connectLinear: invokeMethod<"connectLinear">(channels.connectLinear),
  cancelLinearSignIn: () => {
    ipcRenderer.send(channels.cancelLinearSignIn);
  },
  reopenLinearSignIn: () => {
    ipcRenderer.send(channels.reopenLinearSignIn);
  },
  disconnectLinear: invokeMethod<"disconnectLinear">(channels.disconnectLinear),
  checkForUpdates: invokeMethod<"checkForUpdates">(channels.checkForUpdates),
  openLatestRelease: () => ipcRenderer.send(channels.openLatestRelease),
  beginSupersetSignIn: invokeMethod<"beginSupersetSignIn">(channels.beginSupersetSignIn),
  submitSupersetSignInCode: invokeMethod<"submitSupersetSignInCode">(
    channels.submitSupersetSignInCode,
  ),
  reopenSupersetSignIn: () => ipcRenderer.send(channels.reopenSupersetSignIn),
  cancelSupersetSignIn: () => ipcRenderer.send(channels.cancelSupersetSignIn),
  chooseSupersetOrganization: invokeMethod<"chooseSupersetOrganization">(
    channels.chooseSupersetOrganization,
  ),
  disconnectSuperset: invokeMethod<"disconnectSuperset">(channels.disconnectSuperset),
  setVoiceExchangeActive: (active) => {
    ipcRenderer.send(channels.setVoiceExchange, active);
  },
  openSession: invokeMethod<"openSession">(channels.openSession),
  openSessionChange: invokeMethod<"openSessionChange">(channels.openSessionChange),
  readSessionTranscript: invokeMethod<"readSessionTranscript">(channels.readSessionTranscript),
  sendSessionMessage: invokeMethod<"sendSessionMessage">(channels.sendSessionMessage),
  executeSessionControl: invokeMethod<"executeSessionControl">(channels.executeSessionControl),
  requestSessionNotice: invokeMethod<"requestSessionNotice">(channels.requestSessionNotice),
  withdrawSessionNotice: invokeMethod<"withdrawSessionNotice">(channels.withdrawSessionNotice),
  createSessionWorkspace: invokeMethod<"createSessionWorkspace">(channels.createSessionWorkspace),
  addWorkspaceAgent: invokeMethod<"addWorkspaceAgent">(channels.addWorkspaceAgent),
  executeIssueAction: invokeMethod<"executeIssueAction">(channels.executeIssueAction),
  openIssue: invokeMethod<"openIssue">(channels.openIssue),
  sendFeedback: invokeMethod<"sendFeedback">(channels.sendFeedback),
  summonFeedback: invokeMethod<"summonFeedback">(channels.summonFeedback),
  focusPanel: () => ipcRenderer.send(channels.focusPanel),
  requestRealtimeCredential: invokeMethod<"requestRealtimeCredential">(
    channels.requestRealtimeCredential,
  ),
  requestRealtimeDiagnostics: invokeMethod<"requestRealtimeDiagnostics">(
    channels.requestRealtimeDiagnostics,
  ),
  requestHostedUsage: invokeMethod<"requestHostedUsage">(channels.requestHostedUsage),
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
  onSupersetSignInChanged: subscribe(channels.supersetSignInChanged),
  onAttentionSpeech: subscribe(channels.attentionSpeech),
};

contextBridge.exposeInMainWorld("sidecar", bridge);
