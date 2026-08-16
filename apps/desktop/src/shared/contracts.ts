import type {
  AttentionSpeech,
  FixtureSnapshot,
  IssueToolAction,
  NormalizedSession,
  ObservedWorkspaceProject,
  PanelFormFactor,
  ProviderControlResult,
  ProviderId,
  ProviderMessageResult,
  ProviderWorkspaceResult,
  RealtimeConnection,
  RealtimeVoice,
  RealtimeVoiceSpeed,
  Rectangle,
  ResolvedNotchGeometry,
  SessionIdentity,
  TrackedIssue,
  TrackerActionResult,
  WindowMode,
  WorkspaceAgentSelection,
} from "@sidecar/core";
import type { CredentialProviderId } from "./credential-providers";
import type { FeedbackKind, FeedbackResult, FeedbackSubmission } from "./feedback";

export type { WindowMode } from "@sidecar/core";

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
 * What each plain preference is until the user chooses otherwise. The store
 * falls back to these when the settings file has never said, and the app
 * guide carries the same values so a spoken ask for "the default" names a
 * real one — stated once so the two can never drift. The voice, pace, and
 * form factor keep their defaults beside their own types in `@sidecar/core`,
 * and the three keys' defaults live with the registrar that owns them.
 */
export const APP_SETTING_DEFAULTS = {
  showInDock: false,
  showInMenuBar: true,
  voiceCaptions: false,
  duckOtherMedia: true,
  sessionNotifications: true,
  holdNoticesOnCall: false,
  showOnAllDisplays: false,
} as const satisfies Partial<Record<keyof AppSettings, boolean>>;

/**
 * Whether the developer is on a call, as their own microphone reports it.
 *
 * Three answers rather than two, and the third is load-bearing: not every input
 * device says what it is doing — Bluetooth headsets are known to read as idle
 * throughout a call — so a build can find itself watching a device that will
 * never answer. `UNAVAILABLE` is that device, and it is deliberately not `OFF`:
 * the panel says so where the switch is, rather than leaving a switch on screen
 * that quietly does nothing.
 */
export const CALL_STATUS = {
  ON: "on",
  OFF: "off",
  UNAVAILABLE: "unavailable",
} as const;

export type CallStatus = (typeof CALL_STATUS)[keyof typeof CALL_STATUS];

/**
 * One app holding the microphone, as the helper named it.
 *
 * The identifier is the bundle identifier, because that is the only name for an
 * app that survives a relaunch and is therefore the only thing an ignore list
 * can be keyed by. The display name is what the developer would recognise, and
 * is only ever drawn — never matched on.
 *
 * This stays on the machine. It reaches the panel and the settings file and
 * nowhere else: the guide leaves the machine, so what a developer runs is not
 * something it may carry.
 */
export interface CallApp {
  id: string;
  name: string;
  /**
   * The app's own icon as a base64 PNG, absent where macOS had none to give.
   * Drawn and never matched on, like the name — and bounded, because it rides
   * in every reading and is written to the settings file with an exemption.
   */
  icon?: string;
}

/**
 * How much icon is worth carrying. A 32-pixel PNG is a couple of kilobytes;
 * anything an order of magnitude past that is not an icon this build asked for,
 * and it would be written to the settings file fifty times over.
 */
