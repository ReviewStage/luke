import type {
  AttentionRequestResult,
  AttentionSpeech,
  FixtureSnapshot,
  HostedUsageAnswer,
  IssueToolAction,
  NormalizedSession,
  ObservedWorkspaceProject,
  PanelFormFactor,
  ProviderControlResult,
  ProviderId,
  ProviderMessageResult,
  ProviderWorkspaceResult,
  RealtimeConnection,
  RealtimeDiagnostics,
  RealtimeVoice,
  RealtimeVoiceSpeed,
  Rectangle,
  ResolvedNotchGeometry,
  SessionIdentity,
  SessionNoticeAsk,
  TrackedIssue,
  TrackerActionResult,
  WindowMode,
  WorkspaceAgentSelection,
} from "@sidecar/core";
import type { CredentialProviderId } from "./credential-providers";
import type { FeedbackKind, FeedbackResult, FeedbackSubmission } from "./feedback";

export type { WindowMode } from "@sidecar/core";

export const ACCOUNT_PROVIDER = {
  GOOGLE: "google",
  GITHUB: "github",
} as const;

export type AccountProvider = (typeof ACCOUNT_PROVIDER)[keyof typeof ACCOUNT_PROVIDER];

export const ACCOUNT_STATUS = {
  SIGNED_OUT: "signed-out",
  SIGNING_IN: "signing-in",
  SIGNED_IN: "signed-in",
} as const;

/** Renderer-safe identity. OAuth tokens never cross the preload boundary. */
export type AccountSnapshot =
  | { status: typeof ACCOUNT_STATUS.SIGNED_OUT }
  | { status: typeof ACCOUNT_STATUS.SIGNING_IN }
  | {
      status: typeof ACCOUNT_STATUS.SIGNED_IN;
      email: string;
      name?: string;
      /**
       * The provider's own avatar for the signed-in user, kept only when it
       * lives on a host this build pins in the renderer's image policy.
       */
      pictureUrl?: string;
      provider: AccountProvider;
    };

export type MicrophoneStatus = "not-determined" | "granted" | "denied" | "restricted" | "unknown";

/** Where a credential was resolved from, without ever exposing the credential. */
export const CREDENTIAL_SOURCE = {
  NONE: "none",
  ENVIRONMENT: "environment",
  ENCRYPTED_FILE: "encrypted-file",
} as const;

export type CredentialSource = (typeof CREDENTIAL_SOURCE)[keyof typeof CREDENTIAL_SOURCE];

/**
 * Whether Luke can store a credential through OS-provided encryption. Asking is
 * not free: on macOS the answer comes from the Keychain, and reading it is what
 * raises the permission dialog. Nobody who has never stored a key has any
 * reason to see that dialog, so the question goes unasked until a key is
 * actually being stored, and until then the answer is `UNKNOWN` rather than a
 * guess in either direction.
 */
export const SECRET_STORAGE = {
  UNKNOWN: "unknown",
  AVAILABLE: "available",
  UNAVAILABLE: "unavailable",
} as const;

export type SecretStorage = (typeof SECRET_STORAGE)[keyof typeof SECRET_STORAGE];

/**
 * One connected Google Calendar account as a renderer may know it: which
 * account, and which of its calendars the user chose to count. The grant
 * behind it stays in the main process, like every credential.
 */
export interface CalendarAccount {
  /** The account's primary calendar id — its address, which is its name. */
  id: string;
  selectedCalendarIds: readonly string[];
}

/** One calendar as its account's list names it, for a settings row. */
export interface AccountCalendar {
  id: string;
  label: string;
  /** The calendar's own colour as Google lists it, when it sent a sound one. */
  color?: string;
}

/** The calendars one account offered on the latest observation pass. */
export interface ObservedAccountCalendars {
  accountId: string;
  calendars: readonly AccountCalendar[];
}

/**
 * What each plain preference is until the user chooses otherwise. The store
 * falls back to these when the settings file has never said, and the app
 * guide carries the same values so a spoken ask for "the default" names a
 * real one — stated once so the two can never drift. The voice, pace, and
 * form factor keep their defaults beside their own types in `@sidecar/core`,
 * and the three keys' defaults live with the registrar that owns them.
 */
/**
 * The two credentials Luke can speak and review sessions on. Both paths reach
 * OpenAI in the end; what differs is whose account pays and whether anything
 * passes through Luke's service on the way.
 *
 * The account is free and metered daily; the key is the developer's own,
 * unmetered, billed to them by OpenAI, and never touches Luke's service. A
 * stored choice is what lets a key stay stored while the free allowance is
 * being spent — without one, connecting a key would be the choice, and the
 * only way back would be deleting it.
 */
export const VOICE_SOURCE = {
  ACCOUNT: "account",
  KEY: "key",
} as const;

export type VoiceSource = (typeof VOICE_SOURCE)[keyof typeof VOICE_SOURCE];

