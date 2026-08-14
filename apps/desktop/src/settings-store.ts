import fs from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_PANEL_FORM_FACTOR,
  isPanelFormFactor,
  isRealtimeVoice,
  isRealtimeVoiceSpeed,
  type PanelFormFactor,
  REALTIME_DEFAULTS,
  type RealtimeVoice,
  type RealtimeVoiceSpeed,
} from "@sidecar/core";
import { environmentRealtimeSpeed, environmentRealtimeVoice } from "./openai-realtime-credentials";
import {
  type AppSettings,
  CREDENTIAL_SOURCE,
  type CredentialSource,
  SECRET_STORAGE,
  type SecretStorage,
  type SettingsUpdateResult,
} from "./shared/contracts";
import {
  CREDENTIAL_PROVIDER_ID,
  CREDENTIAL_PROVIDER_LIST,
  type CredentialFormat,
  type CredentialProvider,
  type CredentialProviderId,
} from "./shared/credential-providers";
import { parseVoiceHotkey } from "./shared/voice-hotkey";

const SETTINGS_FILE_NAME = "settings.json";
const SETTINGS_TEMPORARY_FILE_NAME = "settings.json.tmp";
/** Version 2 keys credentials by provider id; version 1 held one Conductor key. */
const SETTINGS_FILE_VERSION = 2;
const SETTINGS_FILE_MODE = 0o600;

const SETTINGS_FIELD = {
  API_KEYS: "apiKeys",
  ASK_HOTKEY: "askHotkey",
  DUCK_OTHER_MEDIA: "duckOtherMedia",
  FORM_FACTOR: "formFactor",
  LEGACY_CONDUCTOR_API_KEY: "conductorApiKey",
  SHOW_IN_DOCK: "showInDock",
  SHOW_IN_MENU_BAR: "showInMenuBar",
  SHOW_ON_ALL_DISPLAYS: "showOnAllDisplays",
  STOP_HOTKEY: "stopHotkey",
  VERSION: "version",
  VOICE: "voice",
  VOICE_CAPTIONS: "voiceCaptions",
  VOICE_SPEED: "voiceSpeed",
  VOICE_HOTKEY: "voiceHotkey",
} as const;

const API_KEY_LENGTH = {
  MINIMUM: 8,
  MAXIMUM: 512,
} as const;

/** Printable ASCII with no spaces — the bytes an authorization header accepts. */
const PRINTABLE_ASCII = /^[\x21-\x7e]+$/;

/**
 * A credential is only ever written through OS-provided encryption. Electron's
 * `safeStorage` satisfies this on macOS by deriving its key from the Keychain.
 *
 * Every member of this interface reaches the Keychain, `isAvailable` included:
 * it answers by fetching the same key the other two use. So none of them may be
 * called to fill in a display value — only to protect or recover a credential
 * the user has.
 */
export interface SecretCipher {
  isAvailable(): boolean;
  encrypt(plainText: string): Buffer;
  decrypt(cipherText: Buffer): string;
}

export interface SettingsStoreOptions {
  directory: () => string;
  cipher: SecretCipher;
  environment?: NodeJS.ProcessEnv;
  providers?: readonly CredentialProvider[];
}

