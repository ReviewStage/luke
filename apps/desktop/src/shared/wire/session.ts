import type { AccountSnapshot } from "@sidecar/account/snapshot";
import type { SessionNoticeAsk } from "@sidecar/attention";
import type { ObservedAccountCalendars } from "@sidecar/calendar/observation";
import type { FixtureSnapshot } from "@sidecar/fixtures";
import type { TrackedIssue } from "@sidecar/issues";
import type { IssueToolAction } from "@sidecar/realtime";
import type { NormalizedSession, ObservedWorkspaceProject } from "@sidecar/session";
import type { Rectangle, ResolvedNotchGeometry, WindowMode } from "@sidecar/surface";
import type { MicrophoneStatus, OutputAudioState } from "./audio";
import type { AppSettings } from "./settings";
import type { UpdateSnapshot } from "./update";

export {
  isWorkspaceProviderId,
  SUPERSET_WORKSPACE_PROVIDER_ID,
  type WorkspaceProviderId,
} from "@sidecar/session";
export {
  SUPERSET_SIGN_IN_STAGE,
  type SupersetOrganizationChoice,
  type SupersetSignInSnapshot,
} from "@sidecar/superset/sign-in-stage";
export type { WindowMode } from "@sidecar/surface";

/**
 * What became of a request to open a session. Opening is a local act — the
 * session's address is handed to the operating system, never to a provider —
 * so the answer is the app's own: opened, refused by the system, or
 * unsupported because the session never reported an address. A pressed row
 * ignores the answer; a spoken ask says it aloud, and grounding that sentence
 * is why this is answered at all.
 */
export const SESSION_OPEN_RESULT_STATUS = {
  OPENED: "opened",
  REJECTED: "rejected",
  UNSUPPORTED: "unsupported",
} as const;

export type SessionOpenResultStatus =
  (typeof SESSION_OPEN_RESULT_STATUS)[keyof typeof SESSION_OPEN_RESULT_STATUS];

export type SessionOpenResult =
  | { status: typeof SESSION_OPEN_RESULT_STATUS.OPENED }
  | { status: typeof SESSION_OPEN_RESULT_STATUS.REJECTED; reason: string }
  | { status: typeof SESSION_OPEN_RESULT_STATUS.UNSUPPORTED };

/**
 * What became of a request to read a session's transcript. Reading is a local
 * act like opening — nothing reaches a provider — and the rendering rides the
 * answer so the conversation that asked can ground its reply in the session's
 * own words. Every refusal carries words Luke can say aloud.
 */
export const SESSION_TRANSCRIPT_RESULT_STATUS = {
  READ: "read",
  REJECTED: "rejected",
  UNSUPPORTED: "unsupported",
} as const;

export type SessionTranscriptResult =
  | { status: typeof SESSION_TRANSCRIPT_RESULT_STATUS.READ; transcript: string }
  | { status: typeof SESSION_TRANSCRIPT_RESULT_STATUS.REJECTED; reason: string }
  | { status: typeof SESSION_TRANSCRIPT_RESULT_STATUS.UNSUPPORTED; reason: string };

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
   * nothing, and false with no account, because a recording filed under
   * nobody could be neither joined to its counts nor erased with them.
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
   * deleting the account erase the recordings with it.
   */
  accountId?: string;
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
  /** Whether Superset's bundled CLI exists on this Mac. */
  supersetInstalled: boolean;
  /** Whether that CLI also has its own login configuration. */
  supersetConnected: boolean;
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
  sessions: readonly NormalizedSession[];
  /**
   * Whether `sessions` reflects a roster Luke has actually read. False only
   * while a live run's first observation pass is still on its way, so an
   * empty list can say "not looked yet" rather than "nothing to watch"; every
   * later reading arrives over `onSessionsChanged`, whose first delivery is
   * itself the settling signal.
   */
  sessionsSettled: boolean;
  /**
   * The standing asks the developer has made about sessions, so a panel that
   * opens late still marks the rows Luke is listening for. The words are the
   * developer's own and never a provider's.
   */
  noticeAsks: readonly SessionNoticeAsk[];
  /** Where a new workspace can be created, as the adapters currently offer it. */
  workspaceProjects: readonly ObservedWorkspaceProject[];
  /** Absent while no issue tracker is connected, which is its own answer. */
  issues?: readonly TrackedIssue[];
  /** Each connected account's calendars, as last observed. */
  calendars: readonly ObservedAccountCalendars[];
  /** Whether the calendar's quiet is holding announcements right now. */
  meetingQuiet: boolean;
  /** Whether, where, and for whom this run may record its own surface. */
  sessionReplay: SessionReplayBootstrap;
  settings: AppSettings;
}

/** One validated issue act on its way to the main process. */
export type IssueActionAsk = Extract<IssueToolAction, { kind: "issue-state" | "issue-comment" }>;