/** Guards the source an IPC message carries, which the renderer chooses. */
export function isVoiceSource(value: unknown): value is VoiceSource {
  return value === VOICE_SOURCE.ACCOUNT || value === VOICE_SOURCE.KEY;
}

export const APP_SETTING_DEFAULTS = {
  showInDock: false,
  showInMenuBar: true,
  voiceCaptions: false,
  duckOtherMedia: true,
  preferBuiltInMicrophone: true,
  quietDuringMeetings: true,
  showOnAllDisplays: false,
} as const satisfies Partial<Record<keyof AppSettings, boolean>>;

/**
 * The groups of preferences a reset control returns to their defaults, each
 * scoped to exactly the rows the control stands over: a settings page, or the
 * Workspaces group on the Connections page. A fixed vocabulary rather than a
 * field list on the wire, so a renderer can only ever name a grouping this
 * build documents — and no scope reaches a credential, an account, or the
 * Conductor agent pairing, whose own row already offers its default.
 */
export const SETTINGS_RESET_SCOPE = {
  VOICE: "voice",
  APPEARANCE: "appearance",
  SHORTCUTS: "shortcuts",
  WORKSPACES: "workspaces",
} as const;

export type SettingsResetScope = (typeof SETTINGS_RESET_SCOPE)[keyof typeof SETTINGS_RESET_SCOPE];

const SETTINGS_RESET_SCOPE_LIST: readonly SettingsResetScope[] =
  Object.values(SETTINGS_RESET_SCOPE);

export function isSettingsResetScope(value: unknown): value is SettingsResetScope {
  return SETTINGS_RESET_SCOPE_LIST.includes(value as SettingsResetScope);
}

/**
 * Where the app stands against the latest published release, as last learned.
 * `UNKNOWN` is the state before any check has answered — at launch, and
 * forever in a run that sends no network — and must be drawn as an offer to
 * check rather than as an answer.
 */
export const UPDATE_STATUS = {
  UNKNOWN: "unknown",
  CHECKING: "checking",
  UP_TO_DATE: "up-to-date",
  UPDATE_AVAILABLE: "update-available",
  UNREACHABLE: "unreachable",
} as const;

export type UpdateStatus = (typeof UPDATE_STATUS)[keyof typeof UPDATE_STATUS];

/**
 * What the update row draws from. The latest version travels only on the one
 * state that learned it, and no address ever travels: the page an update is
 * fetched from is fixed in the main process, so nothing a check read can
 * steer where a press goes.
 */
export type UpdateSnapshot =
  | { status: typeof UPDATE_STATUS.UNKNOWN; currentVersion: string }
  | { status: typeof UPDATE_STATUS.CHECKING; currentVersion: string }
  | { status: typeof UPDATE_STATUS.UP_TO_DATE; currentVersion: string }
  | {
      status: typeof UPDATE_STATUS.UPDATE_AVAILABLE;
      currentVersion: string;
      latestVersion: string;
    }
  | { status: typeof UPDATE_STATUS.UNREACHABLE; currentVersion: string };

