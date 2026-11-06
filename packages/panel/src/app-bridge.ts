import type { AppBridge, PushListeners } from "@repo/host/bridge";
import {
  type ActPortClient,
  PUSH_GUARD,
  PUSH_METHOD,
  type PushEvent,
  type PushName,
} from "@repo/host/contract";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/message-port";

let installed: AppBridge | undefined;
let installedActPort: ActPortClient | undefined;

export function installAppBridge(bridge: AppBridge): () => void {
  installed = bridge;
  return () => {
    if (installed === bridge) installed = undefined;
  };
}

export function appBridge(): AppBridge {
  if (installed === undefined) throw new Error("No app bridge is installed in this window.");
  return installed;
}

export function installActPort(
  port: MessagePort,
  through: (client: ActPortClient) => ActPortClient = (client) => client,
): () => void {
  const uninstall = installActPortClient(through(createORPCClient(new RPCLink({ port }))));
  port.start();
  return uninstall;
}

export function installActPortClient(client: ActPortClient): () => void {
  installedActPort = client;
  return () => {
    if (installedActPort === client) installedActPort = undefined;
  };
}

export function actPort(): ActPortClient {
  if (installedActPort === undefined) throw new Error("No act port is installed in this window.");
  return installedActPort;
}

interface PushEntry {
  readonly listener: (payload: unknown) => void;
}

export interface PushStream {
  readonly listeners: PushListeners;
  readonly opened: Promise<void>;
}

function deliver(held: ReadonlyMap<PushName, Set<PushEntry>>, event: PushEvent): void {
  if (!PUSH_GUARD[event.push](event.payload)) return;
  for (const entry of [...(held.get(event.push) ?? [])]) {
    try {
      entry.listener(event.payload);
    } catch (error) {
      console.error(`A listener on ${event.push} failed.`, error);
    }
  }
}

export function openPushStream(client: ActPortClient): PushStream {
  const held = new Map<PushName, Set<PushEntry>>();
  const listen = (push: PushName, listener: PushEntry["listener"]) => {
    const entry: PushEntry = { listener };
    const entries = held.get(push) ?? new Set<PushEntry>();
    held.set(push, entries);
    entries.add(entry);
    return () => {
      entries.delete(entry);
    };
  };
  const listeners = Object.fromEntries(
    Object.entries(PUSH_METHOD).map(([method, push]) => [
      method,
      (listener: PushEntry["listener"]) => listen(push, listener),
    ]),
  );
  const opened = client.pushes().then((stream) => {
    void (async () => {
      for await (const event of stream) deliver(held, event);
    })().catch((error: unknown) => {
      if (!(error instanceof Error && error.name === "AbortError")) {
        console.error("This window's push stream ended.", error);
      }
    });
  });
  return { listeners: listeners as PushListeners, opened };
}
