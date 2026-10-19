/**
 * app-bridge.ts -- the one bridge this window reaches main through, and its act port, installed by its root before anything reads them.
 *
 * Every call the renderer makes across the sandbox, its acts, its state, the
 * events main sends it, goes through the `AppBridge` installed here rather
 * than through a global, so the root decides what answers: the desktop's
 * `window-root.tsx` installs the preload's Electron bridge, and a test installs a
 * fake of its own. The acts that have moved onto oRPC ride the window's act
 * port instead, whose client is installed beside it the same way. Note that
 * this is a module-level door rather than an Effect service or a React
 * context, because most of its callers are neither fibers nor components:
 * the act door's promises, the state atom's subscription, and the toasts'
 * callbacks all read it outside a render, and each reads it at the moment it
 * calls, never at module load.
 */

import type { AppBridge, PushListeners } from "@luke/host/bridge";
import {
  type ActPortClient,
  PUSH_GUARD,
  PUSH_METHOD,
  type PushEvent,
  type PushName,
} from "@luke/host/contract";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/message-port";

let installed: AppBridge | undefined;
let installedActPort: ActPortClient | undefined;

/** Installs the bridge this window reaches main through; its root does this once, before anything is drawn. */
export function installAppBridge(bridge: AppBridge): void {
  installed = bridge;
}

/** The bridge this window's root installed. */
export function appBridge(): AppBridge {
  if (installed === undefined) throw new Error("No app bridge is installed in this window.");
  return installed;
}

/**
 * Installs this window's end of its act port, the other end of which its
 * root has handed main, and starts it; its root does this once, beside the bridge.
 */
export function installActPort(port: MessagePort): void {
  installActPortClient(createORPCClient(new RPCLink({ port })));
  port.start();
}

/** Installs the act port's client itself, which a test answers with a fake of its own. */
export function installActPortClient(client: ActPortClient): void {
  installedActPort = client;
}

/** The act port's client this window's root installed. */
export function actPort(): ActPortClient {
  if (installedActPort === undefined) throw new Error("No act port is installed in this window.");
  return installedActPort;
}

/** One listener on one push, held as its own entry so a listener subscribed twice hears twice. */
interface PushEntry {
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- The push's guard has read the payload before any listener hears it.
  readonly listener: (payload: unknown) => void;
}

/** This window's push stream: the listeners a window subscribes through, and when main began to listen. */
export interface PushStream {
  readonly listeners: PushListeners;
  /** Settles once main listens, so nothing it pushes from here on is lost; rejects if the stream could not open. */
  readonly opened: Promise<void>;
}

/** Hands one push to every listener on it, its payload first read by the push's own guard. */
function deliver(held: ReadonlyMap<PushName, Set<PushEntry>>, event: PushEvent): void {
  if (!PUSH_GUARD[event.push](event.payload)) return;
  for (const entry of [...(held.get(event.push) ?? [])]) {
    // Note that each listener is told on its own, because one that throws must
    // not end the stream every other push to this window rides.
    try {
      entry.listener(event.payload);
    } catch (error) {
      console.error(`A listener on ${event.push} failed.`, error);
    }
  }
}

/**
 * Opens this window's one push stream on its act port, and answers each
 * push's listeners from it, in the order main pushed them. A listener
 * subscribes and unsubscribes at once, as one did on a channel of the
 * preload's: the stream stands for the page's life, whoever listens.
 * Its root awaits `opened` before its first read, so a document pushed
 * while that read is in flight is heard rather than lost.
 */
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
      // oxlint-disable-next-line anti-slop/no-unknown-parameters -- What ended a stream is unknown until this reads it.
    })().catch((error: unknown) => {
      // Note that a stream ends this way only with its page, its port closing under it, unless something broke.
      if (!(error instanceof Error && error.name === "AbortError")) {
        console.error("This window's push stream ended.", error);
      }
    });
  });
  // SAFETY: one listener per method of PUSH_METHOD, each subscribing to that method's own push, whose guard reads its payload.
  return { listeners: listeners as PushListeners, opened };
}