/** Renderer-safe settings. Credentials are never sent to a renderer. */
export interface AppSettings {
  /** Where each provider's key comes from, keyed by provider id. */
  credentialSources: Readonly<Record<CredentialProviderId, CredentialSource>>;
  /**
   * Luke stores credentials only through OS-provided encryption. When that is
   * known to be unavailable the app says so rather than falling back to
   * plaintext storage; while it is unknown the app says nothing about it.
   */
  secretStorage: SecretStorage;
  /**
   * Whether a Realtime credential could actually be minted: a key resolved, and
   * this run will use it. It travels with the settings rather than only with
   * bootstrap because storing the key is what turns voice on — the reply to that
   * save, and the broadcast beside it, are how every panel learns it, and how
   * they learn a deleted key turned it back off.
   */
  voiceAvailable: boolean;
  /**
   * Which credential Luke actually speaks and reviews sessions on right now,
   * resolved rather than stored: the choice the user made where it can be
   * honoured, and what is available where it cannot. The panel draws its
   * toggle from this, so what is marked in use is always what a press of the
   * talk key would really spend.
   */
  voiceSource: VoiceSource;
  /**
   * Whether this build can offer the Google Calendar sign-in: an OAuth client
   * registered and usable this run. Without one the integration is not drawn
   * at all — a row whose one act cannot run is not a row.
   */
  calendarSignInAvailable: boolean;
  /**
   * The connected Google Calendar accounts, each with the calendars the user
   * chose to count. Empty until a sign-in lands one.
   */
  calendarAccounts: readonly CalendarAccount[];
  /**
   * Whether Luke stands in the Dock as well as at the notch. Off by default:
   * an accessory app is what Luke ships as, so an icon among the user's apps
   * is opted into rather than discovered.
   */
  showInDock: boolean;
  /**
   * Whether Luke stands in the menu bar as well as at the notch. Hiding the
   * status item costs nothing it alone provides — Settings and Quit are both in
   * the panel — so the choice is the user's to make and to keep.
   */
  showInMenuBar: boolean;
  /**
   * The voice Luke speaks with, as the settings resolve it: the one the user
   * chose, else the launch environment's, else the default — so the panel
   * marks the voice that would actually be heard, not just a stored value.
   */
  voice: RealtimeVoice;
  /**
   * The pace Luke speaks at, resolved the same way as the voice: the one the
   * user chose, else the launch environment's, else the natural rate.
   */
  voiceSpeed: RealtimeVoiceSpeed;
  /**
   * Whether Luke's words are captioned on screen while he speaks. Off by
   * default: the voice experience ships as sound, and words drawn under the
   * housing all day are something to opt into rather than discover.
   */
  voiceCaptions: boolean;
  /**
   * The talk-key chord the user chose, absent while the defaults stand. This
   * is the stored choice rather than the registered key — the two differ when
   * another app owns the chosen chord — so it says only whether there is a
   * choice to reset, and the row keeps showing the key that actually answers.
   */
  voiceHotkey?: string;
  /**
   * The ask-key chord the user chose, absent while the defaults stand. The
   * stored choice on the talk key's exact terms: the registered key is what
   * the row shows, and this only says whether there is a choice to reset.
   */
  askHotkey?: string;
  /**
   * The stop-key chord the user chose, on the same terms as the other two:
   * only whether there is a choice to reset, never the key the row shows.
   */
  stopHotkey?: string;
  /**
   * Whether Music and Spotify are turned down while a spoken exchange is
   * live, and back up after. On by default: speech over music is the failure
   * everyone has had, and the duck defers to the user everywhere it can — it
   * touches only a player that was playing, and a volume moved by hand during
   * the duck is left where the hand put it.
   */
  duckOtherMedia: boolean;
  /**
   * Whether a press listens through the Mac's own microphone when the system
   * input is a Bluetooth headset. On by default: capturing from a headset's
   * microphone pulls the whole headset onto its call codec, so everything it
   * plays turns phone-grade for the exchange. Off means the system default is
   * used exactly as chosen. A shut lid keeps the headset microphone either
   * way, because a muffled question is worse than a degraded song.
   */
  preferBuiltInMicrophone: boolean;
  /**
   * Whether announcements wait out the user's meetings. While the connected
   * calendar shows a meeting on, a session's spoken notices are held and read
   * out together once it ends. On by default: speaking into a meeting is the
   * failure connecting a calendar exists to prevent, and the switch is what
   * keeps the calendar readable without the quiet. It changes nothing until
   * a calendar is connected, because without one there is no meeting to see.
   */
  quietDuringMeetings: boolean;
  /**
   * Whether Luke stands on every connected display at once. Off by default:
   * he keeps to the system's main display until asked, and turning this off
   * again is what brings him back to it.
   */
  showOnAllDisplays: boolean;
  /**
   * How Luke stands on a display without a camera housing: a drawn notch
   * pressed into the top edge, or the free-floating bubble every such display
   * gets by default. A display with a real notch answers to neither.
   */
  formFactor: PanelFormFactor;
  /**
   * The provider a conversational ask creates a new workspace in when the ask
   * names none, absent until one has been chosen. It starts unset on purpose:
   * the first workspace the user actually creates saves its provider here, so
   * the default is always a choice they made rather than one made for them.
   */
  defaultWorkspaceProvider?: ProviderId;
  /**
   * The agent kind and model new workspaces start with, per provider, each
   * entry absent while that provider's own defaults stand. Keyed by provider
   * id and held to the build's documented table for that provider — a pairing
   * outside it is dropped rather than honoured, because it names nothing the
   * provider's endpoints take.
   */
  workspaceAgentDefaults?: Readonly<Partial<Record<ProviderId, WorkspaceAgentSelection>>>;
  /**
   * The project a conversational ask creates a workspace in when the ask
   * names none, per provider, each entry absent until one has been chosen. It
   * starts unset the way the provider does: the first workspace the user
   * creates in a provider saves its project here, so the default is always a
   * choice they made rather than one made for them. Projects are observed
   * rather than build-fixed, so the value is the provider's own project id,
   * and it steers an ask only while its provider still offers that project.
   */
  workspaceProjectDefaults?: Readonly<Partial<Record<ProviderId, string>>>;
}

/**
 * Whether the Mac's output would let Luke be heard: the default output
 * device's mute switch and its volume, read by a helper that reads nothing
 * else. Absent wherever it cannot be read — another platform, no output
 * device, a device with no controls — and absence must always be taken as
 * audible: the hint this feeds exists to explain silence, never to guess it.
 */
