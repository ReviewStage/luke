/**
 * network-watch.ts -- whether this machine is online, as the platform's probe answers it, kept in the document.
 */
import { Duration, Effect, Schedule, type Scope } from "effect";
import type { AppStateStore } from "./app-state-store.js";

/**
 * How often the probe is asked. The probe reads a flag the platform keeps
 * current and sends nothing, so it is cheap, and a network lost or regained
 * reaches the window within this long.
 */
const NETWORK_PROBE_INTERVAL = Duration.seconds(2);

export interface NetworkWatchDependencies {
  /** The document the answer is written into, as its `network` slice. */
  state: AppStateStore;
  /** Whether the machine has a network now: Electron's `net.isOnline` on the desktop. */
  isOnline: () => boolean;
}

/**
 * Asks the probe at once and every `NETWORK_PROBE_INTERVAL` after it for the
 * client's scope, and writes the answer into the document only when it moved,
 * so a steady network costs no version and reaches no window. Note that the
 * probe is polled rather than subscribed to, because Electron announces no
 * change of `net.online` to the main process.
 */
export const linkNetworkWatch = /* @__PURE__ */ Effect.fn("client/linkNetworkWatch")(function* (
  dependencies: NetworkWatchDependencies,
): Effect.fn.Return<void, never, Scope.Scope> {
  const { state, isOnline } = dependencies;
  const probe = Effect.sync(() => {
    const online = isOnline();
    if (state.snapshot().network.online !== online) state.update({ network: { online } });
  });
  yield* Effect.forkScoped(Effect.repeat(probe, Schedule.spaced(NETWORK_PROBE_INTERVAL)));
});