interface PersistedSettings {
  version: number;
  /**
   * Ciphertext by provider id. A provider this build does not know is carried
   * through untouched so an older build cannot discard a newer one's key.
   */
  apiKeys: Readonly<Record<string, string>>;
  /**
   * Whether Luke stands in the Dock. Off unless the file says `true` outright,
   * so a missing field, an older file, and a corrupt value all land on the
   * accessory app Luke ships as rather than putting an icon somewhere new.
   */
  showInDock: boolean;
  /**
   * Whether the menu bar status item is drawn. A file that has never said —
   * written before the choice existed, or hand-edited into nonsense — means the
   * item is shown, because until the user hides it that is what Luke does.
   */
  showInMenuBar: boolean;
  /**
   * The voice the user chose, absent until one has been. A preference rather
   * than a credential, so it is stored plainly and never touches the cipher.
   */
  voice?: RealtimeVoice;
  /**
   * The pace the user chose for Luke's speech, absent until one has been.
   * Stored plainly like the voice, and held to the same offered set.
   */
  voiceSpeed?: RealtimeVoiceSpeed;
  /**
   * Whether Luke's speech is captioned on screen. Off unless the file says
   * `true` outright, so a missing field, an older file, and a corrupt value
   * all land on the default rather than switching something on.
   */
  voiceCaptions: boolean;
  /**
   * The talk-key chord the user chose, absent while the defaults stand. A
   * preference like the voice, stored plainly — and like the voice, a value
   * this build cannot register is dropped rather than carried, because
   * honouring it would claim a system key nothing was ever told about.
   */
  voiceHotkey?: string;
  /**
   * The ask-key chord the user chose, held to everything the talk key's is:
   * stored plainly, absent while the defaults stand, and dropped rather than
   * carried when this build cannot register it.
   */
  askHotkey?: string;
  /**
   * The stop-key chord the user chose, held to the same terms as the other
   * two keys' choices.
   */
  stopHotkey?: string;
  /**
   * Whether Music and Spotify are turned down while a spoken exchange is
   * live. On unless the file says `false` outright — like the menu bar item,
   * this is what Luke does until the user asks otherwise, so a missing field
   * and a corrupt value both land on doing it.
   */
  duckOtherMedia: boolean;
  /**
   * Whether Luke stands on every connected display. Off unless the file says
   * `true` outright, like the Dock: a missing field, an older file, and a
   * corrupt value all land on the main display alone rather than raising
   * windows somewhere new.
   */
  showOnAllDisplays: boolean;
  /**
   * How Luke stands on a display without a housing, absent until the user has
   * chosen. Held to the offered set like the voice: a value this build does
   * not draw is dropped rather than honoured.
   */
  formFactor?: PanelFormFactor;
}

