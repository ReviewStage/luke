import type { AccountSnapshot } from "@sidecar/account/snapshot";
import type { RememberedFact } from "@sidecar/acts";
import type { ObservedAccountCalendars } from "@sidecar/calendar/observation";
import type { InteractiveSignInSnapshot } from "@sidecar/credentials/interactive-sign-in";
import type { ConnectionId } from "@sidecar/credentials/vocabulary";
import type { FixtureSnapshot } from "@sidecar/fixtures";
import type { TrackedIssue } from "@sidecar/issues";
import type { ConversationEntry, IssueToolAction } from "@sidecar/realtime";
import type { ObservedWorkspaceProject, Session, SessionAttentionEntry } from "@sidecar/session";
import type { Rectangle, ResolvedNotchGeometry, WindowMode } from "@sidecar/surface";
import type { ACT_RESULT_STATUS, ActResult } from "@sidecar/wire";
import type { MicrophoneStatus, OutputAudioState } from "./audio";
import type { AppSettings } from "./settings";
import type { UpdateSnapshot } from "./update";

export {
  INTERACTIVE_SIGN_IN_STAGE,
  type InteractiveSignInScope,
  type InteractiveSignInSnapshot,
} from "@sidecar/credentials/interactive-sign-in";
export {
  isWorkspaceProviderId,
  SUPERSET_WORKSPACE_PROVIDER_ID,
  type WorkspaceProviderId,
  workspaceProviderDisplayName,
} from "@sidecar/session";

/** One CLI login flow's state, named by the connection it belongs to. */
export interface ProviderSignInChange {
  providerId: ConnectionId;
  state: InteractiveSignInSnapshot;
}

/**
 * What became of a press on an interactive sign-in: the flow's new state, or
 * unsupported for a connection that has no such sign-in to run.
 */
export type ProviderSignInResult =
  | { status: typeof ACT_RESULT_STATUS.ACCEPTED; snapshot: InteractiveSignInSnapshot }
  | { status: typeof ACT_RESULT_STATUS.UNSUPPORTED; reason: string };
export type { WindowMode } from "@sidecar/surface";

/**
 * What became of a request to open a session. Opening is a local act — the
 * session's address is handed to the operating system, never to a provider —
 * so the answer is the app's own: opened, refused by the system, or
 * unsupported because the session never reported an address. A pressed row
 * ignores the answer; a spoken ask says it aloud, and grounding that sentence
 * is why this is answered at all.
 */
export type SessionOpenResult = ActResult;

/**
 * What became of a request to read a session's transcript. Reading is a local
 * act like opening — nothing reaches a provider — and the rendering rides the
 * answer so the conversation that asked can ground its reply in the session's
 * own words. Every refusal carries words Luke can say aloud.
 */
export type SessionTranscriptResult =
  | { status: typeof ACT_RESULT_STATUS.ACCEPTED; transcript: string }
  | { status: typeof ACT_RESULT_STATUS.REJECTED; reason: string }
  | { status: typeof ACT_RESULT_STATUS.UNSUPPORTED; reason: string };

/**
 * Which surface a window exists to draw. Every window loads the same renderer
 * bundle, so the role is what tells the one fullscreen introduction takeover
 * apart from the panel windows — decided in the main process by which window
 * asked, never by anything the renderer could claim about itself.
 */
export const WINDOW_ROLE = {
  PANEL: "panel",
  INTRODUCTION: "introduction",
} as const;

export type WindowRole = (typeof WINDOW_ROLE)[keyof typeof WINDOW_ROLE];

export interface DisplayDiagnostic {
  id: number;
  label: string;
  bounds: Rectangle;
  workArea: Rectangle;
  scaleFactor: number;
  notch: ResolvedNotchGeometry;
}

/**
 * How screen recording is armed, decided in the main process and handed over
 * at bootstrap and again on every account transition.
 *
 * It carries what the renderer cannot work out for itself and nothing else.
 * The two switches are not here: the renderer already holds `shareUsageData`
 * and `sessionReplay` and is told the moment either moves, so reading them
 * live is what lets a switch turned off stop a recording where it stands —
 * and a switch turned back on start one — rather than at the next launch.
 * Where a recording goes is not here either: the processor's address is fixed
 * by the build, in the renderer beside the connect policy that names it.
 */
export interface SessionReplayBootstrap {
  /**
   * Whether this run may record at all, whatever the switches say. False for
   * a fixture and a capture run, which must stay deterministic and send
   * nothing, and false for the rest of a run in which an account was deleted.
   * Being signed out is not one of the reasons: recording begins at the first
   * paint, before an account exists.
   */
  permitted: boolean;
  /**
   * This build's own version, for the recorder to file what it sends under.
   * It rides here rather than on a channel of its own because the renderer
   * has no way to read it: the bundle is written once and the version is a
   * fact of the packaged app around it.
   */
  appVersion: string;
  /**
   * The account's opaque id, absent while signed out. It is the same id the
   * hosted endpoints resolve a bearer token to, so a recording lands on the
   * person the counted events already belong to — which is also what makes
   * deleting the account erase the recordings with it. A recording that runs
   * while this is absent is anonymous, joined to the person if a sign-in
   * lands during it and to nobody if none ever does.
   */
  accountId?: string;
}

