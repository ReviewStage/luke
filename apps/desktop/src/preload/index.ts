import type { UnparsedWireValue } from "@sidecar/wire";
import { contextBridge, ipcRenderer } from "electron";
import { type AppBridge, bridgeEntries } from "#shared/bridge";

const bridge: Record<string, CallableFunction> = {};

for (const [method, definition] of bridgeEntries()) {
  if (definition.kind === "invoke") {
    bridge[method] = async (...args: UnparsedWireValue[]) => {
      // SAFETY: Electron returns a structured-clone value, which the manifest result guard parses below.
      const value = (await ipcRenderer.invoke(definition.channel, ...args)) as UnparsedWireValue;
      if (definition.result?.(value) === false) throw new Error("Invalid bridge response");
      return value;
    };
    continue;
  }
  if (definition.kind === "send") {
    bridge[method] = (...args: UnparsedWireValue[]) => {
      ipcRenderer.send(definition.channel, ...args);
      return undefined;
    };
    continue;
  }
  bridge[method] = (callback: (payload: UnparsedWireValue) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: UnparsedWireValue) => {
      if (definition.result?.(payload) !== false) callback(payload);
    };
    ipcRenderer.on(definition.channel, listener);
    return () => ipcRenderer.removeListener(definition.channel, listener);
  };
}

function exposedBridge(): AppBridge {
  // SAFETY: the loop derives every method and transport from all entries in BRIDGE.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- The manifest loop proves the dynamically keyed object is the derived bridge.
  return bridge as unknown as AppBridge;
}

contextBridge.exposeInMainWorld("sidecar", exposedBridge());

// TEMPORARY (launch-test harness, remove before merge): the window manager
// passes `--luke-without-voice-fix` into this preload's arguments when the app
// was launched with `--without-voice-fix`, and the renderer reads the flag to
// revert the remote-audio retry to the old swallow-once behavior.
contextBridge.exposeInMainWorld(
  "lukeVoiceFixDisabled",
  process.argv.includes("--luke-without-voice-fix"),
);
contextBridge.exposeInMainWorld(
  "lukeAnnounceTrace",
  process.argv.includes("--luke-trace-announcements"),
);