interface ResolvedApiKey {
  apiKey?: string;
  source: CredentialSource;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function canIgnoreFilesystemError(error: unknown): boolean {
  return (
    isNodeError(error) &&
    (error.code === "ENOENT" ||
      error.code === "ENOTDIR" ||
      error.code === "EACCES" ||
      error.code === "EPERM")
  );
}

/**
 * A rejected key never reaches disk, and the reason never echoes the submitted
 * value. Most of what this rules out is a value that cannot be sent as an HTTP
 * authorization header at all. A provider that publishes more than one kind of
 * key also has the kind Luke cannot use ruled out here, so a credential that
 * would only ever be refused is refused at the door rather than stored and
 * quietly unused.
 */
export function apiKeyRejection(apiKey: string, format?: CredentialFormat): string | undefined {
  if (apiKey.length < API_KEY_LENGTH.MINIMUM) return "That API key is too short.";
  if (apiKey.length > API_KEY_LENGTH.MAXIMUM) return "That API key is too long.";
  if (!PRINTABLE_ASCII.test(apiKey)) return "That API key contains unsupported characters.";
  if (format && !apiKey.startsWith(format.prefix)) return format.rejection;
  return undefined;
}

function environmentApiKey(
  provider: CredentialProvider,
  environment: NodeJS.ProcessEnv,
): string | undefined {
  for (const variable of provider.environmentVariables) {
    const value = environment[variable]?.trim();
    if (value && !apiKeyRejection(value, provider.keyFormat)) return value;
  }
  return undefined;
}

function storedApiKeys(record: Record<string, unknown>): Record<string, string> {
  const apiKeys: Record<string, string> = {};
  const persisted = record[SETTINGS_FIELD.API_KEYS];
  if (persisted !== null && typeof persisted === "object" && !Array.isArray(persisted)) {
    for (const [providerId, ciphertext] of Object.entries(persisted)) {
      if (typeof ciphertext === "string" && ciphertext) apiKeys[providerId] = ciphertext;
    }
  }
  // An installation upgraded from version 1 keeps its Conductor key: the
  // ciphertext is unchanged, so it decrypts exactly as it did before.
  const legacy = record[SETTINGS_FIELD.LEGACY_CONDUCTOR_API_KEY];
  if (typeof legacy === "string" && legacy && !apiKeys[CREDENTIAL_PROVIDER_ID.CONDUCTOR]) {
    apiKeys[CREDENTIAL_PROVIDER_ID.CONDUCTOR] = legacy;
  }
  return apiKeys;
}

function parsePersistedSettings(source: string): PersistedSettings {
  const parsed: unknown = JSON.parse(source);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Settings file is not an object");
  }
  const record = parsed as Record<string, unknown>;
  const version = record[SETTINGS_FIELD.VERSION];
  const showInMenuBar = record[SETTINGS_FIELD.SHOW_IN_MENU_BAR];
  const voice = record[SETTINGS_FIELD.VOICE];
  const voiceSpeed = record[SETTINGS_FIELD.VOICE_SPEED];
  const formFactor = record[SETTINGS_FIELD.FORM_FACTOR];
  const storedHotkey = record[SETTINGS_FIELD.VOICE_HOTKEY];
  // Read through the same gate a submitted chord passes, so a hand-edited
  // value is either the one spelling the rest of the app uses or nothing.
  const voiceHotkey = typeof storedHotkey === "string" ? parseVoiceHotkey(storedHotkey) : undefined;
  const storedAskHotkey = record[SETTINGS_FIELD.ASK_HOTKEY];
  const askHotkey =
    typeof storedAskHotkey === "string" ? parseVoiceHotkey(storedAskHotkey) : undefined;
  const storedStopHotkey = record[SETTINGS_FIELD.STOP_HOTKEY];
  const stopHotkey =
    typeof storedStopHotkey === "string" ? parseVoiceHotkey(storedStopHotkey) : undefined;
  return {
    version: typeof version === "number" ? version : SETTINGS_FILE_VERSION,
    apiKeys: storedApiKeys(record),
    showInDock: record[SETTINGS_FIELD.SHOW_IN_DOCK] === true,
    showInMenuBar: typeof showInMenuBar === "boolean" ? showInMenuBar : true,
    // A voice this build does not offer is dropped rather than carried: unlike
    // a credential it has a default to fall back to, and honouring an unknown
    // one would mint sessions the API refuses.
    ...(isRealtimeVoice(voice) ? { voice } : {}),
    // A pace outside the offered set is dropped for the same reason.
    ...(isRealtimeVoiceSpeed(voiceSpeed) ? { voiceSpeed } : {}),
    voiceCaptions: record[SETTINGS_FIELD.VOICE_CAPTIONS] === true,
    ...(voiceHotkey ? { voiceHotkey } : {}),
    ...(askHotkey ? { askHotkey } : {}),
    ...(stopHotkey ? { stopHotkey } : {}),
    duckOtherMedia: record[SETTINGS_FIELD.DUCK_OTHER_MEDIA] !== false,
    showOnAllDisplays: record[SETTINGS_FIELD.SHOW_ON_ALL_DISPLAYS] === true,
    // A form this build does not draw is dropped like an unknown voice.
    ...(isPanelFormFactor(formFactor) ? { formFactor } : {}),
  };
}

/**
 * Reads and writes the small set of user-owned settings Luke needs. A stored
 * credential stays in the main process: callers can learn that a provider has a
 * key and can replace it, but no accessor returns one to a renderer.
 */
