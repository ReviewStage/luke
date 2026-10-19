import { MAC_TERMINAL_PORT_CHANNEL } from "@luke/features/mac-terminal-wire";
import { TERMINAL_PORT_CHANNEL } from "@luke/features/terminal-acts";
import { ACT_PORT, actPortForwarder, bridgeEntries, type PreloadBridge } from "@luke/host/bridge";
import type { UnparsedWireValue } from "@luke/wire";
import * as Sentry from "@sentry/electron/renderer";
import { contextBridge, ipcRenderer } from "electron";
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
  bridge[method] = (...args: UnparsedWireValue[]) => {
    ipcRenderer.send(definition.channel, ...args);
    return undefined;
  };
}

// What main pushes the page reaches it on its act port, which the page opens
// itself (`renderer/window-root.tsx`), so nothing here listens for a push.
function exposedBridge(): PreloadBridge {
  // SAFETY: the loop derives every method and transport from all entries in BRIDGE.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- The manifest loop proves the dynamically keyed object is the derived bridge.
  return bridge as unknown as PreloadBridge;
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

// The page's act port, posted to its own window by its root as oRPC's
// Electron adapter has it, is forwarded to main once for this page's life;
// main upgrades it in `bridge-host.ts`, and a later port this page posts is ignored.
window.addEventListener(
  "message",
  actPortForwarder<MessagePort, MessageEventSource>(window, (port) => {
    ipcRenderer.postMessage(ACT_PORT.CHANNEL, null, [port]);
  }),
);
