/**
 * app-state-store.ts -- the one document every window of a client is drawn from: the store that holds it, the push that carries it out, the patches that move it, and the projections a window is handed.
 */
import { ACCOUNT_STATUS } from "@luke/credentials/snapshot";
import { IDLE_TASKS_VIEW } from "@luke/features/tasks-view";
import type { HostCapability } from "@luke/settings";
import type { BuildCommit } from "@luke/settings/update";
import { MICROPHONE_STATUS } from "@luke/voice/audio";
import { AVATAR_OFF } from "@luke/voice/avatar";
import { NOTIFICATIONS_STATUS } from "@luke/voice/settings-controls";
import { type Context, Effect, Equal, type Scope, Stream, SubscriptionRef } from "effect";
import type { AppState, AppStateSnapshot } from "../app-state.js";
import type { HostBootstrap } from "../host-operator.js";
import type { RunMode } from "../run-mode.js";
import { idleUpdateSnapshot } from "../update-service.js";

type AppStateSlice = Exclude<keyof AppState, "version">;

/**
 * One shallow slice replacement per key; a slice is replaced whole, never
 * merged field-wise. It lives here rather than beside the document because
 * the store is the one thing that patches one: a window is handed whole
 * snapshots.
 */
type AppStatePatch = { readonly [Slice in AppStateSlice]?: AppState[Slice] };

/**
 * A patch's entries with the pairing its own type carries, which
 * `Object.entries` erases: every key of a patch is a slice of the document
 * and every value that slice's own.
 */
function patchEntries(patch: AppStatePatch): [AppStateSlice, AppState[AppStateSlice]][] {
  // SAFETY: `AppStatePatch` is a mapped type over `AppStateSlice`, so an entry of one can be nothing else.
  return Object.entries(patch) as [AppStateSlice, AppState[AppStateSlice]][];
}

/**
 * The one path anything in the client writes what it holds: a patch of whole
 * slices, dropped where it says nothing new, and one write of the resulting
 * document into the ref per applied patch. Nothing else may hold a copy of a
 * slice — a reader takes a snapshot, which is the document as it stands.
 *
 * The document itself is a `SubscriptionRef`, so its own `changes` Stream is
 * the one subscription a production caller forks to reach the windows.
 * `snapshot`, `update`, and `touch` are the synchronous face the rest of the
 * client still holds, each running its Ref operation under the launch's own
 * services — the context of the runtime the platform's entry disposes,
 * captured once at construction — rather than the empty context plain `Effect.runSync` stands
 * for, so a clock, a scheduler, or any other reference the launch set is the
 * one these writes run under. `runSyncWith` runs on the calling stack exactly
 * as it does without a context, and a `SubscriptionRef` read or write never
 * suspends, so the call still answers in the same turn its caller made it in.
 */
export class AppStateStore {
  readonly #ref: SubscriptionRef.SubscriptionRef<AppState>;
  readonly #services: Context.Context<never>;