export interface OutputAudioState {
  muted: boolean;
  /** The output volume as macOS reports it, 0–1. */
  volume: number;
}

/** How the default input device reaches the Mac, as CoreAudio classifies it. */
export const MICROPHONE_TRANSPORT = {
  BUILT_IN: "built-in",
  BLUETOOTH: "bluetooth",
  OTHER: "other",
  /** No input device at all. */
  NONE: "none",
} as const;

export type MicrophoneTransport = (typeof MICROPHONE_TRANSPORT)[keyof typeof MICROPHONE_TRANSPORT];

/** The lid over the built-in microphone. A desktop keeps no lid: `unknown`. */
export const LID_STATE = {
  OPEN: "open",
  SHUT: "shut",
  UNKNOWN: "unknown",
} as const;

export type LidState = (typeof LID_STATE)[keyof typeof LID_STATE];

/**
 * Where the developer's voice would be captured from: the default input's
 * transport, the built-in microphone's name when the machine has one, and
 * whether the lid over it is open. Read by a helper that reads nothing else
 * and can write nothing. What it decides is bounded to one act — which device
 * the renderer asks the browser to open when a press takes a turn, so a
 * Bluetooth headset keeps its music codec while the Mac's own microphone
 * listens, and is listened to itself when a shut lid would muffle the Mac's.
 * Absent wherever it cannot be read, and absence means the browser's default.
 */
export interface MicrophoneRoute {
  defaultTransport: MicrophoneTransport;
  lid: LidState;
  builtInName?: string;
}

/** A rejected update reports why without echoing the submitted value. */
export interface SettingsUpdateResult {
  settings: AppSettings;
  reason?: string;
}

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
  settings: AppSettings;
}

/** One validated issue act on its way to the main process. */
export type IssueActionAsk = Extract<IssueToolAction, { kind: "issue-state" | "issue-comment" }>;

/** The talk key as the panel should describe it, as an accelerator. */
export interface VoiceHotkeyState {
  hotkey?: string;
  held: boolean;
}