export class SettingsStore {
  readonly #directory: () => string;
  readonly #cipher: SecretCipher;
  readonly #environment: NodeJS.ProcessEnv;
  readonly #providers: readonly CredentialProvider[];
  #loading: Promise<PersistedSettings> | undefined;
  #resolved = new Map<CredentialProviderId, ResolvedApiKey>();
  #mutations: Promise<void> = Promise.resolve();
  #secretStorage: SecretStorage = SECRET_STORAGE.UNKNOWN;

  constructor(options: SettingsStoreOptions) {
    this.#directory = options.directory;
    this.#cipher = options.cipher;
    this.#environment = options.environment ?? process.env;
    this.#providers = options.providers ?? CREDENTIAL_PROVIDER_LIST;
  }

  async snapshot(): Promise<AppSettings> {
    const sources = await Promise.all(
      this.#providers.map(
        async (provider) => [provider.id, (await this.#resolveApiKey(provider)).source] as const,
      ),
    );
    return {
      credentialSources: Object.fromEntries(sources) as Record<
        CredentialProviderId,
        CredentialSource
      >,
      // Reports what storing a key has already established, and asks nothing on
      // its own: a snapshot is taken on every launch, and most of them are for
      // a user with no key to protect.
      secretStorage: this.#secretStorage,
      showInDock: (await this.#load()).showInDock,
      showInMenuBar: (await this.#load()).showInMenuBar,
      // Resolved the way the minter resolves it, so the panel marks the voice
      // that would actually be heard.
      voice:
        (await this.#load()).voice ??
        environmentRealtimeVoice(this.#environment) ??
        REALTIME_DEFAULTS.VOICE,
      voiceSpeed:
        (await this.#load()).voiceSpeed ??
        environmentRealtimeSpeed(this.#environment) ??
        REALTIME_DEFAULTS.SPEED,
      voiceCaptions: (await this.#load()).voiceCaptions,
      ...((await this.#load()).voiceHotkey
        ? { voiceHotkey: (await this.#load()).voiceHotkey }
        : {}),
      ...((await this.#load()).askHotkey ? { askHotkey: (await this.#load()).askHotkey } : {}),
      ...((await this.#load()).stopHotkey ? { stopHotkey: (await this.#load()).stopHotkey } : {}),
      duckOtherMedia: (await this.#load()).duckOtherMedia,
      showOnAllDisplays: (await this.#load()).showOnAllDisplays,
      formFactor: (await this.#load()).formFactor ?? DEFAULT_PANEL_FORM_FACTOR,
    };
  }

  /**
   * Deliberately shallower than `snapshot()`: the answer comes from the
   * settings file alone, so a caller deciding whether to draw the status item
   * never waits on — or wakes — the OS keychain behind the stored keys.
   */
  async showInMenuBar(): Promise<boolean> {
    return (await this.#load()).showInMenuBar;
  }

  /**
   * Shallow for the same reason as `showInMenuBar()`: the Dock icon is decided
   * at launch from the settings file alone, never the keychain behind the
   * stored keys.
   */
  async showInDock(): Promise<boolean> {
    return (await this.#load()).showInDock;
  }

  /**
   * Shallow for the same reason `showInMenuBar()` is: the media duck arms at
   * startup, and arming it must never be what wakes the OS keychain.
   */
  async duckOtherMedia(): Promise<boolean> {
    return (await this.#load()).duckOtherMedia;
  }

  /**
   * Main-process only, like the resolved keys: the voice the user chose, for
   * the minter at startup. Nothing chosen resolves to nothing — the minter
   * already carries the environment's voice and the default.
   */
  async readVoice(): Promise<RealtimeVoice | undefined> {
    return (await this.#load()).voice;
  }

  /** Stores the chosen voice, or returns to the default when omitted. */
  async setVoice(voice: RealtimeVoice | undefined): Promise<SettingsUpdateResult> {
    await this.#serialize(async () => {
      const persisted = await this.#load();
      if (persisted.voice === voice) return;
      const next: PersistedSettings = {
        ...persisted,
        version: SETTINGS_FILE_VERSION,
      };
      if (voice) next.voice = voice;
      else delete next.voice;
      await this.#write(next);
      this.#loading = Promise.resolve(next);
    });
    return { settings: await this.snapshot() };
  }

  /**
   * Main-process only, like the voice: the pace the user chose, for the minter
   * at startup. Nothing chosen resolves to nothing — the minter already
   * carries the environment's pace and the default.
   */
  async readVoiceSpeed(): Promise<RealtimeVoiceSpeed | undefined> {
    return (await this.#load()).voiceSpeed;
  }

  /** Stores the chosen pace, or returns to the default when omitted. */
  async setVoiceSpeed(speed: RealtimeVoiceSpeed | undefined): Promise<SettingsUpdateResult> {
    await this.#serialize(async () => {
      const persisted = await this.#load();
      if (persisted.voiceSpeed === speed) return;
      const next: PersistedSettings = {
        ...persisted,
        version: SETTINGS_FILE_VERSION,
      };
      if (speed) next.voiceSpeed = speed;
      else delete next.voiceSpeed;
      await this.#write(next);
      this.#loading = Promise.resolve(next);
    });
    return { settings: await this.snapshot() };
  }

  /**
   * Turns the on-screen caption of Luke's speech on or off. A plain preference
   * like the menu bar's, and the same shape of change: nothing here needs the
   * cipher, and there is no way to enter an invalid value, so the write either
   * lands or throws.
   */
  async setVoiceCaptions(enabled: boolean): Promise<SettingsUpdateResult> {
    await this.#serialize(async () => {
      const persisted = await this.#load();
      if (persisted.voiceCaptions === enabled) return;
      const next: PersistedSettings = {
        ...persisted,
        version: SETTINGS_FILE_VERSION,
        voiceCaptions: enabled,
      };
      await this.#write(next);
      this.#loading = Promise.resolve(next);
    });
    return { settings: await this.snapshot() };
  }

  /**
   * Main-process only, for registration at startup: the talk-key chord the
   * user chose, or nothing while the defaults stand — the registrar already
   * carries those.
   */
  async readVoiceHotkey(): Promise<string | undefined> {
    return (await this.#load()).voiceHotkey;
  }

  /**
   * Stores the chosen talk-key chord, or returns to the defaults when
   * omitted. The caller hands in a chord already read into its one canonical
   * spelling; what arrives here is written as given, so resetting is the
   * absence of a choice rather than a second stored value.
   */
  async setVoiceHotkey(accelerator: string | undefined): Promise<SettingsUpdateResult> {
    await this.#serialize(async () => {
      const persisted = await this.#load();
      if (persisted.voiceHotkey === accelerator) return;
      const next: PersistedSettings = {
        ...persisted,
        version: SETTINGS_FILE_VERSION,
      };
      if (accelerator) next.voiceHotkey = accelerator;
      else delete next.voiceHotkey;
      await this.#write(next);
      this.#loading = Promise.resolve(next);
    });
    return { settings: await this.snapshot() };
  }

  /**
   * Main-process only, like the talk key's: the ask-key chord the user chose,
   * for registration at startup, or nothing while the defaults stand.
   */
  async readAskHotkey(): Promise<string | undefined> {
    return (await this.#load()).askHotkey;
  }

  /**
   * Stores the chosen ask-key chord, or returns to the defaults when omitted,
   * on the talk key's exact terms: the chord arrives already read into its one
   * canonical spelling, and resetting is the absence of a choice.
   */
  async setAskHotkey(accelerator: string | undefined): Promise<SettingsUpdateResult> {
    await this.#serialize(async () => {
      const persisted = await this.#load();
      if (persisted.askHotkey === accelerator) return;
      const next: PersistedSettings = {
        ...persisted,
        version: SETTINGS_FILE_VERSION,
      };
      if (accelerator) next.askHotkey = accelerator;
      else delete next.askHotkey;
      await this.#write(next);
      this.#loading = Promise.resolve(next);
    });
    return { settings: await this.snapshot() };
  }

  /**
   * Main-process only, like the other two keys': the stop-key chord the user
   * chose, for registration at startup, or nothing while the default stands.
   */
  async readStopHotkey(): Promise<string | undefined> {
    return (await this.#load()).stopHotkey;
  }

  /**
   * Stores the chosen stop-key chord, or returns to the default when omitted,
   * on the other two keys' exact terms: the chord arrives already read into
   * its one canonical spelling, and resetting is the absence of a choice.
   */
  async setStopHotkey(accelerator: string | undefined): Promise<SettingsUpdateResult> {
    await this.#serialize(async () => {
      const persisted = await this.#load();
      if (persisted.stopHotkey === accelerator) return;
      const next: PersistedSettings = {
        ...persisted,
        version: SETTINGS_FILE_VERSION,
      };
      if (accelerator) next.stopHotkey = accelerator;
      else delete next.stopHotkey;
      await this.#write(next);
      this.#loading = Promise.resolve(next);
    });
    return { settings: await this.snapshot() };
  }

  /**
   * Turns the quieting of Music and Spotify during a spoken exchange on or
   * off. A plain preference like the caption's: no cipher, no invalid value,
   * so the write either lands or throws.
   */
  async setDuckOtherMedia(enabled: boolean): Promise<SettingsUpdateResult> {
    await this.#serialize(async () => {
      const persisted = await this.#load();
      if (persisted.duckOtherMedia === enabled) return;
      const next: PersistedSettings = {
        ...persisted,
        version: SETTINGS_FILE_VERSION,
        duckOtherMedia: enabled,
      };
      await this.#write(next);
      this.#loading = Promise.resolve(next);
    });
    return { settings: await this.snapshot() };
  }

  /**
   * Shallow like `showInDock()`: the displays Luke stands on are decided at
   * launch from the settings file alone, never the keychain.
   */
  async readShowOnAllDisplays(): Promise<boolean> {
    return (await this.#load()).showOnAllDisplays;
  }

  /**
   * Remembers whether Luke stands on every display or the main one alone. A
   * preference like the Dock's, and held to the same rule: nothing here
   * touches the cipher.
   */
  async setShowOnAllDisplays(show: boolean): Promise<SettingsUpdateResult> {
    await this.#serialize(async () => {
      const persisted = await this.#load();
      if (persisted.showOnAllDisplays === show) return;
      const next: PersistedSettings = {
        ...persisted,
        version: SETTINGS_FILE_VERSION,
        showOnAllDisplays: show,
      };
      await this.#write(next);
      this.#loading = Promise.resolve(next);
    });
    return { settings: await this.snapshot() };
  }

  /**
   * Shallow for the same reason as `readShowOnAllDisplays()`: the windows are
   * placed at launch from the settings file alone, never the keychain.
   */
  async readFormFactor(): Promise<PanelFormFactor | undefined> {
    return (await this.#load()).formFactor;
  }

  /** Stores the chosen form, or returns to the default when omitted. */
  async setFormFactor(formFactor: PanelFormFactor | undefined): Promise<SettingsUpdateResult> {
    await this.#serialize(async () => {
      const persisted = await this.#load();
      if (persisted.formFactor === formFactor) return;
      const next: PersistedSettings = {
        ...persisted,
        version: SETTINGS_FILE_VERSION,
      };
      if (formFactor) next.formFactor = formFactor;
      else delete next.formFactor;
      await this.#write(next);
      this.#loading = Promise.resolve(next);
    });
    return { settings: await this.snapshot() };
  }

  /**
   * Main-process only: the resolved key used to authenticate that provider's
   * reads. A provider with no key resolves to nothing, so its adapter observes
   * nothing and issues no request.
   */
  async readApiKey(providerId: CredentialProviderId): Promise<string | undefined> {
    const provider = this.#providers.find((candidate) => candidate.id === providerId);
    if (!provider) return undefined;
    return (await this.#resolveApiKey(provider)).apiKey;
  }

  /**
   * Stores one provider's key encrypted at rest, or clears it when omitted. A
   * key the user cannot use comes back as a `reason` rather than an exception,
   * so only an unexpected filesystem failure throws.
   */
  async setApiKey(
    providerId: CredentialProviderId,
    apiKey: string | undefined,
  ): Promise<SettingsUpdateResult> {
    const keyFormat = this.#providers.find((candidate) => candidate.id === providerId)?.keyFormat;
    const normalized = apiKey?.trim();
    // Clearing a key needs no cipher, so only a key on its way in asks whether
    // there is anywhere to put it.
    const rejection = normalized
      ? !this.#secretStorageUsable()
        ? "Encrypted credential storage is unavailable on this system."
        : apiKeyRejection(normalized, keyFormat)
      : undefined;
    if (rejection) return { settings: await this.snapshot(), reason: rejection };

    await this.#serialize(async () => {
      const persisted = await this.#load();
      const ciphertext = normalized
        ? this.#cipher.encrypt(normalized).toString("base64")
        : undefined;
      if (persisted.apiKeys[providerId] === ciphertext) return;
      // Every other provider's ciphertext is carried over, so saving one key
      // never disturbs another.
      const apiKeys = { ...persisted.apiKeys };
      if (ciphertext) apiKeys[providerId] = ciphertext;
      else delete apiKeys[providerId];
      const next: PersistedSettings = {
        ...persisted,
        version: SETTINGS_FILE_VERSION,
        apiKeys,
      };
      await this.#write(next);
      this.#loading = Promise.resolve(next);
      this.#resolved.delete(providerId);
    });
    return { settings: await this.snapshot() };
  }

  /**
   * Remembers whether the menu bar status item is drawn. A preference is not a
   * credential, so nothing here touches the cipher: storing this choice must
   * never be the reason the Keychain dialog appears.
   */
  async setShowInMenuBar(show: boolean): Promise<SettingsUpdateResult> {
    await this.#serialize(async () => {
      const persisted = await this.#load();
      if (persisted.showInMenuBar === show) return;
      const next: PersistedSettings = {
        ...persisted,
        version: SETTINGS_FILE_VERSION,
        showInMenuBar: show,
      };
      await this.#write(next);
      this.#loading = Promise.resolve(next);
    });
    return { settings: await this.snapshot() };
  }

  /**
   * Remembers whether Luke stands in the Dock. A preference like the menu
   * bar's, and held to the same rule: nothing here touches the cipher.
   */
  async setShowInDock(show: boolean): Promise<SettingsUpdateResult> {
    await this.#serialize(async () => {
      const persisted = await this.#load();
      if (persisted.showInDock === show) return;
      const next: PersistedSettings = {
        ...persisted,
        version: SETTINGS_FILE_VERSION,
        showInDock: show,
      };
      await this.#write(next);
      this.#loading = Promise.resolve(next);
    });
    return { settings: await this.snapshot() };
  }

  /**
   * Runs one settings change at a time. Serializing only the file write is not
   * enough: a user with more than one provider row can start a second save
   * before the first lands, and both would read the same stored keys before
   * either wrote, so the later write would drop the other provider's key.
   */
  async #serialize<Result>(operation: () => Promise<Result>): Promise<Result> {
    const result = this.#mutations.then(operation);
    // A failed change must not wedge the queue, so the chain forgets its
    // outcome; the caller still receives the rejection.
    this.#mutations = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /**
   * Asks the cipher whether it can protect a key, and remembers the answer. The
   * question is asked at most once per run, and only from a path that has a
   * credential in hand: on macOS asking is a Keychain read, which is the
   * permission dialog this deliberately keeps out of an ordinary launch.
   */
  #secretStorageUsable(): boolean {
    if (this.#secretStorage === SECRET_STORAGE.UNKNOWN) {
      let available = false;
      try {
        available = this.#cipher.isAvailable();
      } catch {
        available = false;
      }
      this.#secretStorage = available ? SECRET_STORAGE.AVAILABLE : SECRET_STORAGE.UNAVAILABLE;
    }
    return this.#secretStorage === SECRET_STORAGE.AVAILABLE;
  }

  /**
   * The resolved key is cached because the observation timer asks for it every
   * few seconds, and decrypting on each tick would hit the OS keychain
   * thousands of times a day for a value only the user can change.
   */
  async #resolveApiKey(provider: CredentialProvider): Promise<ResolvedApiKey> {
    const cached = this.#resolved.get(provider.id);
    if (cached) return cached;
    const stored = await this.#storedApiKey(provider);
    const fromEnvironment = stored ? undefined : environmentApiKey(provider, this.#environment);
    const resolved: ResolvedApiKey = stored
      ? { apiKey: stored, source: CREDENTIAL_SOURCE.ENCRYPTED_FILE }
      : fromEnvironment
        ? { apiKey: fromEnvironment, source: CREDENTIAL_SOURCE.ENVIRONMENT }
        : { source: CREDENTIAL_SOURCE.NONE };
    this.#resolved.set(provider.id, resolved);
    return resolved;
  }

  async #storedApiKey(provider: CredentialProvider): Promise<string | undefined> {
    const ciphertext = (await this.#load()).apiKeys[provider.id];
    if (!ciphertext) return undefined;
    try {
      const apiKey = this.#cipher.decrypt(Buffer.from(ciphertext, "base64")).trim();
      // A key stored before this build learned which kind the provider issues
      // is held to the same rule, so a rule added later takes effect at once.
      return apiKey && !apiKeyRejection(apiKey, provider.keyFormat) ? apiKey : undefined;
    } catch {
      // A key encrypted under a different account, or against a rotated
      // Keychain entry, cannot be recovered; the user re-enters it instead.
      return undefined;
    }
  }

  /** Memoizes the in-flight read so concurrent first callers share one open. */
  async #load(): Promise<PersistedSettings> {
    this.#loading ??= this.#readPersisted();
    return this.#loading;
  }

  async #readPersisted(): Promise<PersistedSettings> {
    const settingsPath = path.join(this.#directory(), SETTINGS_FILE_NAME);
    let source: string | undefined;
    try {
      source = await fs.readFile(settingsPath, "utf8");
    } catch (error) {
      if (!canIgnoreFilesystemError(error)) throw error;
    }

    let persisted: PersistedSettings = {
      version: SETTINGS_FILE_VERSION,
      apiKeys: {},
      showInDock: false,
      showInMenuBar: true,
      voiceCaptions: false,
      duckOtherMedia: true,
      showOnAllDisplays: false,
    };
    if (source) {
      try {
        persisted = parsePersistedSettings(source);
      } catch {
        // A corrupt settings file is replaced by the next write rather than
        // failing app start.
      }
    }
    return persisted;
  }

  /** Only ever called from inside `#serialize`, so writes cannot interleave. */
  async #write(persisted: PersistedSettings): Promise<void> {
    const directory = this.#directory();
    const settingsPath = path.join(directory, SETTINGS_FILE_NAME);
    const temporaryPath = path.join(directory, SETTINGS_TEMPORARY_FILE_NAME);
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(temporaryPath, `${JSON.stringify(persisted, undefined, 2)}\n`, {
      encoding: "utf8",
      mode: SETTINGS_FILE_MODE,
    });
    // `mode` only applies when the file is created, so a temporary file left
    // behind by an interrupted write keeps whatever mode it already had.
    await fs.chmod(temporaryPath, SETTINGS_FILE_MODE);
    await fs.rename(temporaryPath, settingsPath);
  }
}
