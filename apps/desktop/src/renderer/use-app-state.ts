import { type AppSettingsView, appSettingsView } from "@sidecar/settings/wire";
import { useSyncExternalStore } from "react";
import type { AppStateSnapshot } from "#shared/messages/app-state";

/** The two bridge calls a window reads its state through, and nothing else. */
export interface AppStateSource {
  subscribe: (onDelivered: (delivered: AppStateSnapshot) => void) => () => void;
  read: () => Promise<AppStateSnapshot>;
}

export interface AppStateClient {
  /**
   * The document as main holds it, read once and adopted like any delivery.
   * It installs the subscription before it asks for anything: a delivery
   * landing while the request is in flight is then kept rather than lost,
   * which is what makes this a bootstrap and not a race.
   */
  read: () => Promise<AppStateSnapshot>;
  snapshot: () => AppStateSnapshot | undefined;
  subscribe: (reader: () => void) => () => void;
}

/**
 * This window's copy of the one document main holds, and the one subscription
 * behind it.
 *
 * Every reader shares it, so `app:state` is subscribed to exactly once
 * however many components read state, and a component that mounts late is
 * handed what already arrived rather than asking again. A delivery older than
 * the one held is dropped and nothing else is: the version rises with the
 * document, and a delivery that repeats it is this window's own facts having
 * moved — its mode, or the display under it — which the document does not
 * number and every reader still has to be told.
 */
export function createAppStateClient(source: AppStateSource): AppStateClient {
  let held: AppStateSnapshot | undefined;
  const readers = new Set<() => void>();
  /**
   * Whether the subscription stands. It is never taken back: the client is
   * every reader's, so a component unmounting is no reason to stop listening,
   * and the window going away is the whole of its life.
   */
  let attached = false;

  function adopt(delivered: AppStateSnapshot): void {
    if (held !== undefined && delivered.version < held.version) return;
    held = delivered;
    for (const reader of Array.from(readers)) reader();
  }

  function attach(): void {
    if (attached) return;
    attached = true;
    source.subscribe(adopt);
  }

  return {
    read: async () => {
      attach();
      const answered = await source.read();
      adopt(answered);
      // A delivery may have raced past the reply, in which case the held one
      // is the newer reading and the answer has already been dropped.
      return held ?? answered;
    },
    snapshot: () => held,
    subscribe: (reader) => {
      readers.add(reader);
      return () => {
        readers.delete(reader);
      };
    },
  };
}

// The thunks are read at each call rather than at module load: this module is
// imported by the tests that exercise the rule above, which have no bridge.
const client = createAppStateClient({
  subscribe: (onDelivered) => window.sidecar.onAppState(onDelivered),
  read: () => window.sidecar.requestAppState(),
});

/**
 * The document as main holds it, read before anything is drawn over it. The
 * one place a window asks: every later reading arrives on the subscription
 * this installs.
 */
export function readAppState(): Promise<AppStateSnapshot> {
  return client.read();
}

/**
 * The snapshot as it stands, for a callback that cannot wait a render: two
 * acts asked in one breath arrive as two calls in one turn, and the second
 * has to read what the first left. Not a hook, so nothing redraws for it.
 */
export function appStateNow(): AppStateSnapshot | undefined {
  return client.snapshot();
}

/** This window's snapshot, absent only before {@link readAppState} has answered. */
export function useAppState(): AppStateSnapshot | undefined {
  return useSyncExternalStore(client.subscribe, client.snapshot);
}

/**
 * The settings as the document holds them, for a callback that cannot wait a
 * render: two actions asked in one breath arrive as two calls in one turn, and
 * the second has to compose against what the first stored.
 */
export function appSettingsNow(): AppSettingsView | undefined {
  const stored = client.snapshot()?.settings;
  return stored ? appSettingsView(stored) : undefined;
}
