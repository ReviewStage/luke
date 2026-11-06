import { ServiceReach, type ServiceReachState } from "@repo/features";
import {
  Clock,
  Duration,
  Effect,
  Layer,
  Schedule,
  type Scope,
  Stream,
  SubscriptionRef,
} from "effect";
import { type AppState, networkConnected } from "../app-state.js";
import type { AppStateStore } from "./app-state-store.js";

const NETWORK_PROBE_INTERVAL = Duration.seconds(2);

type NetworkSignals = Pick<AppState["network"], "online" | "reachable">;

export const serviceReachLayer: Layer.Layer<ServiceReach> = Layer.effect(
  ServiceReach,
  Effect.flatMap(Clock.currentTimeMillis, (answeredAt) =>
    SubscriptionRef.make<ServiceReachState>({ reachable: true, answeredAt }),
  ),
);

export interface NetworkWatchDependencies {
  state: AppStateStore;
  isOnline: () => boolean;
  regained?: Effect.Effect<void>;
  report: (message: string) => void;
}

export const linkNetworkWatch = Effect.fn("client/linkNetworkWatch")(function* (
  dependencies: NetworkWatchDependencies,
): Effect.fn.Return<void, never, Scope.Scope | ServiceReach> {
  const { state, isOnline, regained = Effect.void, report } = dependencies;
  const scope = yield* Effect.scope;
  const reach = yield* ServiceReach;
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
  const probe = moved(() => ({ online: isOnline() }));
  yield* Effect.forkScoped(Effect.repeat(probe, Schedule.spaced(NETWORK_PROBE_INTERVAL)));
  yield* Effect.forkScoped(
    Stream.runForEach(
      Stream.changes(Stream.map(SubscriptionRef.changes(reach), (found) => found.reachable)),
      (reachable) => moved(() => ({ reachable })),
    ),
  );
});
