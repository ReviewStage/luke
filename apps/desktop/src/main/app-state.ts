import { isDeepStrictEqual } from "node:util";
import { ACCOUNT_STATUS } from "@sidecar/credentials/snapshot";
import { EMPTY_APP_GUIDE } from "@sidecar/guide";
import { fixtureSnapshot } from "@sidecar/session/fixtures";
import type { AppState } from "#shared/messages/app-state";
import { MICROPHONE_STATUS } from "#shared/messages/audio";
import type { HostBootstrap } from "./gateway/host-operator";
import type { DesktopConfig } from "./services/desktop-config";
import { idleUpdateSnapshot } from "./update-service";

type AppStateSlice = Exclude<keyof AppState, "version">;

/**
 * One shallow slice replacement per key; a slice is replaced whole, never
 * merged field-wise. It lives here rather than beside the document because
 * the store is the one thing that patches one: a window is handed whole
 * snapshots.
 */
export type AppStatePatch = { readonly [Slice in AppStateSlice]?: AppState[Slice] };

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
 * The one path anything in main writes what it holds: a patch of whole
 * slices, dropped where it says nothing new, and one notification per
 * applied patch. Nothing else may hold a copy of a slice — a reader takes a
 * snapshot, which is the document as it stands.
 */
export class AppStateStore {
  #state: AppState;
  readonly #listeners = new Set<() => void>();

  constructor(initial: Omit<AppState, "version">) {
    this.#state = { ...initial, version: 0 };
  }

  snapshot(): AppState {
    return this.#state;
  }

  update(patch: AppStatePatch): void {
    const previous = this.#state;
    const moved = patchEntries(patch).filter(
      ([slice, value]) => !isDeepStrictEqual(previous[slice], value),
    );
    if (moved.length === 0) return;
    this.#state = {
      ...previous,
      ...Object.fromEntries(moved),
      version: previous.version + 1,
    };
    this.#announce();
  }

  /**
   * Re-announces the document exactly as it stands, without a version. It is
   * for the facts a window answers for and the document cannot — its mode and
   * the display it stands on — which move without any slice moving: the
   * snapshot a window is handed carries them, so a window whose own facts
   * changed has to be handed one again.
   */
  touch(): void {
    this.#announce();
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  #announce(): void {
    // A listener that patches in turn is applied and announced inside this
    // call, so nothing it wrote is lost; the copy is what lets it subscribe
    // or unsubscribe while the round is running.
    for (const listener of Array.from(this.#listeners)) listener();
  }
}

/**
 * One host bootstrap as a patch of this document. What each slice carries is
 * the host's own answer; the three readings of it are this client's. A run
 * that observes nothing is settled from the start. The trace gate is a fact
 * of the run rather than of the launch's arguments. And a halt outlives a
 * host read: the account it was raised for is going, the host still answers
 * `permitted` until its own change event lands, and only that event stands
 * the halt down.
 */
export function bootstrapPatch(held: AppState, boot: HostBootstrap): AppStatePatch {
  return {
    run: { ...held.run, agentTraceEnabled: boot.agentTraceEnabled },
    settings: boot.settings,
    account: boot.account,
    sessions: {
      roster: { sessions: boot.sessions },
      settled: !held.run.observesProviders || boot.sessionsSettled,
      workspaceProjects: boot.workspaceProjects,
    },
    calendars: boot.calendars,
    voice: held.voice,
    conversation: boot.conversationView,
    announcements: { held: boot.announcementsHeld },
    onboarding: { calendarOwed: boot.calendarOnboardingOwed },
    sessionReplay: { ...boot.sessionReplay, halted: held.sessionReplay.halted },
  };
}

/**
 * The document as a launch begins it: this process's own facts, and an empty
 * standing for everything the host has not answered yet. Nothing here reads
 * a device or the host — the first bootstrap and the events after it are
 * what fill the rest in.
 */
export function initialAppState(
  config: Pick<DesktopConfig, "launch" | "runMode" | "appVersion" | "packaged" | "platform">,
  installSupported: boolean,
): Omit<AppState, "version"> {
  const { launch, runMode } = config;
  return {
    run: {
      profile: launch.profile,
      packaged: config.packaged,
      platform: config.platform,
      appVersion: config.appVersion,
      captureMode: launch.captureMode,
      fixtureMode: launch.fixtureMode,
      fixture: fixtureSnapshot(launch.fixtureName ?? "smoke"),
      startPeeked: launch.startPeeked,
      startInSlot: launch.startInSlot,
      accountRequired: runMode.requiresAccount,
      observesProviders: runMode.observesProviders,
      agentTraceEnabled: false,
    },
    account: { status: ACCOUNT_STATUS.SIGNED_OUT },
    sessions: {
      roster: { sessions: [] },
      // A fixture run never observes and its sessions travel in the fixture
      // itself, so it is settled from the start.
      settled: !runMode.observesProviders,
      workspaceProjects: [],
    },
    calendars: [],
    update: idleUpdateSnapshot(config.appVersion, installSupported),
    audio: { microphoneStatus: MICROPHONE_STATUS.NOT_DETERMINED },
    hotkeys: { talkHeld: true },
    voice: {},
    brain: { runs: [] },
    // A run that sends nothing reads no Conversation, so its empty thread is settled from the start.
    conversation: { groups: [], settled: !runMode.sendsNetwork },
    announcements: { held: false },
    onboarding: { calendarOwed: false },
    // Nothing plays until the launch's own gate says so; the window service
    // is the one writer of this slice.
    introduction: { playing: false },
    sessionReplay: { permitted: runMode.sendsNetwork, halted: false },
    guide: EMPTY_APP_GUIDE,
  };
}
