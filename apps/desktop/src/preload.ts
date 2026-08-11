import { contextBridge, ipcRenderer } from "electron";
import type {
  AppBootstrap,
  AppBridge,
  DisplayDiagnostic,
  MicrophoneStatus,
  WindowMode,
} from "./shared/contracts";
import { channels } from "./shared/contracts";

const bridge: AppBridge = {
  getBootstrap: () => ipcRenderer.invoke(channels.bootstrap) as Promise<AppBootstrap>,
  setExpanded: (expanded: boolean) =>
    ipcRenderer.invoke(channels.setExpanded, expanded) as Promise<WindowMode>,
  setPointerInterception: (interceptsPointer: boolean) => {
    ipcRenderer.send(channels.setPointerInterception, interceptsPointer);
  },
  requestMicrophone: () =>
    ipcRenderer.invoke(channels.requestMicrophone) as Promise<MicrophoneStatus>,
  notifyReady: () => ipcRenderer.send(channels.rendererReady),
  quit: () => ipcRenderer.send(channels.quit),
  onLifecycle: (callback: (eventName: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, eventName: string) => callback(eventName);
    ipcRenderer.on(channels.lifecycle, listener);
    return () => ipcRenderer.removeListener(channels.lifecycle, listener);
  },
  onStartMicrophone: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on(channels.startMicrophone, listener);
    return () => ipcRenderer.removeListener(channels.startMicrophone, listener);
  },
  onDisplayChanged: (callback: (display: DisplayDiagnostic) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, display: DisplayDiagnostic) =>
      callback(display);
    ipcRenderer.on(channels.displayChanged, listener);
    return () => ipcRenderer.removeListener(channels.displayChanged, listener);
  },
};

contextBridge.exposeInMainWorld("sidecar", bridge);
