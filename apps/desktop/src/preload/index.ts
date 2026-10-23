import {
  BROWSER_LIVE_PORT_CHANNEL,
  MAC_TERMINAL_PORT_CHANNEL,
  TERMINAL_PORT_CHANNEL,
} from "@luke/features/port-channels";
import { eventWithoutAccessTokens, withoutAccessTokens } from "@luke/features/sentry-breadcrumbs";
import type { PreloadBridge } from "@luke/host/bridge";
import {
  ACT_PORT,
  actPortForwarder,
  BRIDGE_KIND,
  bridgeChannelEntries,
} from "@luke/host/bridge-channels";
import type { UnparsedWireValue } from "@luke/wire";
import * as Sentry from "@sentry/electron/renderer";
import { contextBridge, ipcRenderer } from "electron";

Sentry.init({ beforeBreadcrumb: withoutAccessTokens, beforeSend: eventWithoutAccessTokens });

const bridge: Record<string, CallableFunction> = {};

// Note that an invoke's answer is handed on unread: the page holds it to its
// guard (`guardedPreloadBridge`), whose Schemas would have this script, which
// runs before every window's page, evaluate `effect`.
for (const [method, definition] of bridgeChannelEntries()) {
  if (definition.kind === BRIDGE_KIND.INVOKE) {
    bridge[method] = async (...args: UnparsedWireValue[]): Promise<UnparsedWireValue> =>
      ipcRenderer.invoke(definition.channel, ...args);
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
  // SAFETY: the loop derives every method and transport from all entries in BRIDGE_CHANNEL, which BRIDGE is built over.
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

// A cloud Browser tab's live view's port is handed in the same way (`@luke/panel`'s `tasks/browser-live-port.ts`).
ipcRenderer.on(BROWSER_LIVE_PORT_CHANNEL, (event, ticket: UnparsedWireValue) => {
  window.postMessage({ channel: BROWSER_LIVE_PORT_CHANNEL, ticket }, "*", [...event.ports]);
});
