/**
 * network-watch.ts -- whether this machine can reach the service, as the platform's online events and the service's calls answer it, kept in the document.
 */
import { ServiceReach, type ServiceReachState } from "@repo/features";
import { Clock, Effect, Layer, type Scope, Stream, SubscriptionRef } from "effect";
import { type AppState, networkConnected } from "../app-state.js";
import type { AppStateStore } from "./app-state-store.js";

/** What the two signals move of the `network` slice: the platform's flag, and the service's reach. */
type NetworkSignals = Pick<AppState["network"], "online" | "reachable">;

/**
 * Where the service's calls tell whether it answered (`ServiceReach`): one
 * per client, provided beside the `HttpClient` its calls go out on, so every
 * call the host makes sets it and the watch follows it. Reachable until the
 * calls say otherwise, its silence counted from the moment it is made.
 */
export const serviceReachLayer: Layer.Layer<ServiceReach> = Layer.effect(
  ServiceReach,
  Effect.flatMap(Clock.currentTimeMillis, (answeredAt) =>
    SubscriptionRef.make<ServiceReachState>({ reachable: true, answeredAt }),
  ),
);

export interface NetworkWatchDependencies {
  /** The document the answer is written into, as its `network` slice. */
  state: AppStateStore;
  /**
   * Whether the machine has a network: its answer now, then each change as
   * the platform announces it. On the desktop, `net.isOnline` read once and
   * then what any window's `online` and `offline` events report; in a tab,
   * the tab's own.
   */
  online: Stream.Stream<boolean>;
  /** What runs each time the app can reach the service again, as the live reads catching up at once rather than on their own backoff. */
  regained?: Effect.Effect<void>;
  /** Where a change the watch could not write is said, besides Sentry. */
  report: (message: string) => void;
}

/**
 * Follows the platform's network and the service's reach as its calls set
 * it, for the client's scope, and writes either into the document only when
 * it moved, so a steady network costs no version and reaches no window.
 * Runs `regained` once each time `networkConnected` turns true, whichever
 * signal turned it: the network back while the service answered last, or
 * the service answering again. Note that nothing is polled and no call is
 * made here: the network arrives as the platform announces it, and the live
 * reads' own retries are what find the service answering again. A change
 * that throws is reported, to Sentry as well as the line, rather than left
 * to end a follower, which would never resume and would hold the last value
 * for the rest of the session.
 */
export const linkNetworkWatch = /* @__PURE__ */ Effect.fn("client/linkNetworkWatch")(function* (
  dependencies: NetworkWatchDependencies,
): Effect.fn.Return<void, never, Scope.Scope | ServiceReach> {
  const { state, online, regained = Effect.void, report } = dependencies;
  const scope = yield* Effect.scope;
  const reach = yield* ServiceReach;
  // Note that what catches up runs beside the watch, so a slow answer never holds the next change.
  const moved = (signal: () => Partial<NetworkSignals>) =>
    Effect.catchDefect(
      Effect.withErrorReporting(
        Effect.suspend(() => {
          const before = state.snapshot().network;
          const after = { ...before, ...signal() };
          if (after.online === before.online && after.reachable === before.reachable) {
            return Effect.void;
          }
          state.update({ network: after });
          return networkConnected(after) && !networkConnected(before)
            ? Effect.asVoid(Effect.forkIn(regained, scope))
            : Effect.void;
        }),
        { defectsOnly: true },
      ),
      (defect) =>
        Effect.sync(() =>
          report(
            `the network watch could not note a change: ${defect instanceof Error ? defect.message : String(defect)}`,
          ),
        ),
    );
  yield* Effect.forkScoped(
    Stream.runForEach(Stream.changes(online), (found) => moved(() => ({ online: found }))),
  );
  yield* Effect.forkScoped(
    Stream.runForEach(
      Stream.changes(Stream.map(SubscriptionRef.changes(reach), (found) => found.reachable)),
      (reachable) => moved(() => ({ reachable })),
    ),
  );
});
