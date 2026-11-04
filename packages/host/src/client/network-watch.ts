/**
 * network-watch.ts -- whether this machine can reach the service, as the platform's probe and the service's calls answer it, kept in the document.
 */
import { ServiceReach } from "@repo/features";
import { Duration, Effect, Layer, Schedule, type Scope, Stream, SubscriptionRef } from "effect";
import { type AppState, networkConnected } from "../app-state.js";
import type { AppStateStore } from "./app-state-store.js";

/**
 * How often the probe is asked. The probe reads a flag the platform keeps
 * current and sends nothing, so it is cheap, and a network lost or regained
 * reaches the window within this long.
 */
const NETWORK_PROBE_INTERVAL = Duration.seconds(2);

/** What the two signals move of the `network` slice: the platform's flag, and the service's reach. */
type NetworkSignals = Pick<AppState["network"], "online" | "reachable">;

/**
 * Where the service's calls tell whether it answered (`ServiceReach`): one
 * per client, provided beside the `HttpClient` its calls go out on, so every
 * call the host makes sets it and the watch follows it. Reachable until a
 * call says otherwise.
 */
export const serviceReachLayer: Layer.Layer<ServiceReach> = Layer.effect(
  ServiceReach,
  SubscriptionRef.make(true),
);

export interface NetworkWatchDependencies {
  /** The document the answer is written into, as its `network` slice. */
  state: AppStateStore;
  /** Whether the machine has a network now: Electron's `net.isOnline` on the desktop. */
  isOnline: () => boolean;
  /** What runs each time the app can reach the service again, as the live reads catching up at once rather than on their own backoff. */
  regained?: Effect.Effect<void>;
}

/**
 * Asks the probe at once and every `NETWORK_PROBE_INTERVAL` after it, and
 * follows the service's reach as its calls set it, for the client's scope,
 * and writes either into the document only when it moved, so a steady
 * network costs no version and reaches no window. Runs `regained` once each
 * time `networkConnected` turns true, whichever signal turned it: the
 * network back while the service answered last, or the service answering
 * again. Note that the probe is polled rather than subscribed to, because
 * Electron announces no change of `net.online` to the main process, and that
 * no call is made here: the live reads' own retries are what find the
 * service answering again.
 */
export const linkNetworkWatch = /* @__PURE__ */ Effect.fn("client/linkNetworkWatch")(function* (
  dependencies: NetworkWatchDependencies,
): Effect.fn.Return<void, never, Scope.Scope | ServiceReach> {
  const { state, isOnline, regained = Effect.void } = dependencies;
  const scope = yield* Effect.scope;
  const reach = yield* ServiceReach;
  // Note that what catches up runs beside the watch, so a slow answer never holds the next change.
  const moved = (signal: Partial<NetworkSignals>) =>
    Effect.suspend(() => {
      const before = state.snapshot().network;
      const after = { ...before, ...signal };
      if (after.online === before.online && after.reachable === before.reachable) {
        return Effect.void;
      }
      state.update({ network: after });
      return networkConnected(after) && !networkConnected(before)
        ? Effect.asVoid(Effect.forkIn(regained, scope))
        : Effect.void;
    });
  const probe = Effect.suspend(() => moved({ online: isOnline() }));
  yield* Effect.forkScoped(Effect.repeat(probe, Schedule.spaced(NETWORK_PROBE_INTERVAL)));
  yield* Effect.forkScoped(
    Stream.runForEach(SubscriptionRef.changes(reach), (reachable) => moved({ reachable })),
  );
});
