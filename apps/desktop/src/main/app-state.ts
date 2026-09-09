import { isDeepStrictEqual } from "node:util";
import type { BrainRequestSnapshot } from "@sidecar/brain/requests-wire";
import type { ObservedAccountCalendars } from "@sidecar/calendar/observation";
import { ACCOUNT_STATUS, type AccountSnapshot } from "@sidecar/credentials/snapshot";
import { type AppGuideSnapshot, EMPTY_APP_GUIDE } from "@sidecar/guide";
import type { SupersetSignInSnapshot } from "@sidecar/providers/superset/sign-in-stage";
import type { ConversationEntry } from "@sidecar/realtime";
import type { ObservedWorkspaceProject } from "@sidecar/session";
import { type FixtureSnapshot, fixtureSnapshot } from "@sidecar/session/fixtures";
import type { AppSettings } from "@sidecar/settings/wire";
import type { MicrophoneRoute, MicrophoneStatus, OutputAudioState } from "#shared/messages/audio";
import { MICROPHONE_STATUS } from "#shared/messages/audio";
import type { SessionReplayBootstrap, SessionRosterPayload } from "#shared/messages/session";
import type { UpdateSnapshot } from "#shared/messages/update";
import type { VoiceView } from "#shared/messages/voice-view";
import type { DesktopConfig } from "./services/desktop-config";
import { idleUpdateSnapshot } from "./update-service";

/**
 * What this launch is, as every window is told it and no event ever changes —
 * save the trace gate, which is the host's answer about this run rather than
 * the launch's own argument.
 */
export interface AppRunFacts {
  profile: string;
  packaged: boolean;
  platform: string;
  appVersion: string;
  captureMode: boolean;
  fixtureMode: boolean;
  fixture: FixtureSnapshot;
  startPeeked: boolean;
  startInSlot: boolean;
  accountRequired: boolean;
  observesProviders: boolean;
  agentTraceEnabled: boolean;
}

export interface AppSessionsSlice {
  roster: SessionRosterPayload;
  /**
   * Whether the roster reflects a reading Luke actually took. A run that
   * observes nothing is settled from the start, so an empty list can say
   * "nothing to watch" rather than "not looked yet".
   */
  settled: boolean;
  workspaceProjects: readonly ObservedWorkspaceProject[];
}

export interface AppAudioSlice {
  microphoneStatus: MicrophoneStatus;
  microphoneRoute?: MicrophoneRoute;
  outputAudio?: OutputAudioState;
}

export interface AppHotkeysSlice {
  talk?: string;
  talkHeld: boolean;
  ask?: string;
  stop?: string;
}

export interface AppVoiceSlice {
  view?: VoiceView;
  level: number;
  /** The receiver epoch the host minted for this attachment; the voice window alone is told it. */
  epoch?: number;
}

export interface AppSupersetSlice {
  installed: boolean;
  connected: boolean;
  signIn?: SupersetSignInSnapshot;
}

export interface AppConversationSlice {
  entries: readonly ConversationEntry[];
  cleared: boolean;
}

/**
 * What this run may record, as its two halves: what the host answered, and
 * whether an act that ended the account it files under has stood recording
 * down for the rest of the run.
 */
export interface AppSessionReplaySlice {
  permitted: boolean;
  accountId?: string;
  halted: boolean;
}

/**
 * Everything main keeps of what the host tells it and what this machine
 * answers for itself: one document, read whole and replaced a slice at a
 * time, so the state a window is handed and the state main answers a call
 * from cannot differ.
 *
 * Per-window facts — the mode, the display, the role — are deliberately not
 * here: they belong to the window they describe, and the panels own them.
 */
export interface AppState {
  /** 0 before any patch; +1 per applied patch, monotone and never reset. */
  readonly version: number;
  run: AppRunFacts;
  settings?: AppSettings;
  account: AccountSnapshot;
  sessions: AppSessionsSlice;
  calendars: readonly ObservedAccountCalendars[];
  superset: AppSupersetSlice;
  update: UpdateSnapshot;
  audio: AppAudioSlice;
  hotkeys: AppHotkeysSlice;
  voice: AppVoiceSlice;
  brain: { runs: readonly BrainRequestSnapshot[] };
  conversation: AppConversationSlice;
  announcements: { held: boolean };
  onboarding: { calendarOwed: boolean };
  sessionReplay: AppSessionReplaySlice;
  guide: AppGuideSnapshot;
}

export type AppStateSlice = Exclude<keyof AppState, "version">;

/** One shallow slice replacement per key; a slice is replaced whole, never merged field-wise. */
export type AppStatePatch = { readonly [Slice in AppStateSlice]?: AppState[Slice] };

/**
 * What rides a patch rather than the document: the opaque reporter of the
 * window whose own write produced the change, so the fan-out can skip
 * echoing it back to the window that already drew it.
 */
export interface AppStateUpdateMeta {
  reporter?: string;
}

/**
 * One applied patch. `previous` travels beside `state` because a slice can
 * feed more than one channel: the fan-out decides per channel what actually
 * moved rather than re-sending a slice's every reader.
 */
export interface AppStateChange {
  readonly state: AppState;
  readonly previous: AppState;
  readonly changed: ReadonlySet<AppStateSlice>;
  readonly reporter?: string;
}

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
  readonly #listeners = new Set<(change: AppStateChange) => void>();

  constructor(initial: Omit<AppState, "version">) {
    this.#state = { ...initial, version: 0 };
  }

  snapshot(): AppState {
    return this.#state;
  }

  update(patch: AppStatePatch, meta?: AppStateUpdateMeta): AppStateChange | undefined {
    const previous = this.#state;
    const moved = patchEntries(patch).filter(
      ([slice, value]) => !isDeepStrictEqual(previous[slice], value),
    );
    if (moved.length === 0) return undefined;
    this.#state = {
      ...previous,
      ...Object.fromEntries(moved),
      version: previous.version + 1,
    };
    const change: AppStateChange = {
      state: this.#state,
      previous,
      changed: new Set(moved.map(([slice]) => slice)),
      ...(meta?.reporter !== undefined ? { reporter: meta.reporter } : undefined),
    };
    // A listener that patches in turn is applied and announced inside this
    // call, so nothing it wrote is lost; the copy is what lets it subscribe
    // or unsubscribe while the round is running.
    for (const listener of Array.from(this.#listeners)) listener(change);
    return change;
  }

  subscribe(listener: (change: AppStateChange) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }
}

/** What this run may record, as the renderer is handed it. */
export function sessionReplayBootstrap(state: AppState): SessionReplayBootstrap {
  return {
    permitted: state.sessionReplay.permitted && !state.sessionReplay.halted,
    appVersion: state.run.appVersion,
    ...(state.sessionReplay.accountId ? { accountId: state.sessionReplay.accountId } : undefined),
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
    superset: { installed: false, connected: false },
    update: idleUpdateSnapshot(config.appVersion, installSupported),
    audio: { microphoneStatus: MICROPHONE_STATUS.NOT_DETERMINED },
    hotkeys: { talkHeld: true },
    voice: { level: 0 },
    brain: { runs: [] },
    conversation: { entries: [], cleared: false },
    announcements: { held: false },
    onboarding: { calendarOwed: false },
    sessionReplay: { permitted: runMode.sendsNetwork, halted: false },
    guide: EMPTY_APP_GUIDE,
  };
}
