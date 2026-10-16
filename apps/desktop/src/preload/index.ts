import { MAC_TERMINAL_PORT_CHANNEL } from "@luke/features/mac-repository-wire";
import { TERMINAL_PORT_CHANNEL } from "@luke/features/terminal-acts";
import type { UnparsedWireValue } from "@luke/wire";
import * as Sentry from "@sentry/electron/renderer";
import { contextBridge, ipcRenderer } from "electron";
import { type AppBridge, bridgeEntries } from "#shared/bridge";
import { eventWithoutAccessTokens, withoutAccessTokens } from "#shared/sentry-breadcrumbs";

Sentry.init({ beforeBreadcrumb: withoutAccessTokens, beforeSend: eventWithoutAccessTokens });

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

contextBridge.exposeInMainWorld("luke", exposedBridge());

// An attached shell's port cannot cross the context bridge, so it is handed
// into the page as Electron hands a port to an isolated world; the page reads
// it back by the channel and checks the ticket (`renderer/terminal/terminal-port.ts`).
ipcRenderer.on(TERMINAL_PORT_CHANNEL, (event, ticket: UnparsedWireValue) => {
  window.postMessage({ channel: TERMINAL_PORT_CHANNEL, ticket }, "*", [...event.ports]);
});

// A terminal of this Mac's port is handed in the same way (`renderer/planning/mac-terminal-tab.tsx`).
ipcRenderer.on(MAC_TERMINAL_PORT_CHANNEL, (event, ticket: UnparsedWireValue) => {
  window.postMessage({ channel: MAC_TERMINAL_PORT_CHANNEL, ticket }, "*", [...event.ports]);
});
