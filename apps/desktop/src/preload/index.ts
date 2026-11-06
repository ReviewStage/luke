import { BROWSER_LIVE_PORT_CHANNEL } from "@repo/features/browser-live-acts";
import { eventWithoutAccessTokens, withoutAccessTokens } from "@repo/features/sentry-breadcrumbs";
import { TERMINAL_PORT_CHANNEL } from "@repo/features/terminal-acts";
import { ACT_PORT, actPortForwarder, bridgeEntries, type PreloadBridge } from "@repo/host/bridge";
import type { UnparsedWireValue } from "@repo/wire";
import * as Sentry from "@sentry/electron/renderer";
import { contextBridge, ipcRenderer } from "electron";

Sentry.init({ beforeBreadcrumb: withoutAccessTokens, beforeSend: eventWithoutAccessTokens });

const bridge: Record<string, CallableFunction> = {};

for (const [method, definition] of bridgeEntries()) {
  if (definition.kind === "invoke") {
    bridge[method] = async (...args: UnparsedWireValue[]) => {
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

function exposedBridge(): PreloadBridge {
  return bridge as unknown as PreloadBridge;
}

contextBridge.exposeInMainWorld("appBridge", exposedBridge());

for (const channel of [TERMINAL_PORT_CHANNEL, BROWSER_LIVE_PORT_CHANNEL]) {
  ipcRenderer.on(channel, (event, ticket: UnparsedWireValue) => {
    window.postMessage({ channel, ticket }, "*", [...event.ports]);
  });
}

window.addEventListener(
  "message",
  actPortForwarder<MessagePort, MessageEventSource>(window, (port) => {
    ipcRenderer.postMessage(ACT_PORT.CHANNEL, null, [port]);
  }),
);
