import type {
  FixtureSnapshot,
  NormalizedSession,
  Rectangle,
  ResolvedNotchGeometry,
  SessionIdentity,
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
   * Whether the observers on this machine may read what a session actually
   * said. Off until the user turns it on, and it never widens what an attention
   * evaluator is sent: a transcript stays on this Mac.
   */
  localTranscripts: boolean;
}

/** A rejected update reports why without echoing the submitted value. */
export interface SettingsUpdateResult {
  settings: AppSettings;
  reason?: string;
}

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
  display: DisplayDiagnostic;
  sessions: readonly NormalizedSession[];
  settings: AppSettings;
}

export interface AppBridge {
  getBootstrap(): Promise<AppBootstrap>;
  setExpanded(expanded: boolean, focus?: boolean): Promise<WindowMode>;
  setPointerInterception(interceptsPointer: boolean): void;
  requestMicrophone(): Promise<MicrophoneStatus>;
  setProviderApiKey(
    providerId: CredentialProviderId,
    apiKey: string | undefined,
  ): Promise<SettingsUpdateResult>;
  /**
   * Opens a provider's own API-key page in the default browser. The renderer
   * names the provider, not the address, so the set of pages Luke can open is
   * fixed by this build.
   */
  openProviderApiKeys(providerId: CredentialProviderId): void;
  /** Turns local transcript reading on or off, and reports the settled state. */
  setLocalTranscripts(enabled: boolean): Promise<AppSettings>;
  /**
   * Opens an observed session where its provider keeps it. The renderer names
   * the session rather than its address, for the same reason it names a
   * provider above: the places Luke can send you are the sessions it is already
   * watching, and no URL crosses this boundary.
   */
  openSession(identity: SessionIdentity): void;
  /** Brings the expanded panel forward so it can accept typed input. */
  focusPanel(): void;
  notifyReady(): void;
  quit(): void;
  onLifecycle(callback: (eventName: string) => void): () => void;
  onDisplayChanged(callback: (display: DisplayDiagnostic) => void): () => void;
  onSessionsChanged(callback: (sessions: readonly NormalizedSession[]) => void): () => void;
}

export const channels = {
  bootstrap: "app:bootstrap",
  setExpanded: "app:set-expanded",
  setPointerInterception: "app:set-pointer-interception",
  requestMicrophone: "app:request-microphone",
  setProviderApiKey: "app:set-provider-api-key",
  setLocalTranscripts: "app:set-local-transcripts",
  openProviderApiKeys: "app:open-provider-api-keys",
  openSession: "app:open-session",
  focusPanel: "app:focus-panel",
  rendererReady: "app:renderer-ready",
  lifecycle: "app:lifecycle",
  displayChanged: "app:display-changed",
  sessionsChanged: "app:sessions-changed",
  quit: "app:quit",
} as const;