export const MAXIMUM_CALL_APP_ICON_LENGTH = 24_000;

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
   * Whether a session arriving somewhere that wants the user — waiting on an
   * answer, stopped on an error, or finished — is announced in Luke's own
   * voice, opening a speak-only call when no conversation is up. On by
   * default: an agent finishing while its developer looks elsewhere is the
   * one moment a sidecar exists for, and the notch's own signals only help
   * the eyes already on it.
   */
  sessionNotifications: boolean;
  /**
   * Whether a notice Luke would have spoken while the developer is on a call
   * waits until the call ends, and is read out then. Off by default: it is
   * what turns the microphone watch on at all, and a Luke who fell silent on
   * a machine nobody had asked is a Luke who reads as broken. What waits is
   * only the sentence — every session goes on reading as needing attention in
   * the panel throughout, which is what the developer looks at afterwards.
   */
  holdNoticesOnCall: boolean;
  /**
   * The apps whose microphone use is not a call. A developer adds one by
   * pressing Ignore on the prompt that appears when it first takes the device,
   * and removes it in Settings; nothing else writes to it.
   */
  ignoredCallApps: readonly CallApp[];
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
  packaged: boolean;
  platform: string;
  electronVersion: string;
  chromiumVersion: string;
  nodeVersion: string;
  microphoneStatus: MicrophoneStatus;
  /**
   * Whether a Realtime credential can be minted at all. False leaves the voice
   * experience explicitly off rather than failing when the user first speaks.
   */
  realtimeAvailable: boolean;
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
  /**
   * Whether the developer is on a call right now, as the microphone first read
   * it. `UNAVAILABLE` is also what a build says before the helper has
   * answered, so nothing is ever held on a reading that has not arrived.
   */
  callStatus: CallStatus;
  /** Who is holding the microphone right now, empty until the helper answers. */
  callApps: readonly CallApp[];
  /** Whether the panel should show the voice diagnostics block. */
  display: DisplayDiagnostic;
  sessions: readonly NormalizedSession[];
  /** Where a new workspace can be created, as the adapters currently offer it. */
  workspaceProjects: readonly ObservedWorkspaceProject[];
  /** Absent while no issue tracker is connected, which is its own answer. */
  issues?: readonly TrackedIssue[];
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
  setExpanded(expanded: boolean, focus?: boolean): Promise<WindowMode>;
  setPointerInterception(interceptsPointer: boolean): void;
  requestMicrophone(): Promise<MicrophoneStatus>;
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
  /** Turns the on-screen caption of Luke's speech on or off. */
  setVoiceCaptions(enabled: boolean): Promise<SettingsUpdateResult>;
  /** Turns the quieting of Music and Spotify during a spoken exchange on or off. */
  setDuckOtherMedia(enabled: boolean): Promise<SettingsUpdateResult>;
  /** Turns the spoken announcement about a session that wants the user on or off. */
  setSessionNotifications(enabled: boolean): Promise<SettingsUpdateResult>;
  /**
   * Turns the holding of notices during a call on or off. The choice is kept
   * whether or not this Mac's microphone reports itself: a setting that
   * answers a question the machine cannot is still the user's answer, and it
   * comes into effect the moment the machine can.
   */
  setHoldNoticesOnCall(enabled: boolean): Promise<SettingsUpdateResult>;
  /**
   * Adds one app to the ignore list. The renderer names an app it was shown —
   * the prompt currently drawn, or a row of the list — and the main process
   * resolves it against what it has actually read before anything is stored.
   */
  ignoreCallApp(app: CallApp): Promise<SettingsUpdateResult>;
  /** Takes one app off the ignore list, by the identifier the list is keyed by. */
  unignoreCallApp(id: string): Promise<SettingsUpdateResult>;
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
  onSessionsChanged(callback: (sessions: readonly NormalizedSession[]) => void): () => void;
  /** The projects a workspace can be created in, whenever the set changes. */
  onWorkspaceProjectsChanged(
    callback: (projects: readonly ObservedWorkspaceProject[]) => void,
  ): () => void;
  /** The issue roster as last observed; `undefined` says no tracker is connected. */
  onIssuesChanged(callback: (issues: readonly TrackedIssue[] | undefined) => void): () => void;
  onAttentionSpeech(callback: (speech: readonly AttentionSpeech[]) => void): () => void;
  /**
   * A call starting or ending, and the microphone becoming unreadable. The
   * panel only says what it is; the holding itself is decided in the main
   * process, beside the reviews it holds.
   */
  onCallStatusChanged(callback: (status: CallStatus) => void): () => void;
  /**
   * An app that has just taken the microphone and is not already ignored. It
   * is what the countdown prompt is drawn for, and it arrives once per arrival
   * rather than for as long as the app holds the device.
   */
  onCallAppArrived(callback: (app: CallApp) => void): () => void;
  /**
   * Everyone currently holding the microphone, as the helper names them. The
   * prompt is transient by design, so this is what makes a missed one
   * recoverable: the same apps, in a row someone can go and look at.
   */
  onCallAppsChanged(callback: (apps: readonly CallApp[]) => void): () => void;
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
  setExpanded: "app:set-expanded",
  setPointerInterception: "app:set-pointer-interception",
  requestMicrophone: "app:request-microphone",
  openMicrophoneSettings: "app:open-microphone-settings",
  setProviderApiKey: "app:set-provider-api-key",
  setVoice: "app:set-voice",
  setVoiceSpeed: "app:set-voice-speed",
  setVoiceCaptions: "app:set-voice-captions",
  setVoiceHotkey: "app:set-voice-hotkey",
  setAskHotkey: "app:set-ask-hotkey",
  setStopHotkey: "app:set-stop-hotkey",
  setDuckOtherMedia: "app:set-duck-other-media",
  setSessionNotifications: "app:set-session-notifications",
  setHoldNoticesOnCall: "app:set-hold-notices-on-call",
  ignoreCallApp: "app:ignore-call-app",
  unignoreCallApp: "app:unignore-call-app",
  callAppArrived: "app:call-app-arrived",
  callAppsChanged: "app:call-apps-changed",
  callStatusChanged: "app:call-status-changed",
  setVoiceExchange: "app:set-voice-exchange",
  openProviderApiKeys: "app:open-provider-api-keys",
  setShowInMenuBar: "app:set-show-in-menu-bar",
  setShowInDock: "app:set-show-in-dock",
  setShowOnAllDisplays: "app:set-show-on-all-displays",
  setFormFactor: "app:set-form-factor",
  setDefaultWorkspaceProvider: "app:set-default-workspace-provider",
  setWorkspaceAgentDefault: "app:set-workspace-agent-default",
  openSession: "app:open-session",
  sendSessionMessage: "app:send-session-message",
  executeSessionControl: "app:execute-session-control",
  createSessionWorkspace: "app:create-session-workspace",
  addWorkspaceAgent: "app:add-workspace-agent",
  executeIssueAction: "app:execute-issue-action",
  sendFeedback: "app:send-feedback",
  summonFeedback: "app:summon-feedback",
  focusPanel: "app:focus-panel",
  requestRealtimeCredential: "app:request-realtime-credential",
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
  workspaceProjectsChanged: "app:workspace-projects-changed",
  issuesChanged: "app:issues-changed",
  quit: "app:quit",
} as const;
