/**
 * in-process-bridge.ts -- the window's bridge for a shell that runs the host in the page it draws: acts straight to the router, the document straight from the store, and the one-shot events from an emitter the shell drives.
 */
import { Effect, type Scope } from "effect";
import type { ActRouter, ActSender } from "../act-router/router.js";
import type { AppStateSnapshot, AppWindowFacts } from "../app-state.js";
import type { AppBridge, PushPayloadFor } from "../bridge.js";
import type { PushMethod } from "../contract/pushes.js";
import { type AppStateStore, publishAppStateChanges } from "./app-state-store.js";

/**
 * The one-shot events a shell or its notice presenter feeds the page: a
 * notification's click, or a notice the focused window says in its toast.
 * Each is said once and never bootstrapped from.
 */
type InProcessEventMethod = Extract<
  PushMethod,
  | "onShowAgent"
  | "onShowInbox"
  | "onShowInboxItem"
  | "onShowFailedRun"
  | "onShowChat"
  | "onAgentEnded"
  | "onInboxItemOpened"
  | "onRunFailed"
  | "onChatMessageWaiting"
  | "onShowLink"
>;

/** Where the shell says each one-shot event, to every subscription standing in the page. */
type InProcessEvents = {
  readonly [Method in InProcessEventMethod]: (payload: PushPayloadFor<Method>) => void;
};

interface InProcessBridgeDependencies<Sender = unknown> {
  /** The shell's own handle on its page, which only the shell's platform rows read. */
  sender: Sender;
  /**
   * The act table, built over the reporter this bridge minted, so a settings
   * write from this page is named as its own and its echo skipped.
   */
  routerFor: (reporterOf: (sender: Sender) => string) => ActRouter<Sender>;
  /** Every act's Effect, run on the shell's own runtime rather than a second one. */
  run: <A>(effect: Effect.Effect<A>) => Promise<A>;
  /** The document the page is drawn from. */
  state: AppStateStore;
  /** The page's own facts beside the document, which the shell alone can read. */
  windowFacts: () => AppWindowFacts;
  /** The id source the reporter is minted from. */
  createId: () => string;
  /** The page's own reports that reach anything here: that it painted, and its surface events. */
  reports: Pick<AppBridge, "notifyReady" | "recordSurfaceEvent">;
  /** Where a page's listener that failed is said. */
  report: (message: string) => void;
}

interface InProcessBridge {
  bridge: AppBridge;
  events: InProcessEvents;
}

/** An unsubscribe with nothing to end. */
const unsubscribe = (): void => {};
/** What has no listener in a page that runs no voice, avatar, call window, Browser tab, menu bar, or global key. */
const neverDelivered = (): (() => void) => unsubscribe;
const dropped = (): void => {};

/** One subscription set: what a page subscribed, the one door that tells them all, and its close. */
interface Listeners<Payload> {
  subscribe: (listener: (payload: Payload) => void) => () => void;
  emit: (payload: Payload) => void;
  close: () => void;
}

/** Each one-shot event's subscriptions, the page's side and the shell's of one set. */
type EventListeners = {
  readonly [Method in InProcessEventMethod]: Listeners<PushPayloadFor<Method>>;
};

/**
 * Note that each subscription is held as its own entry, so a listener
 * subscribed twice hears twice and one unsubscribe ends one of them, as a
 * listener on a channel of the desktop's does. Each is told on its own as
 * well: one that throws is reported, and the rest still hear, because on the
 * desktop a page's callback throws in the page and never into the sender.
 * Once closed, a set holds no subscription and takes none.
 */
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

/**
 * The bridge for a page that runs the host in its own process. The page is
 * always a panel: the host's rows check that a panel asked, and no voice or
 * call window stands beside it. An act goes to the router on the shell's
 * runtime; the document is the store's, read on request and pushed on every
 * change; the one-shot events are what the shell says through `events`; every
 * subscription ends with the scope; and everything the voice, the avatar, the call window, a
 * Browser tab, the menu bar, or a global key would say is never said, its
 * subscription ending cleanly.
 */