  constructor(initial: Omit<AppState, "version">, services: Context.Context<never>) {
    this.#services = services;
    this.#ref = Effect.runSyncWith(services)(
      SubscriptionRef.make<AppState>({ ...initial, version: 0 }),
    );
  }

  snapshot(): AppState {
    return Effect.runSyncWith(this.#services)(SubscriptionRef.get(this.#ref));
  }

  update(patch: AppStatePatch): void {
    const previous = this.snapshot();
    // Note that `Equal.equals` remembers its answer per pair of objects, which
    // holds because a slice is replaced whole and never mutated in place.
    const moved = patchEntries(patch).filter(
      ([slice, value]) => !Equal.equals(previous[slice], value),
    );
    if (moved.length === 0) return;
    const next: AppState = {
      ...previous,
      ...Object.fromEntries(moved),
      version: previous.version + 1,
    };
    Effect.runSyncWith(this.#services)(SubscriptionRef.set(this.#ref, next));
  }

  /**
   * Re-announces the document exactly as it stands, without a version. It is
   * for the facts a window answers for and the document cannot — its mode and
   * the display it stands on — which move without any slice moving: the
   * snapshot a window is handed carries them, so a window whose own facts
   * changed has to be handed one again. The ref is set to its own current
   * value so `changes` re-announces it too, the same document under the same
   * version.
   */
  touch(): void {
    Effect.runSyncWith(this.#services)(SubscriptionRef.set(this.#ref, this.snapshot()));
  }

  /** The document's own change stream, direct from the ref, for the one production subscriber. */
  get changes(): Stream.Stream<AppState> {
    return SubscriptionRef.changes(this.#ref);
  }
}

/**
 * The one place the document becomes a push, for the client's scope: every
 * change of it is handed to `publish`. A push that throws is reported, to
 * Sentry as well as the line, rather than left to end the fiber: a `Stream.runForEach` that failed once would
 * never resume, and every later write would then reach no window for the rest
 * of the session.
 */
export function publishAppStateChanges(
  state: AppStateStore,
  publish: () => Effect.Effect<void>,
  report: (message: string) => void,
): Effect.Effect<void, never, Scope.Scope> {
  return Effect.asVoid(
    Effect.forkScoped(
      Stream.runForEach(state.changes, () =>
        Effect.catchDefect(Effect.withErrorReporting(publish(), { defectsOnly: true }), (defect) =>
          Effect.sync(() =>
            report(
              `the app-state push to windows failed: ${defect instanceof Error ? defect.message : String(defect)}`,
            ),
          ),
        ),
      ),
    ),
  );
}

/**
 * One host bootstrap as a patch of this document. What each slice carries is
 * the host's own answer; the readings of it are this client's. The trace gate
 * is a fact of the run rather than of the launch's arguments. And a halt
 * outlives a host read: the account it was raised for is going, the host
 * still answers `permitted` until its own change event lands, and only that
 * event stands the halt down.
 */
export function bootstrapPatch(held: AppState, boot: HostBootstrap): AppStatePatch {
  return {
    run: { ...held.run, agentTraceEnabled: boot.agentTraceEnabled },
    settings: boot.settings,
    account: boot.account,
    voice: held.voice,
    sessionReplay: { ...boot.sessionReplay, halted: held.sessionReplay.halted },
  };
}

/**
 * The document as the hidden voice window and the call window are sent it: the
 * whole of it but the task turns' work, as the task's work page projects
 * it and as its task conversation reads it. Note that both are kept from
 * those windows because they draw neither, and both carry the output of
 * commands run in the developer's repository and on the developer's Mac,
 * which nothing there needs.
 */
export function voiceWindowState<State extends Pick<AppState, "tasks">>(held: State): State {
  const { work: _work, conversation: _conversation, ...tasks } = held.tasks;
  return { ...held, tasks };
}

/** The document as the window that asked is to read it: the voice and call windows' as `voiceWindowState` leaves it, from their first read on, and a panel's whole. */
export function windowAppState<State extends Pick<AppState, "tasks">>(
  held: State,
  window: { readonly voice: boolean; readonly call: boolean },
): State {
  return window.voice || window.call ? voiceWindowState(held) : held;
}

/** Which window a document is handed to, as far as what it draws goes. */
interface WindowRole {
  readonly voice: boolean;
  readonly call: boolean;
}

/**
 * One slice as a window draws it. The voice and call windows draw the tasks
 * as `voiceWindowState` leaves them; and the voice window draws no voice view,
 * because that view is the one it reports itself (`reportVoiceView`), so a
 * view it sent is never handed back to it.
 */
function drawnSlice(snapshot: AppStateSnapshot, slice: keyof AppStateSnapshot, window: WindowRole) {
  if (slice === "tasks" && (window.voice || window.call)) return voiceWindowState(snapshot).tasks;
  if (slice === "voice" && window.voice) {
    const { view: _view, ...drawn } = snapshot.voice;
    return drawn;
  }
  return snapshot[slice];
}

/**
 * Whether a window last handed `sent` has anything new to draw in `next`: a
 * slice it draws, or its own facts. The version alone is not news, since a
 * reader keeps any delivery at least as new as the one it holds.
 */
function drawnMoved(sent: AppStateSnapshot, next: AppStateSnapshot, window: WindowRole): boolean {
  // SAFETY: `Object.keys` of a snapshot names its own slices, the window's facts, and its version.
  const slices = Object.keys(next) as (keyof AppStateSnapshot)[];
  return slices.some(
    (slice) =>
      slice !== "version" &&
      !Equal.equals(drawnSlice(sent, slice, window), drawnSlice(next, slice, window)),
  );
}

/**
 * The document as each window was last handed it, so a window is handed it
 * again only when a slice it draws, or its own facts, moved: the voice window
 * is not told of the view it just reported, and neither it nor the call
 * window of the task turns' work, which they are never sent. Note that a
 * window is held weakly, by the platform's handle on it, so a window that
 * goes takes its entry with it; and one that reloads reads the document on
 * its first read, so the entry its old page left skips nothing it needs.
 */
export class WindowAppStates<Window extends object> {
  readonly #sent = new WeakMap<Window, AppStateSnapshot>();

  /**
   * Hands `send` the window's own reading of `snapshot`, as `windowAppState`
   * projects it, unless nothing it draws moved since the last one it took;
   * `send` answers whether the window took it, which one with no stream open
   * does not.
   */
  offer(
    window: Window,
    role: WindowRole,
    snapshot: AppStateSnapshot,
    send: (shown: AppStateSnapshot) => boolean,
  ): void {
    const sent = this.#sent.get(window);
    if (sent !== undefined && !drawnMoved(sent, snapshot, role)) return;
    if (send(windowAppState(snapshot, role))) this.#sent.set(window, snapshot);
  }
}

/**
 * The voice slice once the voice window that reported its view is gone: no
 * view, since an idle voice is what every panel draws in its place, and the
 * avatar as it stood, since the panel holds the avatar rather than
 * that window.
 */
export function voiceWindowGone(held: AppState["voice"]): AppState["voice"] {
  return { avatar: held.avatar };
}

/** What a launch knows of itself before the host answers anything, which is the run slice's own facts. */
interface ClientRunFacts {
  readonly launch: {
    readonly profile: string;
    readonly captureMode: boolean;
    readonly fixtureMode: boolean;
  };
  readonly runMode: Pick<RunMode, "requiresAccount" | "sendsNetwork">;
  readonly appVersion: string;
  readonly commit?: BuildCommit;
  readonly packaged: boolean;
  readonly platform: string;
}

/**
 * The document as a launch begins it: this process's own facts, what the
 * platform offers, and an empty
 * standing for everything the host has not answered yet. Nothing here reads
 * a device or the host — the first bootstrap and the events after it are
 * what fill the rest in.
 */
export function initialAppState(
  config: ClientRunFacts,
  installSupported: boolean,
  capabilities: readonly HostCapability[],
): Omit<AppState, "version"> {
  const { launch, runMode } = config;
  return {
    run: {
      profile: launch.profile,
      packaged: config.packaged,
      platform: config.platform,
      capabilities,
      appVersion: config.appVersion,
      ...(config.commit ? { commit: config.commit } : undefined),
      captureMode: launch.captureMode,
      fixtureMode: launch.fixtureMode,
      accountRequired: runMode.requiresAccount,
      agentTraceEnabled: false,
    },
    account: { status: ACCOUNT_STATUS.SIGNED_OUT },
    update: idleUpdateSnapshot(config.appVersion, installSupported),
    audio: { microphoneStatus: MICROPHONE_STATUS.NOT_DETERMINED },
    hotkeys: { talkHeld: true },
    voice: { avatar: AVATAR_OFF },
    tasks: IDLE_TASKS_VIEW,
    codingAgents: { unseen: [] },
    inbox: { waiting: [], tasks: [], taskless: [], automations: [], failedRuns: [] },
    notifications: { status: NOTIFICATIONS_STATUS.UNKNOWN },
    network: { online: true },
    sessionReplay: { permitted: runMode.sendsNetwork, halted: false },
  };
}
