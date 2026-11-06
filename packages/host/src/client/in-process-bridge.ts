import { Effect, type Scope } from "effect";
import {
  type AppStateDelivery,
  type AppStateSnapshot,
  type AppWindowFacts,
  appStateDelivery,
} from "../app-state.js";
import type { AppBridge, PushPayloadFor } from "../bridge.js";
import type { PushMethod } from "../contract/pushes.js";
import { type AppStateStore, publishAppStateChanges } from "./app-state-store.js";

type InProcessEventMethod = Extract<PushMethod, "onShowLink">;

type InProcessEvents = {
  readonly [Method in InProcessEventMethod]: (payload: PushPayloadFor<Method>) => void;
};

interface InProcessBridgeDependencies {
  state: AppStateStore;
  windowFacts: () => AppWindowFacts;
  reports: Pick<AppBridge, "notifyReady" | "recordSurfaceEvent">;
  report: (message: string) => void;
}

interface InProcessBridge {
  bridge: AppBridge;
  events: InProcessEvents;
}

const unsubscribe = (): void => {};
const neverDelivered = (): (() => void) => unsubscribe;

interface Listeners<Payload> {
  subscribe: (listener: (payload: Payload) => void) => () => void;
  emit: (payload: Payload) => void;
  close: () => void;
}

type EventListeners = {
  readonly [Method in InProcessEventMethod]: Listeners<PushPayloadFor<Method>>;
};

function listeners<Payload>(report: (message: string) => void): Listeners<Payload> {
  const held = new Set<{ readonly listener: (payload: Payload) => void }>();
  let closed = false;
  return {
    subscribe: (listener) => {
      if (closed) return unsubscribe;
      const entry = { listener };
      held.add(entry);
      return () => {
        held.delete(entry);
      };
    },
    emit: (payload) => {
      for (const entry of [...held]) {
        try {
          entry.listener(payload);
        } catch (error) {
          report(
            `a page's bridge listener failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    },
    close: () => {
      closed = true;
      held.clear();
    },
  };
}

export function createInProcessBridge(
  dependencies: InProcessBridgeDependencies,
): Effect.Effect<InProcessBridge, never, Scope.Scope> {
  const { state, windowFacts, reports, report } = dependencies;
  return Effect.gen(function* () {
    const snapshot = (): AppStateSnapshot => ({ ...state.snapshot(), window: windowFacts() });
    const appState = listeners<AppStateDelivery>(report);
    let sent: AppStateSnapshot | undefined;
    yield* publishAppStateChanges(
      state,
      () =>
        Effect.sync(() => {
          const next = snapshot();
          const delivery = appStateDelivery(sent, next);
          sent = next;
          if (delivery !== undefined) appState.emit(delivery);
        }),
      report,
    );
    const said: EventListeners = {
      onShowLink: listeners(report),
    };
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        appState.close();
        for (const set of Object.values(said)) set.close();
      }),
    );
    const bridge: AppBridge = {
      requestAppState: async () => snapshot(),
      onAppState: appState.subscribe,
      notifyReady: reports.notifyReady,
      recordSurfaceEvent: reports.recordSurfaceEvent,
      onShowLink: said.onShowLink.subscribe,
      onMenuCommand: neverDelivered,
    };
    const events: InProcessEvents = {
      onShowLink: said.onShowLink.emit,
    };
    return { bridge, events };
  });
}