export function createInProcessBridge<Sender = unknown>(
  dependencies: InProcessBridgeDependencies<Sender>,
): Effect.Effect<InProcessBridge, never, Scope.Scope> {
  const { sender, routerFor, run, state, windowFacts, createId, reports, report } = dependencies;
  return Effect.gen(function* () {
    const reporter = createId();
    const router = routerFor(() => reporter);
    const asking: ActSender<Sender> = { sender, panel: true, voice: false, call: false };
    const snapshot = (): AppStateSnapshot => ({ ...state.snapshot(), window: windowFacts() });
    const appState = listeners<AppStateSnapshot>(report);
    yield* publishAppStateChanges(
      state,
      () => Effect.sync(() => appState.emit(snapshot())),
      report,
    );
    const said: EventListeners = {
      onShowAgent: listeners(report),
      onShowInbox: listeners(report),
      onShowInboxItem: listeners(report),
      onShowFailedRun: listeners(report),
      onShowChat: listeners(report),
      onAgentEnded: listeners(report),
      onInboxItemOpened: listeners(report),
      onRunFailed: listeners(report),
      onChatMessageWaiting: listeners(report),
      onShowLink: listeners(report),
    };
    // A page whose bridge is closed hears nothing more, whoever still holds `events`.
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        appState.close();
        for (const set of Object.values(said)) set.close();
      }),
    );
    const bridge: AppBridge = {
      act: (act) => run(router.performAct(act, asking)),
      requestAppState: async () => snapshot(),
      onAppState: appState.subscribe,
      notifyReady: reports.notifyReady,
      recordSurfaceEvent: reports.recordSurfaceEvent,
      onShowAgent: said.onShowAgent.subscribe,
      onShowInbox: said.onShowInbox.subscribe,
      onShowInboxItem: said.onShowInboxItem.subscribe,
      onShowFailedRun: said.onShowFailedRun.subscribe,
      onShowChat: said.onShowChat.subscribe,
      onAgentEnded: said.onAgentEnded.subscribe,
      onInboxItemOpened: said.onInboxItemOpened.subscribe,
      onRunFailed: said.onRunFailed.subscribe,
      onChatMessageWaiting: said.onChatMessageWaiting.subscribe,
      onShowLink: said.onShowLink.subscribe,
      reportVoiceView: dropped,
      setShortcutCapturing: dropped,
      recordAgentTrace: dropped,
      feedAvatar: dropped,
      signalAvatarView: dropped,
      onLifecycle: neverDelivered,
      onMenuCommand: neverDelivered,
      onVoiceHotkeyPress: neverDelivered,
      onVoiceHotkeyRelease: neverDelivered,
      onStopHotkeyPress: neverDelivered,
      onVoiceLiveSessionChanged: neverDelivered,
      onTasksTalk: neverDelivered,
      onVoiceCommand: neverDelivered,
      onCallWindowMoved: neverDelivered,
      onShowTask: neverDelivered,
      onAvatarSession: neverDelivered,
      onAvatarFeed: neverDelivered,
      onAvatarViewSignal: neverDelivered,
      onBrowserState: neverDelivered,
      onBrowserKey: neverDelivered,
      onBrowserFocus: neverDelivered,
    };
    const events: InProcessEvents = {
      onShowAgent: said.onShowAgent.emit,
      onShowInbox: said.onShowInbox.emit,
      onShowInboxItem: said.onShowInboxItem.emit,
      onShowFailedRun: said.onShowFailedRun.emit,
      onShowChat: said.onShowChat.emit,
      onAgentEnded: said.onAgentEnded.emit,
      onInboxItemOpened: said.onInboxItemOpened.emit,
      onRunFailed: said.onRunFailed.emit,
      onChatMessageWaiting: said.onChatMessageWaiting.emit,
      onShowLink: said.onShowLink.emit,
    };
    return { bridge, events };
  });
}
