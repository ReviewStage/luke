/**
 * fake-realtime.ts -- Neon Realtime's client as a script a host test drives: the subscriptions it holds, and rows delivered to them by hand.
 */

import assert from "node:assert/strict";
import type { LiveClient } from "../live-follow.js";

/**
 * Realtime as a script: the address each client was opened at, each part's
 * subscription by its capability, the seals each was renewed with, and a
 * way to deliver rows to one or stop it for good.
 */
export function fakeRealtime() {
  const opened: string[] = [];
  const closed: string[] = [];
  const listeners = new Map<
    string,
    (snapshot: { readonly status: string; readonly data: readonly unknown[] | undefined }) => void
  >();
  const renewed: string[] = [];
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
    fail: (part: string) => listeners.get(`capability-${part}`)?.({ status: "error", data: [] }),
    subscribed: () => [...listeners.keys()].toSorted(),
  };
}
