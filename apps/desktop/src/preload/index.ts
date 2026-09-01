import * as Sentry from "@sentry/electron/renderer";
import type { UnparsedWireValue } from "@sidecar/wire";
import { contextBridge, ipcRenderer } from "electron";
import { type AppBridge, bridgeEntries } from "#shared/bridge";

Sentry.init();

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