export interface AppBridge {
  getBootstrap(): Promise<AppBootstrap>;
  beginSignIn(provider: AccountProvider): Promise<AccountSnapshot>;
  /**
   * Withdraws a sign-in still waiting on the browser. The attempt ends where
   * it stands — the loopback closes and the account returns to signed-out —
   * and a sign-in that already landed is left signed in.
   */
  cancelSignIn(): Promise<void>;
  signOut(): Promise<AccountSnapshot>;
  /**
   * Asks the hosted service to erase the signed-in account, then signs this
   * machine out of it. Rejects with the account intact when the service could
   * not be reached or refused, so the row can say the account still stands.
   */
  deleteAccount(): Promise<AccountSnapshot>;
  setExpanded(expanded: boolean, focus?: boolean): Promise<WindowMode>;
  setPointerInterception(interceptsPointer: boolean): void;
  requestMicrophone(): Promise<MicrophoneStatus>;
  /**
   * Where the developer's voice would be captured from, as last read — and a
   * fresh read is asked for behind the answer, so the next press sees a lid
   * that has closed meanwhile. `undefined` wherever the route cannot be read,
   * which the caller must take as "use the browser's default".
   */
  getMicrophoneRoute(): Promise<MicrophoneRoute | undefined>;
  /**
   * Opens Privacy & Security in System Settings, where the system's own grant
   * lives. Luke can ask for the microphone and stop using it; only the user can
   * withdraw it, and only there.
   */
  openMicrophoneSettings(): void;
  setProviderApiKey(
    providerId: CredentialProviderId,
    apiKey: string | undefined,
  ): Promise<SettingsUpdateResult>;
  /**
   * Chooses the voice Luke speaks with, from the set fixed by this build. It
   * reaches the next conversation to connect; the renderer makes it heard now
   * by reopening a call already up, because the API locks a session's voice
   * once the model has spoken.
   */
  setVoice(voice: RealtimeVoice): Promise<SettingsUpdateResult>;
  /**
   * Chooses the pace Luke speaks at, from the set fixed by this build. It
   * reaches the next conversation the way the voice does, and the renderer
   * carries it onto a call already open as a session update.
   */
  setVoiceSpeed(speed: RealtimeVoiceSpeed): Promise<SettingsUpdateResult>;
  /**
   * Opens a provider's own API-key page in the default browser. The renderer
   * names the provider, not the address, so the set of pages Luke can open is
   * fixed by this build.
   */
  openProviderApiKeys(providerId: CredentialProviderId): void;
  /** Shows or hides the menu bar status item, and remembers the choice. */
  setShowInMenuBar(show: boolean): Promise<SettingsUpdateResult>;
  /** Shows or hides the Dock icon, and remembers the choice. */
  setShowInDock(show: boolean): Promise<SettingsUpdateResult>;
  /**
   * Stands Luke on every connected display, or brings him back to the main
   * one alone, and remembers the choice.
   */
  setShowOnAllDisplays(show: boolean): Promise<SettingsUpdateResult>;
  /** Chooses how Luke stands on a display without a housing, and remembers it. */
  setFormFactor(formFactor: PanelFormFactor): Promise<SettingsUpdateResult>;
  /**
   * Chooses the provider a conversational ask creates a workspace in when the
   * ask names none, or returns to asking each time when omitted. The same
   * store write the main process makes on the first creation, offered to the
   * settings row so the choice can be changed or cleared by hand.
   */
  setDefaultWorkspaceProvider(providerId: ProviderId | undefined): Promise<SettingsUpdateResult>;
  /**
   * Chooses the agent kind and model one provider starts new workspaces with,
   * or returns to that provider's own defaults when omitted. The pairing must
   * be one the build's documented table lists for the provider; the main
   * process validates it again before the store keeps it.
   */
  setWorkspaceAgentDefault(
    providerId: ProviderId,
    selection: WorkspaceAgentSelection | undefined,
  ): Promise<SettingsUpdateResult>;
  /**
   * Chooses the project one provider creates nameless-ask workspaces in, or
   * returns to letting the first creation choose when omitted. The project
   * must be one the provider's adapter currently offers; the main process
   * validates that again before the store keeps it.
   */
  setWorkspaceProjectDefault(
    providerId: ProviderId,
    providerProjectId: string | undefined,
  ): Promise<SettingsUpdateResult>;
  /** Turns the on-screen caption of Luke's speech on or off. */
  setVoiceCaptions(enabled: boolean): Promise<SettingsUpdateResult>;
  /**
   * Returns one group of preferences to its defaults in a single stored write:
   * the choices behind the named scope are forgotten, the way each row's own
   * clear forgets one, so what stands afterwards is the default itself rather
   * than a copy of it pinned down. The renderer names a scope from the set
   * fixed by this build, never a field list, and no scope reaches a credential.
   */
  resetSettings(scope: SettingsResetScope): Promise<SettingsUpdateResult>;
  /** Turns the quieting of Music and Spotify during a spoken exchange on or off. */
  setDuckOtherMedia(enabled: boolean): Promise<SettingsUpdateResult>;
  /**
   * Chooses which credential Luke speaks and reviews sessions on. A choice
   * only ever withholds a stored key while the account can serve instead — it
   * can turn spending off, never on, so nothing here can start spending a key
   * that is not there or an allowance that is not signed in.
   */
  setVoiceSource(source: VoiceSource): Promise<SettingsUpdateResult>;
  /** Turns the Mac-microphone-over-Bluetooth-headset preference on or off. */
  setPreferBuiltInMicrophone(enabled: boolean): Promise<SettingsUpdateResult>;
  /**
   * Asks GitHub for the latest release name, right now, because the row's
   * button was pressed. The answer is the same snapshot the broadcast
   * carries, so the row that asked and every other window agree.
   */
  checkForUpdates(): Promise<UpdateSnapshot>;
  /**
   * Opens the latest release's page in the default browser. The renderer
   * names an intent and never an address — the page is fixed in the main
   * process, so nothing an update check read can steer where this goes.
   */
  openLatestRelease(): void;
  /**
   * Turns the holding of announcements during calendar meetings on or off.
   * The hold itself lives in the main process, beside the calendar it reads.
   */
  setQuietDuringMeetings(enabled: boolean): Promise<SettingsUpdateResult>;
  /**
   * Runs the Google Calendar sign-in: the browser opens Google's own consent
   * page, the grant comes back over a loopback redirect that never leaves the
   * machine, and the main process stores the resulting token encrypted and
   * connects the account it names. The renderer asks for the act and receives
   * only the settings snapshot — no token, code, or address ever crosses this
   * bridge.
   */
  connectGoogleCalendar(): Promise<SettingsUpdateResult>;
  /**
   * Ends a sign-in still waiting on the browser. The tab is left where it is;
   * the loopback stops listening, so a grant given after lands nowhere.
   */
  cancelGoogleCalendarSignIn(): void;
  /**
   * Opens the waiting sign-in's consent page again, for a tab lost or closed
   * by mistake. The renderer names the intent and never an address: the page
   * is the one the main process built and is already listening for, and with
   * no sign-in waiting nothing opens.
   */
  reopenGoogleCalendarSignIn(): void;
  /** Disconnects one calendar account, deleting its stored grant. */
  removeCalendarAccount(accountId: string): Promise<SettingsUpdateResult>;
  /**
   * Chooses whether one of an account's calendars counts toward meetings. A
   * calendar being switched on must be one the account's latest observation
   * listed; the main process validates that again before the store keeps it.
   */
  setCalendarSelected(
    accountId: string,
    calendarId: string,
    selected: boolean,
  ): Promise<SettingsUpdateResult>;
  /**
   * Whether a spoken exchange is live — a turn being held, a reply being
   * spoken, or the call coming up between them. It drives the media duck and
   * nothing else, and it is a statement rather than a request: fire-and-forget,
   * because the exchange must never wait on the players.
   */
  setVoiceExchangeActive(active: boolean): void;
  /**
   * Moves the talk key to a chord of the user's own, or back to the defaults
   * when omitted. The change is registered with the system at once, and the
   * key the panel shows follows the same announcement it always has.
   */
  setVoiceHotkey(accelerator: string | undefined): Promise<SettingsUpdateResult>;
  /**
   * Moves the ask key the same way, or back to its defaults when omitted. The
   * one extra rule is the standing one: a chord the talk key holds — or could
   * fall back to on a later launch — is refused with a reason rather than
   * stored and left to race it.
   */
  setAskHotkey(accelerator: string | undefined): Promise<SettingsUpdateResult>;
  /**
   * Moves the stop key the same way, or back to its default when omitted,
   * under the same standing rule one rung further down: a chord either other
   * Luke key holds — or could fall back to — is refused with a reason rather
   * than stored and left to race it.
   */
  setStopHotkey(accelerator: string | undefined): Promise<SettingsUpdateResult>;
  /**
   * Opens an observed session where its provider keeps it. The renderer names
   * the session rather than its address, for the same reason it names a
   * provider above: the places Luke can send you are the sessions it is already
   * watching, and no URL crosses this boundary. The answer says what became of
   * the press, so a spoken ask can report it rather than guess.
   */
  openSession(identity: SessionIdentity): Promise<SessionOpenResult>;
  /**
   * Opens the pull request an observed session published, on the row's own
   * terms: the renderer names the session, never the address, and the main
   * process reads the change back out of its registry — an address that never
   * passed normalization never reached it.
   */
  openSessionChange(identity: SessionIdentity): Promise<SessionOpenResult>;
  /**
   * Reads the recent transcript of one observed local session into a bounded
   * rendering, for a conversation the developer is holding. The renderer
   * names a session it was shown; the main process validates it against its
   * own registry and locates the transcript itself.
   */
  readSessionTranscript(identity: SessionIdentity): Promise<SessionTranscriptResult>;
  /**
   * Hands one user-typed message to an observed session, through its
   * provider's documented API. The renderer names a session it is already
   * drawing, never an address or a credential, and the answer says what became
   * of the send so the row can report it.
   */
  sendSessionMessage(identity: SessionIdentity, text: string): Promise<ProviderMessageResult>;
  /**
   * Runs one control a session's provider advertised for it. The renderer
   * names the control by the id it was advertised under; a control the
   * session's latest observation did not carry is refused, not improvised.
   */
  executeSessionControl(
    identity: SessionIdentity,
    controlId: string,
  ): Promise<ProviderControlResult>;
  /**
   * Keeps the developer's standing ask to hear about one observed session —
   * their own words, bounded, held in the main process for the attention
   * evaluator to weigh updates against. Nothing reaches any provider: the ask
   * changes only what Luke says, never what a session does, and the identity
   * is validated against the registry again before it is kept.
   */
  requestSessionNotice(identity: SessionIdentity, request: string): Promise<AttentionRequestResult>;
  /** Lets a standing ask go; answers whether one was standing to let go of. */
  withdrawSessionNotice(identity: SessionIdentity): Promise<AttentionRequestResult>;
  /**
   * Creates one workspace the user just asked for, in a project its provider
   * reported — carrying, where that project takes one, the opening task the
   * user gave its agent in their own words. The renderer names a project it
   * was shown, never a repository URL or path of its own, and the main
   * process validates the ask again against what its adapters actually
   * offered before the provider's documented creation endpoint is called.
   */
  createSessionWorkspace(
    providerId: string,
    providerProjectId: string,
    name?: string,
    task?: string,
    /**
     * The model the user named for this one creation, resolved to the wire
     * pairing the build's table documents. It overrides the stored default
     * for this act alone; the main process saves it as the default only
     * while none is chosen, and validates it again either way.
     */
    agentSelection?: WorkspaceAgentSelection,
  ): Promise<ProviderWorkspaceResult>;
  /**
   * Starts another agent in the workspace an observed session runs in. The
   * renderer names a session it is already drawing and an agent kind that
   * session's roster entry listed; the main process validates both again
   * against its registry before the adapter sees anything.
   */
  addWorkspaceAgent(
    identity: SessionIdentity,
    agent: string,
    name?: string,
    task?: string,
    /**
     * The model the user named for this one agent, as its wire id — always of
     * the asked-for agent kind, which the main process validates again. It
     * never touches the stored default.
     */
    model?: string,
    /** The effort riding that model, when the user named both. */
    effort?: string,
  ): Promise<ProviderWorkspaceResult>;
  /**
   * Carries one spoken issue act to the tracker that can take it. The renderer
   * names an issue and a transition it was shown; the main process resolves
   * both against its own latest observation before the tracker client sees
   * anything, so nothing a model composed reaches Linear as-is.
   */
  executeIssueAction(action: IssueActionAsk): Promise<TrackerActionResult>;
  /**
   * Carries one user-typed note to the people who make Luke, as email. The
   * renderer sends only what the user wrote and attached — the destination is
   * fixed in the main process, and no session material rides along.
   */
  sendFeedback(submission: FeedbackSubmission): Promise<FeedbackResult>;
  /**
   * Brings the composer up on a kind, through the tray items' own gesture:
   * the main process expands the window and sends the composer's lifecycle
   * event down the same ordered channel as the mode event, so the shape that
   * wins is always the composer — the ordering stays owned by setWindowMode
   * for every caller. Opening is all this does; a note still leaves only
   * through sendFeedback, from the composer's own Send button.
   */
  summonFeedback(kind: FeedbackKind): Promise<void>;
  /** Brings the expanded panel forward so it can accept typed input. */
  focusPanel(): void;
  /** Mints a short-lived Realtime credential; the standing API key never crosses. */
  requestRealtimeCredential(): Promise<RealtimeConnection | undefined>;
  /**
   * How voice stands right now — whose credential it runs on, why the last
   * mint ended the way it did, and what remains of a hosted day's allowance.
   * It carries no credential material, which is what lets it cross at all.
   */
  requestRealtimeDiagnostics(): Promise<RealtimeDiagnostics>;
  /**
   * Where today's hosted allowance stands on both meters, read from the
   * service without spending either. Nothing on a keyed or signed-out run,
   * where no allowance is in play.
   */
  requestHostedUsage(): Promise<HostedUsageAnswer | undefined>;
  notifyReady(): void;
  quit(): void;
  onLifecycle(callback: (eventName: string) => void): () => void;
  /** This window's own display, whenever its geometry or housing changes. */
  onDisplayChanged(callback: (display: DisplayDiagnostic) => void): () => void;
  /**
   * The settings as another window just changed them. A window's own change
   * comes back in its reply; this is how every other window's rows and guide
   * stop describing a state the store no longer holds.
   */
  onSettingsChanged(callback: (settings: AppSettings) => void): () => void;
  onAccountChanged(callback: (account: AccountSnapshot) => void): () => void;
  /** Where the app stands against the latest release, whenever that changes. */
  onUpdateChanged(callback: (update: UpdateSnapshot) => void): () => void;
  onSessionsChanged(callback: (sessions: readonly NormalizedSession[]) => void): () => void;
  /** The standing asks as they change — made, withdrawn, or let go with their sessions. */
  onNoticeAsksChanged(callback: (noticeAsks: readonly SessionNoticeAsk[]) => void): () => void;
  /** The projects a workspace can be created in, whenever the set changes. */
  onWorkspaceProjectsChanged(
    callback: (projects: readonly ObservedWorkspaceProject[]) => void,
  ): () => void;
  /** The issue roster as last observed; `undefined` says no tracker is connected. */
  onIssuesChanged(callback: (issues: readonly TrackedIssue[] | undefined) => void): () => void;
  /** Each connected account's calendars, whenever an observation changes them. */
  onCalendarsChanged(
    callback: (calendars: readonly ObservedAccountCalendars[]) => void,
  ): () => void;
  /**
   * Whether the calendar's quiet is holding announcements right now — a
   * meeting covers this instant and the setting is on. Deterministic, from
   * the clock against observed intervals; the face sleeps on it and nothing
   * else reads it.
   */
  onMeetingQuietChanged(callback: (active: boolean) => void): () => void;
  onAttentionSpeech(callback: (speech: readonly AttentionSpeech[]) => void): () => void;
  /** The talk key going down, from whatever app happened to be frontmost. */
  onVoiceHotkeyPress(callback: () => void): () => void;
  /** The same key being let go of, which is what ends a held turn. */
  onVoiceHotkeyRelease(callback: () => void): () => void;
  /**
   * The key, once it is known. It arrives after bootstrap because registering
   * it means asking a helper, and it can change if that helper stops answering.
   */
  onVoiceHotkeyChanged(callback: (state: VoiceHotkeyState) => void): () => void;
  /**
   * The ask key being re-taken — moving the talk key lets every global chord
   * go, so the ask key can land somewhere new or nowhere. Absent means the
   * hint comes down: a keycap must not teach a chord that answers nothing.
   */
  onAskHotkeyChanged(callback: (accelerator: string | undefined) => void): () => void;
  /**
   * The stop key going down, from whatever app happened to be frontmost. The
   * press carries no decision: the renderer's session answers whether there
   * is a reply to stop, exactly as Escape's press does.
   */
  onStopHotkeyPress(callback: () => void): () => void;
  /**
   * The stop key being re-taken, on the ask key's terms: moving another Luke
   * key can put it up, take it down, or leave it — and an absence must reach
   * the guide, or Luke describes a chord that answers nothing.
   */
  onStopHotkeyChanged(callback: (accelerator: string | undefined) => void): () => void;
  /**
   * The output's switches changing under the user's own hand — or becoming
   * unreadable, which arrives as `undefined` and must be drawn as audible.
   */
  onOutputAudioChanged(callback: (state: OutputAudioState | undefined) => void): () => void;
}

