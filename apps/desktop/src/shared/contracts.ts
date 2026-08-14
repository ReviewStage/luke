import type {
  AttentionSpeech,
  FixtureSnapshot,
  IssueToolAction,
  NormalizedSession,
  ProviderControlResult,
  ProviderMessageResult,
  RealtimeConnection,
  RealtimeVoice,
  RealtimeVoiceSpeed,
  Rectangle,
  ResolvedNotchGeometry,
  SessionIdentity,
  TrackedIssue,
  TrackerActionResult,
  WindowMode,
} from "@sidecar/core";
import type { CredentialProviderId } from "./credential-providers";

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
   * Whether Music and Spotify are turned down while a spoken exchange is
   * live, and back up after. On by default: speech over music is the failure
   * everyone has had, and the duck defers to the user everywhere it can — it
   * touches only a player that was playing, and a volume moved by hand during
   * the duck is left where the hand put it.
   */
  duckOtherMedia: boolean;
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
   * The talk key as the user should read it, absent when the system refused to
   * register one — a shortcut nothing can trigger must not be shown as though
   * it works.
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
   * because the renderer needs both spellings: the keycap's ⌥L and aria's
   * Alt+L.
   */
  askHotkey?: string;
  /** Whether the panel should show the voice diagnostics block. */
  display: DisplayDiagnostic;
  sessions: readonly NormalizedSession[];
  /** Absent while no issue tracker is connected, which is its own answer. */
  issues?: readonly TrackedIssue[];
  settings: AppSettings;
}

/** One validated issue act on its way to the main process. */
export type IssueActionAsk = Extract<IssueToolAction, { kind: "issue-state" | "issue-comment" }>;

/** The talk key as the panel should describe it. */
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
   * reaches the next conversation to connect; one already open keeps the
   * voice it answered with.
   */
  setVoice(voice: RealtimeVoice): Promise<SettingsUpdateResult>;
  /**
   * Chooses the pace Luke speaks at, from the set fixed by this build. It
   * reaches the next conversation the same way the voice does.
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
  /** Turns the on-screen caption of Luke's speech on or off. */
  setVoiceCaptions(enabled: boolean): Promise<SettingsUpdateResult>;
  /** Turns the quieting of Music and Spotify during a spoken exchange on or off. */
  setDuckOtherMedia(enabled: boolean): Promise<SettingsUpdateResult>;
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
   * one extra rule is the standing one: a chord the talk key holds is refused
   * with a reason rather than stored and silently outbid.
   */
  setAskHotkey(accelerator: string | undefined): Promise<SettingsUpdateResult>;
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
   * Carries one spoken issue act to the tracker that can take it. The renderer
   * names an issue and a transition it was shown; the main process resolves
   * both against its own latest observation before the tracker client sees
   * anything, so nothing a model composed reaches Linear as-is.
   */
  executeIssueAction(action: IssueActionAsk): Promise<TrackerActionResult>;
  /** Brings the expanded panel forward so it can accept typed input. */
  focusPanel(): void;
  /** Mints a short-lived Realtime credential; the standing API key never crosses. */
  requestRealtimeCredential(): Promise<RealtimeConnection | undefined>;
  notifyReady(): void;
  quit(): void;
  onLifecycle(callback: (eventName: string) => void): () => void;
  onDisplayChanged(callback: (display: DisplayDiagnostic) => void): () => void;
  onSessionsChanged(callback: (sessions: readonly NormalizedSession[]) => void): () => void;
  /** The issue roster as last observed; `undefined` says no tracker is connected. */
  onIssuesChanged(callback: (issues: readonly TrackedIssue[] | undefined) => void): () => void;
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
  setDuckOtherMedia: "app:set-duck-other-media",
  setVoiceExchange: "app:set-voice-exchange",
  openProviderApiKeys: "app:open-provider-api-keys",
  setShowInMenuBar: "app:set-show-in-menu-bar",
  setShowInDock: "app:set-show-in-dock",
  openSession: "app:open-session",
  sendSessionMessage: "app:send-session-message",
  executeSessionControl: "app:execute-session-control",
  executeIssueAction: "app:execute-issue-action",
  focusPanel: "app:focus-panel",
  requestRealtimeCredential: "app:request-realtime-credential",
  attentionSpeech: "app:attention-speech",
  voiceHotkeyPress: "app:voice-hotkey-press",
  voiceHotkeyRelease: "app:voice-hotkey-release",
  voiceHotkeyChanged: "app:voice-hotkey-changed",
  askHotkeyChanged: "app:ask-hotkey-changed",
  rendererReady: "app:renderer-ready",
  lifecycle: "app:lifecycle",
  displayChanged: "app:display-changed",
  sessionsChanged: "app:sessions-changed",
  issuesChanged: "app:issues-changed",
  quit: "app:quit",
} as const;
