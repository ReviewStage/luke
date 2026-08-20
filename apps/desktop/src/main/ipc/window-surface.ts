import { FEEDBACK_LIFECYCLE_EVENT, isFeedbackKind } from "@sidecar/feedback";
import type { UnparsedWireValue } from "@sidecar/wire";
import { BrowserWindow, type IpcMain, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import { channels, type MicrophoneRoute, type MicrophoneStatus } from "#shared/contracts";
import type { MicrophoneRouteWatcher } from "../native/microphone-route";
import type { PanelManager } from "../window/panel-manager";

export interface WindowSurfaceIpcDependencies {
  ipcMain: Pick<IpcMain, "handle" | "on">;
  trustedSender: (event: IpcMainEvent | IpcMainInvokeEvent) => boolean;
  panels: PanelManager;
  requestMicrophone: () => Promise<MicrophoneStatus>;
  microphoneRoute: () => MicrophoneRoute | undefined;
  microphoneRouteWatcher: () => MicrophoneRouteWatcher | undefined;
}

export function registerWindowSurfaceIpc(dependencies: WindowSurfaceIpcDependencies): void {
  const { ipcMain, trustedSender, panels } = dependencies;
  ipcMain.handle(
    channels.setExpanded,
    (event, expanded: UnparsedWireValue, focus: UnparsedWireValue) => {
      if (!trustedSender(event) || (expanded !== true && expanded !== false)) {
        throw new Error("Invalid window mode request");
      }
      const displayId = panels.displayIdFor(event.sender);
      if (displayId === undefined) throw new Error("Invalid window mode request");
      return panels.setMode(displayId, expanded ? "expanded" : "compact", focus === true);
    },
  );
  ipcMain.handle(channels.summonFeedback, (event, kind: UnparsedWireValue) => {
    if (!trustedSender(event) || !isFeedbackKind(kind)) {
      throw new Error("Invalid composer request");
    }
    const displayId = panels.displayIdFor(event.sender);
    if (displayId === undefined) throw new Error("Invalid composer request");
    panels.setMode(displayId, "expanded", true);
    event.sender.send(channels.lifecycle, FEEDBACK_LIFECYCLE_EVENT[kind]);
  });
  ipcMain.on(channels.setPointerInterception, (event, interceptsPointer: UnparsedWireValue) => {
    if (!trustedSender(event) || (interceptsPointer !== true && interceptsPointer !== false))
      return;
    BrowserWindow.fromWebContents(event.sender)?.setIgnoreMouseEvents(!interceptsPointer, {
      forward: true,
    });
  });
  ipcMain.handle(channels.requestMicrophone, async (event) => {
    if (!trustedSender(event)) throw new Error("Untrusted renderer");
    return dependencies.requestMicrophone();
  });
  ipcMain.handle(channels.microphoneRoute, (event) => {
    if (!trustedSender(event)) throw new Error("Untrusted renderer");
    dependencies.microphoneRouteWatcher()?.probe();
    return dependencies.microphoneRoute();
  });
}
