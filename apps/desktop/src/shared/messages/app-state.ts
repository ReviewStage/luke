import type { BrainRequestSnapshot } from "@sidecar/brain/requests-wire";
import type { ObservedAccountCalendars } from "@sidecar/calendar/observation";
import type { AccountSnapshot } from "@sidecar/credentials/snapshot";
import type { LiveSessionPhase } from "@sidecar/gateway";
import type { AppGuideSnapshot } from "@sidecar/guide";
import type { SupersetSignInSnapshot } from "@sidecar/providers/superset/sign-in-stage";
import type { ConversationViewSnapshot, ObservedWorkspaceProject } from "@sidecar/session";
import type { FixtureSnapshot } from "@sidecar/session/fixtures";
import type { AppSettings } from "@sidecar/settings/wire";
import { isRecord, isWireNumber, isWireString, type UnparsedWireValue } from "@sidecar/wire";
import type { MicrophoneRoute, MicrophoneStatus, OutputAudioState } from "./audio";
import {
  type DisplayDiagnostic,
  type SessionReplayBootstrap,
  type SessionRosterPayload,
  WINDOW_ROLE,
  type WindowMode,
  type WindowRole,
} from "./session";
import type { UpdateSnapshot } from "./update";
import type { VoiceView } from "./voice-view";

/**
 * The launch profiles a window answers to. A capture run stages a
 * conversation it has no voice window for: Luke speaking, that with the
 * Mac's output off, and both speakers heard at once. Any other word — the
 * default included — stages nothing.
 */
export const RUN_PROFILE = {
  IDLE: "idle",
  SPEAKING: "speaking",
  MUTED: "muted",
  DUPLEX: "duplex",
} as const;

export type RunProfile = (typeof RUN_PROFILE)[keyof typeof RUN_PROFILE];

/**
 * What this launch is, as every window is told it and no event ever changes —
 * save the trace gate, which is the host's answer about this run rather than
 * the launch's own argument.
 */
interface AppRunFacts {
  /** The `--profile` argument as given, which is {@link RUN_PROFILE.IDLE} when absent. */
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

interface AppSessionsSlice {
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
  /**
   * The accelerator each key was registered as, absent where the system
   * refused one — a chord nothing can trigger must not be drawn as though it
   * works. Raw rather than labelled, because the panel draws the keys apart
   * and says the chord whole.
   */
  talk?: string;
  /**
   * Whether the talk key reports being let go of. Only a key that does can
   * hold a turn open for as long as it is down; the fallback can only toggle
   * one, and the panel says which of the two the developer actually has.
   */
  talkHeld: boolean;
  stop?: string;
}

interface AppVoiceSlice {
  /**
   * The live conversation as the voice window last reported it, so a panel
   * that opens mid-exchange draws the exchange rather than an idle voice.
   * Absent until that window has reported once, and always in a fixture or
   * capture run, which raises no voice window.
   *
   * The loudness beside it is deliberately not here. It is a reading taken
   * twenty times a second that expires in fifty milliseconds, so nothing
   * bootstraps from it and no version of this document could usefully carry
   * one: it travels on `app:voice-level-changed` as the stream it is.
   */
  view?: VoiceView;
  /**
   * Where the host's one live session stands, as its last change event said:
   * the phase, and the id once the provider named one. The voice window acts
   * on the change events themselves, since a repeated phase is an event a
   * version could not carry; this is what a panel may draw of it.
   */
  liveSession?: { sessionId?: string; phase: LiveSessionPhase };
}

interface AppSupersetSlice {
  installed: boolean;
  connected: boolean;
  signIn?: SupersetSignInSnapshot;
}

/**
 * The Conversation as the host's reads of the service compose it: the turn
 * groups of stored `UIMessage` rows the panel draws, whether a read has
 * landed, and the row the service could not read back where it named one.
 * The same on every display's panel, and the same on every Mac signed in to
 * the account, because the host reads it from the account's own record.
 */
type AppConversationSlice = ConversationViewSnapshot;

/**
 * What this run may record, as its two halves: what the host answered, and
 * whether an action that ended the account it files under has stood recording
 * down for the rest of the run.
 */
interface AppSessionReplaySlice {
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
 * here: they belong to the window they describe, the panels own them, and
 * they ride the snapshot a window is handed rather than the document.
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
  /**
   * Whether the one-time spoken introduction holds a panel, true from the
   * launch's own decision until the ending is taken. It is the takeover's
   * whole standing: what the panel draws on, what the talk key's keyless
   * claim is granted against, what the accountless mint is answered against,
   * and what every takeover-only report is validated against. There is no
   * second flag anywhere; a stale one would be a fullscreen surface nobody
   * can dismiss. The display it covers is deliberately not here — that is a
   * fact the window standing on it answers for, and it rides the snapshot.
   */
  introduction: { playing: boolean };
  sessionReplay: AppSessionReplaySlice;
  guide: AppGuideSnapshot;
}

/**
 * What one window answers for and the document cannot: which surface it
 * draws, how big it currently stands, and the display it stands on. Decided
 * in the main process by which window asked, never by anything a renderer
 * could claim about itself.
 */
export interface AppWindowFacts {
  role: WindowRole;
  mode: WindowMode;
  /** Absent for the hidden voice window, which stands on no display. */
  display?: DisplayDiagnostic;
}

/**
 * The document as one window is handed it: every slice, and that window's own
 * facts beside them. The first delivery is this window's bootstrap and every
 * later one carries a version at least as high, so there is no "which arrived
 * first" for a reader to answer.
 */
export type AppStateSnapshot = AppState & { window: AppWindowFacts };

const WINDOW_ROLES: ReadonlySet<string> = new Set(Object.values(WINDOW_ROLE));

/**
 * The boundary parse for a snapshot. What it can check is what the wire
 * cannot lie about cheaply and every reader depends on: the version that
 * orders deliveries, and the window facts that decide which surface draws at
 * all. The slices are read by the guards of the vocabularies they came from,
 * where a reader actually uses them.
 */
export function isAppStateSnapshot(value: UnparsedWireValue): boolean {
  if (!isRecord(value)) return false;
  if (!isWireNumber(value.version) || !Number.isInteger(value.version) || value.version < 0) {
    return false;
  }
  const window = value.window;
  return (
    isRecord(window) &&
    isWireString(window.role) &&
    WINDOW_ROLES.has(window.role) &&
    isWireString(window.mode)
  );
}

/** What this run may record, as the renderer is handed it. */
export function sessionReplayBootstrap(
  state: Pick<AppState, "run" | "sessionReplay">,
): SessionReplayBootstrap {
  return {
    permitted: state.sessionReplay.permitted && !state.sessionReplay.halted,
    appVersion: state.run.appVersion,
    ...(state.sessionReplay.accountId ? { accountId: state.sessionReplay.accountId } : undefined),
  };
}
