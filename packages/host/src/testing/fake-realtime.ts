/**
 * fake-realtime.ts -- Neon Realtime's client as a script a host test drives: the subscriptions it holds, and rows delivered to them by hand.
 */

import assert from "node:assert/strict";
import type { LiveClient } from "../live-follow.js";

/**
 * Realtime as a script: the address each client was opened at, each part's
 * subscription by its capability, the seals each was renewed with, and a
 * way to deliver rows to one or stop it for good. A write's transaction is
 * waited on until `arrive` names it, as Realtime's `awaitTxId` settles once
 * the transaction reaches the subscription.
 */
export function fakeRealtime() {
  const opened: string[] = [];
  const closed: string[] = [];
  const listeners = new Map<
    string,
    (snapshot: { readonly status: string; readonly data: readonly unknown[] | undefined }) => void
  >();
  const renewed: string[] = [];
  const arrived = new Set<string>();
  const waiting = new Map<string, Array<() => void>>();
  const awaitTxId = (txid: string): Promise<void> => {
    if (arrived.has(txid)) return Promise.resolve();
    const { promise, resolve } = Promise.withResolvers<void>();
    waiting.set(txid, [...(waiting.get(txid) ?? []), resolve]);
    return promise;
  };
  const open = (url: string): LiveClient => {
    opened.push(url);
    return {
      subscribe: (query) => ({
        onChange: (listener) => {
          listeners.set(query.capability, listener);
          return () => listeners.delete(query.capability);
        },
        renew: (next) => {
          renewed.push(next.capability);
          return Promise.resolve();
        },
        awaitTxId,
        unsubscribe: () => void listeners.delete(query.capability),
      }),
      close: () => void closed.push(url),
    };
  };
  return {
    open,
    opened,
    closed,
    renewed,
    /** Rows delivered to the part's subscription, as Realtime's snapshot carries them. */
    deliver: (part: string, data: readonly unknown[]) => {
      const listener = listeners.get(`capability-${part}`);
      assert.ok(listener, `no subscription to ${part}`);
      listener({ status: "live", data });
    },
    /** A write's transaction reaching the subscriptions, settling every wait on it. */
    arrive: (txid: string) => {
      arrived.add(txid);
      for (const resolve of waiting.get(txid) ?? []) resolve();
      waiting.delete(txid);
    },
    /** The transactions a wait still stands on. */
    awaitingTxids: () => [...waiting.keys()].toSorted(),
    fail: (part: string) => listeners.get(`capability-${part}`)?.({ status: "error", data: [] }),
    subscribed: () => [...listeners.keys()].toSorted(),
  };
}
