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
import { keepIdentity } from "@luke/wire";
import { type Context, Effect, type Scope, Stream, SubscriptionRef } from "effect";
import {
  type AppState,
  type AppStateSnapshot,
  type AppWindowFacts,
  NO_ACCESS,
} from "../app-state.js";
import { stagedCallState } from "../fixture-stage.js";
import type { HostBootstrap } from "../host-operator.js";
import type { RunMode } from "../run-mode.js";
import { idleUpdateSnapshot } from "../update-service.js";

type AppStateSlice = Exclude<keyof AppState, "version">;

/**
 * One shallow slice replacement per key; a slice is replaced whole, never
 * merged field-wise. It lives here rather than beside the document because
 * the store is the one thing that patches one: a window is handed what moved
 * in the document (`AppStateDelivery`), never a patch.
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
 * A slice that moved keeps the identity of every part of it that did not, so
 * a reader holding a part that said nothing new still holds the same object.
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
    // Note that a slice kept whole is one that says nothing new, which is the
    // one walk that both decides that and shares what did not move.
    const moved = patchEntries(patch).flatMap(([slice, value]) => {
      const kept = keepIdentity(previous[slice], value);
      return kept === previous[slice] ? [] : [[slice, kept] as const];
    });
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
    access: boot.access,
    voice: held.voice,
    sessionReplay: { ...boot.sessionReplay, halted: held.sessionReplay.halted },
  };
}

/** Which window a document is handed to, as far as what it draws goes. */
interface WindowRole {
  readonly voice: boolean;
  readonly call: boolean;
}

/**
 * The document as one window is handed it, its own facts beside it. The call
 * transcript reaches the panels alone, which draw it: the voice window
 * reports it and the call window draws no line of it. And the voice window
 * is handed no view, because the view is the one it reports itself
 * (`reportVoiceView`); what it reads of the voice slice is the avatar. Each
 * stream sends a window only what moved in what it is handed
 * (`push-procedures.ts`), so a caption the voice window reports reaches it
 * as nothing, and the call window as the view alone.
 */
export function windowAppState(
  held: AppState,
  role: WindowRole,
  window: AppWindowFacts,
): AppStateSnapshot {
  if (!role.voice && !role.call) return { ...held, window };
  const { callTranscript: _callTranscript, ...drawn } = held;
  return role.voice
    ? { ...drawn, voice: { avatar: held.voice.avatar }, window }
    : { ...drawn, window };
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

/**
 * The voice slice once the voice window has been given up on for the run:
 * gone as above, and voice unavailable until Luke is reopened, which every
 * panel says where it offers a call.
 */
export function voiceWindowGaveUp(held: AppState["voice"]): AppState["voice"] {
  return { ...voiceWindowGone(held), unavailable: true };
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
 * standing for everything the host has not answered yet, but the call a
 * call profile's fixture run stages (`fixture-stage.ts`). Nothing here reads
 * a device or the host — the first bootstrap and the events after it are
 * what fill the rest in.
 */
export function initialAppState(
  config: ClientRunFacts,
  installSupported: boolean,
  capabilities: readonly HostCapability[],
): Omit<AppState, "version"> {
  const { launch, runMode } = config;
  // A call profile's fixture run opens on its staged call, as no voice window reports one.
  const staged = stagedCallState(launch);
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
    access: NO_ACCESS,
    update: idleUpdateSnapshot(config.appVersion, installSupported),
    audio: { microphoneStatus: MICROPHONE_STATUS.NOT_DETERMINED },
    voice: staged?.voice ?? { avatar: AVATAR_OFF },
    tasks: staged?.tasks ?? IDLE_TASKS_VIEW,
    codingAgents: { unseen: [] },
    inbox: { waiting: [], tasks: [], taskless: [], automations: [], failedRuns: [] },
    macCommands: { asks: [] },
    notifications: { status: NOTIFICATIONS_STATUS.UNKNOWN },
    network: { online: true },
    sessionReplay: { permitted: runMode.sendsNetwork, halted: false },
    ...(staged === undefined ? undefined : { callTranscript: staged.callTranscript }),
  };
}