/**
 * The conversation history as every panel window shares it. A voice exchange
 * lands on one window — the primary display hosts the talk key and the
 * announcements, a typed ask lands on the panel it was typed into — so the
 * thread is relayed through the main process for every other display's
 * History to draw the same. `cleared` marks the relay of a Clear pressed on
 * another display, which retires the receiving window's in-flight turns the
 * way its own press would; an ordinary report replaces the thread and
 * retires nothing.
 */
export interface ConversationHistoryPayload {
  entries: readonly ConversationEntry[];
  cleared: boolean;
}

export interface AppBootstrap {
  mode: WindowMode;
  /** Capture-only: start drawn as the peek, which normally needs a pointer. */
  startPeeked: boolean;
  /** Capture-only: start drawn as the key slot, which normally needs a press. */
  startInSlot: boolean;
  profile: string;
  fixture: FixtureSnapshot;
  captureMode: boolean;
  /** True when `--fixture` (or a capture run) makes the panel render fixture sessions. */
  fixtureMode: boolean;
  /**
   * Whether this run records the development trace, so the conversation taps
   * the wire only while a writer actually stands behind the bridge. False on
   * every packaged run by construction.
   */
  agentTraceEnabled: boolean;
  /** False for fixture and capture runs, which must stay deterministic. */
  accountRequired: boolean;
  account: AccountSnapshot;
  packaged: boolean;
  platform: string;
  electronVersion: string;
  chromiumVersion: string;
  nodeVersion: string;
  microphoneStatus: MicrophoneStatus;
  /**
   * The accelerator the talk key was registered as, absent when the system
   * refused to register one — a shortcut nothing can trigger must not be shown
   * as though it works. Raw rather than labelled for the ask key's reason
   * below: the renderer draws the keys apart and says the chord whole.
   */
  voiceHotkey?: string;
  /**
   * Whether that key reports being let go of. Only a key that does can hold a
   * turn open for as long as it is down; the fallback can only toggle one, and
   * the panel says which of the two the user actually has.
   */
  voiceHotkeyHeld: boolean;
  /**
   * The accelerator that summons the ask field from any app, absent when the
   * system refused every candidate. The raw accelerator rather than a label,
   * because the renderer needs both spellings: the keycaps' ⌥ and L, drawn as
   * the two keys they are, and aria's Alt+L.
   */
  askHotkey?: string;
  /**
   * The accelerator that stops a reply mid-sentence from any app, absent when
   * the system refused it or another Luke key sits on its chord. Raw for the
   * same reason the other two are.
   */
  stopHotkey?: string;
  /**
   * The output's switches as last read, absent until the helper's first line
   * arrives — or forever, where there is no helper to ask.
   */
  outputAudio?: OutputAudioState;
  display: DisplayDiagnostic;
  /** Where the app stands against the latest release, as last learned. */
  update: UpdateSnapshot;
  sessionRoster: SessionRosterPayload;
  /**
   * Whether `sessions` reflects a roster Luke has actually read. False only
   * while a live run's first observation pass is still on its way, so an
   * empty list can say "not looked yet" rather than "nothing to watch"; every
   * later reading arrives over `onSessionsChanged`, whose first delivery is
   * itself the settling signal.
   */
  sessionsSettled: boolean;
  /** Where a new workspace can be created, as the adapters currently offer it. */
  workspaceProjects: readonly ObservedWorkspaceProject[];
  /** Absent while no issue tracker is connected, which is its own answer. */
  issues?: readonly TrackedIssue[];
  /** Each connected account's calendars, as last observed. */
  calendars: readonly ObservedAccountCalendars[];
  /** Whether announcements are held right now, by the pause switch or a meeting's quiet. */
  announcementsHeld: boolean;
  /**
   * The conversation thread as the last launch left it, already retained.
   * Only the recent slice reaches a model; the rest is shared across every
   * display's panel, so History opens where the developer left it.
   * Empty in a fixture or capture run, which reads no thread and writes none.
   */
  conversationHistory: readonly ConversationEntry[];
  /** Luke's bounded durable facts about the developer. Empty in fixture and capture runs. */
  rememberedFacts: readonly RememberedFact[];
  /**
   * Whether the mandatory calendar step of onboarding still stands: this
   * install's first sign-in has been observed and no calendar has connected
   * since. The panel gates on it only while signed in.
   */
  calendarOnboardingOwed: boolean;
  /** Whether, where, and for whom this run may record its own surface. */
  sessionReplay: SessionReplayBootstrap;
  settings: AppSettings;
}

/** The complete session state one observation revision publishes to a desktop surface. */
export interface SessionRosterPayload {
  sessions: readonly Session[];
  attention: readonly SessionAttentionEntry[];
}

/** One validated issue act on its way to the main process. */
export type IssueActionAsk = Extract<IssueToolAction, { kind: "issue-state" | "issue-comment" }>;