export const channels = {
  bootstrap: "app:bootstrap",
  beginSignIn: "app:begin-sign-in",
  cancelSignIn: "app:cancel-sign-in",
  signOut: "app:sign-out",
  deleteAccount: "app:delete-account",
  accountChanged: "app:account-changed",
  setExpanded: "app:set-expanded",
  setPointerInterception: "app:set-pointer-interception",
  requestMicrophone: "app:request-microphone",
  microphoneRoute: "app:microphone-route",
  openMicrophoneSettings: "app:open-microphone-settings",
  setProviderApiKey: "app:set-provider-api-key",
  setVoice: "app:set-voice",
  setVoiceSpeed: "app:set-voice-speed",
  setVoiceCaptions: "app:set-voice-captions",
  setVoiceHotkey: "app:set-voice-hotkey",
  setAskHotkey: "app:set-ask-hotkey",
  setStopHotkey: "app:set-stop-hotkey",
  setDuckOtherMedia: "app:set-duck-other-media",
  setVoiceSource: "app:set-voice-source",
  setPreferBuiltInMicrophone: "app:set-prefer-built-in-microphone",
  setQuietDuringMeetings: "app:set-quiet-during-meetings",
  connectGoogleCalendar: "app:connect-google-calendar",
  cancelGoogleCalendarSignIn: "app:cancel-google-calendar-sign-in",
  reopenGoogleCalendarSignIn: "app:reopen-google-calendar-sign-in",
  removeCalendarAccount: "app:remove-calendar-account",
  setCalendarSelected: "app:set-calendar-selected",
  calendarsChanged: "app:calendars-changed",
  meetingQuietChanged: "app:meeting-quiet-changed",
  checkForUpdates: "app:check-for-updates",
  openLatestRelease: "app:open-latest-release",
  updateChanged: "app:update-changed",
  setVoiceExchange: "app:set-voice-exchange",
  openProviderApiKeys: "app:open-provider-api-keys",
  setShowInMenuBar: "app:set-show-in-menu-bar",
  setShowInDock: "app:set-show-in-dock",
  setShowOnAllDisplays: "app:set-show-on-all-displays",
  setFormFactor: "app:set-form-factor",
  setDefaultWorkspaceProvider: "app:set-default-workspace-provider",
  setWorkspaceAgentDefault: "app:set-workspace-agent-default",
  setWorkspaceProjectDefault: "app:set-workspace-project-default",
  resetSettings: "app:reset-settings",
  openSession: "app:open-session",
  openSessionChange: "app:open-session-change",
  readSessionTranscript: "app:read-session-transcript",
  sendSessionMessage: "app:send-session-message",
  executeSessionControl: "app:execute-session-control",
  requestSessionNotice: "app:request-session-notice",
  withdrawSessionNotice: "app:withdraw-session-notice",
  createSessionWorkspace: "app:create-session-workspace",
  addWorkspaceAgent: "app:add-workspace-agent",
  executeIssueAction: "app:execute-issue-action",
  sendFeedback: "app:send-feedback",
  summonFeedback: "app:summon-feedback",
  focusPanel: "app:focus-panel",
  requestRealtimeCredential: "app:request-realtime-credential",
  requestRealtimeDiagnostics: "app:request-realtime-diagnostics",
  requestHostedUsage: "app:request-hosted-usage",
  attentionSpeech: "app:attention-speech",
  voiceHotkeyPress: "app:voice-hotkey-press",
  voiceHotkeyRelease: "app:voice-hotkey-release",
  voiceHotkeyChanged: "app:voice-hotkey-changed",
  askHotkeyChanged: "app:ask-hotkey-changed",
  stopHotkeyPress: "app:stop-hotkey-press",
  stopHotkeyChanged: "app:stop-hotkey-changed",
  outputAudioChanged: "app:output-audio-changed",
  rendererReady: "app:renderer-ready",
  lifecycle: "app:lifecycle",
  displayChanged: "app:display-changed",
  settingsChanged: "app:settings-changed",
  sessionsChanged: "app:sessions-changed",
  noticeAsksChanged: "app:notice-asks-changed",
  workspaceProjectsChanged: "app:workspace-projects-changed",
  issuesChanged: "app:issues-changed",
  quit: "app:quit",
} as const;
