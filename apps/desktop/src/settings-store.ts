import fs from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_PANEL_FORM_FACTOR,
  isPanelFormFactor,
  isProviderId,
  isRealtimeVoice,
  isRealtimeVoiceSpeed,
  type PanelFormFactor,
  type ProviderId,
  REALTIME_DEFAULTS,
  type RealtimeVoice,
  type RealtimeVoiceSpeed,
  type WorkspaceAgentSelection,
} from "@sidecar/core";
// The reader owns the shape it is fed: what this store resolves a stored
// account into is exactly what `readAccounts` promises it.
import type { CalendarAccountCredential } from "./google-calendar";
import { googleCalendarSignInConfig } from "./google-calendar-oauth";
import { environmentRealtimeSpeed, environmentRealtimeVoice } from "./openai-realtime-credentials";
import {
  ACCOUNT_PROVIDER,
  ACCOUNT_STATUS,
  type AccountProvider,
  type AccountSnapshot,
  APP_SETTING_DEFAULTS,
  type AppSettings,
  CREDENTIAL_SOURCE,
  type CredentialSource,
  SECRET_STORAGE,
  SETTINGS_RESET_SCOPE,
  type SecretStorage,
  type SettingsResetScope,
  type SettingsUpdateResult,
} from "./shared/contracts";
import {
  CREDENTIAL_PROVIDER_ID,
  CREDENTIAL_PROVIDER_LIST,
  type CredentialFormat,
  type CredentialProvider,
  type CredentialProviderId,
  VOICE_CREDENTIAL_PROVIDER_ID,
} from "./shared/credential-providers";
import { parseVoiceHotkey } from "./shared/voice-hotkey";
import { isWorkspaceAgentSelection } from "./shared/workspace-agents";

const SETTINGS_FILE_NAME = "settings.json";
const SETTINGS_TEMPORARY_FILE_NAME = "settings.json.tmp";
/** Version 2 keys credentials by provider id; version 1 held one Conductor key. */
const SETTINGS_FILE_VERSION = 2;
const SETTINGS_FILE_MODE = 0o600;

const SETTINGS_FIELD = {
  ACCOUNT: "account",
  API_KEYS: "apiKeys",
  CALENDAR_ACCOUNTS: "calendarAccounts",
  ASK_HOTKEY: "askHotkey",
  DEFAULT_WORKSPACE_PROVIDER: "defaultWorkspaceProvider",
  DUCK_OTHER_MEDIA: "duckOtherMedia",
  PREFER_BUILT_IN_MICROPHONE: "preferBuiltInMicrophone",
  FEEDBACK_SENDS: "feedbackSends",
  FORM_FACTOR: "formFactor",
  LEGACY_CONDUCTOR_API_KEY: "conductorApiKey",
  QUIET_DURING_MEETINGS: "quietDuringMeetings",
  SHOW_IN_DOCK: "showInDock",
  SHOW_IN_MENU_BAR: "showInMenuBar",
  SHOW_ON_ALL_DISPLAYS: "showOnAllDisplays",
  STOP_HOTKEY: "stopHotkey",
  VERSION: "version",
  VOICE: "voice",
  VOICE_CAPTIONS: "voiceCaptions",
  VOICE_SPEED: "voiceSpeed",
  VOICE_HOTKEY: "voiceHotkey",
  WORKSPACE_AGENT_DEFAULTS: "workspaceAgentDefaults",
  WORKSPACE_PROJECT_DEFAULTS: "workspaceProjectDefaults",
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
  /**
   * Whether this run will use the credentials it resolves. A fixture or evidence
   * run will not, and the panel has to mark what would actually happen rather
   * than what is stored — so `voiceAvailable` is false there however good the
   * key is. Only the app knows which kind of run this is. True by default.
   */
  credentialsUsable?: boolean;
}

interface PersistedSettings {
  version: number;
  /**
   * Ciphertext by provider id. A provider this build does not know is carried
   * through untouched so an older build cannot discard a newer one's key.
   */
  apiKeys: Readonly<Record<string, string>>;
  /** Account tokens encrypted together; only display identity stays plaintext. */
  account?: {
    tokenCipher: string;
    email: string;
    name?: string;
    pictureUrl?: string;
    provider: AccountProvider;
  };
  /**
   * The connected calendar accounts: each account's id, the grant its sign-in
   * produced as ciphertext, and the calendar ids the user chose to count.
   * Absent from the file while none are connected.
   */
  calendarAccounts?: readonly PersistedCalendarAccount[];
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
  preferBuiltInMicrophone: boolean;
  /**
   * How many feedback sends have landed from this machine, so the composer's
   * confirmation can pick which little celebration each delivery gets.
   * Bookkeeping rather than a preference: it has no row, no reset scope
   * forgets it, and it never reaches the renderer's settings snapshot. A
   * missing field and a corrupt value both read as none yet.
   */
  feedbackSends?: number;
  /**
   * Whether announcements wait out calendar meetings. On unless the file says
   * `false` outright, on the media duck's own reasoning: this is what Luke
   * does with a connected calendar until the user asks otherwise, so a
   * missing field and a corrupt value both land on doing it.
   */
  quietDuringMeetings: boolean;
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
  /**
   * The provider a conversational ask creates a workspace in when it names
   * none, absent until the user's first creation chooses it. Held to the
   * providers this build knows: an unknown id is dropped rather than steered
   * by, because it names nowhere an ask could actually go.
   */
  defaultWorkspaceProvider?: ProviderId;
  /**
   * The agent kind and model new workspaces start with, per provider, each
   * entry absent while that provider's own defaults stand. Held to the
   * build's documented table twice over: an unknown provider and an unlisted
   * pairing are both dropped, because each names something no endpoint takes.
   */
  workspaceAgentDefaults?: Readonly<Partial<Record<ProviderId, WorkspaceAgentSelection>>>;
  /**
   * The project a nameless creation ask lands in, per provider, each entry
   * absent until the user's first creation there chooses it. Projects are
   * observed rather than build-fixed, so only the value's shape can be held
   * here — an unknown provider or a malformed id is dropped, and whether the
   * project is still offered is answered where the list lives: the id only
   * ever steers, and every creation is validated against the observed list.
   */
  workspaceProjectDefaults?: Readonly<Partial<Record<ProviderId, string>>>;
}

interface ResolvedApiKey {
  apiKey?: string;
  source: CredentialSource;
}

export interface StoredAccount {
  accessToken: string;
  refreshToken: string;
  email: string;
  name?: string;
  pictureUrl?: string;
  provider: AccountProvider;
}

function isAccountProvider(value: unknown): value is AccountProvider {
  return value === ACCOUNT_PROVIDER.GOOGLE || value === ACCOUNT_PROVIDER.GITHUB;
}

function storedAccount(record: Record<string, unknown>): PersistedSettings["account"] {
  const value = record[SETTINGS_FIELD.ACCOUNT];
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const account = value as Record<string, unknown>;
  if (
    typeof account.tokenCipher !== "string" ||
    !account.tokenCipher ||
    typeof account.email !== "string" ||
    !account.email ||
    !isAccountProvider(account.provider)
  ) {
    return undefined;
  }
  return {
    tokenCipher: account.tokenCipher,
    email: account.email,
    ...(typeof account.name === "string" && account.name ? { name: account.name } : {}),
    ...(typeof account.pictureUrl === "string" && account.pictureUrl
      ? { pictureUrl: account.pictureUrl }
      : {}),
    provider: account.provider,
  };
}

interface PersistedCalendarAccount {
  id: string;
  /** The sign-in's grant, encrypted like every credential. */
  token: string;
  /** The calendar ids the user chose to count toward meetings. */
  calendars: readonly string[];
}

/** An account or calendar id reads like one wire value; longer is not an id. */
const MAXIMUM_CALENDAR_IDENTIFIER_LENGTH = 200;
/** More accounts than one person signs into; a cap, not a plan. */
const MAXIMUM_CALENDAR_ACCOUNTS = 10;
/** More calendars than anyone counts meetings from. */
const MAXIMUM_SELECTED_CALENDARS = 50;

/** A calendar-world identifier as this store will keep it, or nothing. */
function calendarIdentifierText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized || normalized.length > MAXIMUM_CALENDAR_IDENTIFIER_LENGTH) return undefined;
  return normalized;
}

/** Reads the stored calendar accounts, keeping only well-formed entries. */
function storedCalendarAccounts(
  record: Record<string, unknown>,
): readonly PersistedCalendarAccount[] {
  const persisted = record[SETTINGS_FIELD.CALENDAR_ACCOUNTS];
  if (!Array.isArray(persisted)) return [];
  const accounts: PersistedCalendarAccount[] = [];
  for (const entry of persisted) {
    if (accounts.length >= MAXIMUM_CALENDAR_ACCOUNTS) break;
    if (entry === null || typeof entry !== "object") continue;
    const { id, token, calendars } = entry as Record<string, unknown>;
    const accountId = calendarIdentifierText(id);
    if (!accountId || typeof token !== "string" || !token) continue;
    if (accounts.some((held) => held.id === accountId)) continue;
    const selected = Array.isArray(calendars)
      ? calendars
          .map(calendarIdentifierText)
          .filter((value): value is string => value !== undefined)
          .slice(0, MAXIMUM_SELECTED_CALENDARS)
      : [];
    accounts.push({ id: accountId, token, calendars: selected });
  }
  return accounts;
}

/**
 * Reads a stored switch: a boolean is honoured, and anything else — a missing
 * field, an older file, a corrupt value — lands on the stated default rather
 * than switching anything on or off by accident.
 */
function booleanSetting(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
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

/**
 * Reads the stored per-provider agent choices, keeping only entries the
 * build's own table lists. A file written by another build may pair an agent
 * with a model this one does not know; honouring it would send a value no
 * documented endpoint takes, so it is dropped the way an unknown voice is.
 */
function storedWorkspaceAgentDefaults(
  record: Record<string, unknown>,
): Partial<Record<ProviderId, WorkspaceAgentSelection>> | undefined {
  const persisted = record[SETTINGS_FIELD.WORKSPACE_AGENT_DEFAULTS];
  if (persisted === null || typeof persisted !== "object" || Array.isArray(persisted)) {
    return undefined;
  }
  const defaults: Partial<Record<ProviderId, WorkspaceAgentSelection>> = {};
  for (const [providerId, value] of Object.entries(persisted)) {
    if (!isProviderId(providerId)) continue;
    if (!isWorkspaceAgentSelection(providerId, value)) continue;
    defaults[providerId] = {
      agent: value.agent,
      model: value.model,
      ...(value.effort !== undefined ? { effort: value.effort } : {}),
    };
  }
  return Object.keys(defaults).length > 0 ? defaults : undefined;
}

/** A stored project id reads like one wire value; anything longer is not an id. */
const MAXIMUM_WORKSPACE_PROJECT_ID_LENGTH = 200;

/** A provider's project id as this store will keep it, or nothing. */
function workspaceProjectIdText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized || normalized.length > MAXIMUM_WORKSPACE_PROJECT_ID_LENGTH) return undefined;
  return normalized;
}

/**
 * Reads the stored per-provider project choices, keeping only entries whose
 * provider this build knows and whose value has an id's shape. Whether the
 * project is still offered cannot be answered here — the list is observed at
 * run time — so a stale id is carried and simply steers nothing until its
 * provider offers that project again.
 */
function storedWorkspaceProjectDefaults(
  record: Record<string, unknown>,
): Partial<Record<ProviderId, string>> | undefined {
  const persisted = record[SETTINGS_FIELD.WORKSPACE_PROJECT_DEFAULTS];
  if (persisted === null || typeof persisted !== "object" || Array.isArray(persisted)) {
    return undefined;
  }
  const defaults: Partial<Record<ProviderId, string>> = {};
  for (const [providerId, value] of Object.entries(persisted)) {
    if (!isProviderId(providerId)) continue;
    const providerProjectId = workspaceProjectIdText(value);
    if (!providerProjectId) continue;
    defaults[providerId] = providerProjectId;
  }
  return Object.keys(defaults).length > 0 ? defaults : undefined;
}

function parsePersistedSettings(source: string): PersistedSettings {
  const parsed: unknown = JSON.parse(source);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Settings file is not an object");
  }
  const record = parsed as Record<string, unknown>;
  const version = record[SETTINGS_FIELD.VERSION];
  const calendarAccounts = storedCalendarAccounts(record);
  const voice = record[SETTINGS_FIELD.VOICE];
  const voiceSpeed = record[SETTINGS_FIELD.VOICE_SPEED];
  const formFactor = record[SETTINGS_FIELD.FORM_FACTOR];
  const defaultWorkspaceProvider = record[SETTINGS_FIELD.DEFAULT_WORKSPACE_PROVIDER];
  const workspaceAgentDefaults = storedWorkspaceAgentDefaults(record);
  const workspaceProjectDefaults = storedWorkspaceProjectDefaults(record);
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
  const storedFeedbackSends = record[SETTINGS_FIELD.FEEDBACK_SENDS];
  const feedbackSends =
    typeof storedFeedbackSends === "number" &&
    Number.isSafeInteger(storedFeedbackSends) &&
    storedFeedbackSends > 0
      ? storedFeedbackSends
      : undefined;
  return {
    version: typeof version === "number" ? version : SETTINGS_FILE_VERSION,
    apiKeys: storedApiKeys(record),
    ...(storedAccount(record) ? { account: storedAccount(record) } : {}),
    ...(calendarAccounts.length > 0 ? { calendarAccounts } : {}),
    showInDock: booleanSetting(
      record[SETTINGS_FIELD.SHOW_IN_DOCK],
      APP_SETTING_DEFAULTS.showInDock,
    ),
    showInMenuBar: booleanSetting(
      record[SETTINGS_FIELD.SHOW_IN_MENU_BAR],
      APP_SETTING_DEFAULTS.showInMenuBar,
    ),
    // A voice this build does not offer is dropped rather than carried: unlike
    // a credential it has a default to fall back to, and honouring an unknown
    // one would mint sessions the API refuses.
    ...(isRealtimeVoice(voice) ? { voice } : {}),
    // A pace outside the offered set is dropped for the same reason.
    ...(isRealtimeVoiceSpeed(voiceSpeed) ? { voiceSpeed } : {}),
    voiceCaptions: booleanSetting(
      record[SETTINGS_FIELD.VOICE_CAPTIONS],
      APP_SETTING_DEFAULTS.voiceCaptions,
    ),
    ...(voiceHotkey ? { voiceHotkey } : {}),
    ...(askHotkey ? { askHotkey } : {}),
    ...(stopHotkey ? { stopHotkey } : {}),
    duckOtherMedia: booleanSetting(
      record[SETTINGS_FIELD.DUCK_OTHER_MEDIA],
      APP_SETTING_DEFAULTS.duckOtherMedia,
    ),
    preferBuiltInMicrophone: booleanSetting(
      record[SETTINGS_FIELD.PREFER_BUILT_IN_MICROPHONE],
      APP_SETTING_DEFAULTS.preferBuiltInMicrophone,
    ),
    // A count that is not a whole non-negative number reads as none yet: the
    // worst a corrupt value can cost is replaying the first send's scene.
    ...(feedbackSends !== undefined ? { feedbackSends } : {}),
    quietDuringMeetings: booleanSetting(
      record[SETTINGS_FIELD.QUIET_DURING_MEETINGS],
      APP_SETTING_DEFAULTS.quietDuringMeetings,
    ),
    showOnAllDisplays: booleanSetting(
      record[SETTINGS_FIELD.SHOW_ON_ALL_DISPLAYS],
      APP_SETTING_DEFAULTS.showOnAllDisplays,
    ),
    // A form this build does not draw is dropped like an unknown voice.
    ...(isPanelFormFactor(formFactor) ? { formFactor } : {}),
    // A provider this build does not know is dropped the same way: it names
    // nowhere a creation ask could go, so honouring it would steer nothing.
    ...(typeof defaultWorkspaceProvider === "string" && isProviderId(defaultWorkspaceProvider)
      ? { defaultWorkspaceProvider }
      : {}),
    ...(workspaceAgentDefaults ? { workspaceAgentDefaults } : {}),
    ...(workspaceProjectDefaults ? { workspaceProjectDefaults } : {}),
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
  readonly #credentialsUsable: boolean;
  #loading: Promise<PersistedSettings> | undefined;
  #resolved = new Map<CredentialProviderId, ResolvedApiKey>();
  /** Decrypted accounts, cached like the keys so timers never drum the Keychain. */
  #resolvedCalendarAccounts: readonly CalendarAccountCredential[] | undefined;
  #mutations: Promise<void> = Promise.resolve();
  #secretStorage: SecretStorage = SECRET_STORAGE.UNKNOWN;

  constructor(options: SettingsStoreOptions) {
    this.#directory = options.directory;
    this.#cipher = options.cipher;
    this.#environment = options.environment ?? process.env;
    this.#providers = options.providers ?? CREDENTIAL_PROVIDER_LIST;
    this.#credentialsUsable = options.credentialsUsable ?? true;
  }

  async snapshot(): Promise<AppSettings> {
    const persisted = await this.#load();
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
      // Whether a spoken turn could actually be minted: a key resolved, and this
      // run will use it. Resolved here rather than left to the panel because it
      // is the same question the voice and the pace are answered by — what would
      // actually happen — and it travels with every settings reply, so storing a
      // key is what turns voice on and deleting one is what turns it off.
      voiceAvailable: await this.#voiceAvailable(),
      // Whether this build can offer the Google Calendar sign-in at all: a
      // registered OAuth client resolved, and this run would use what it
      // grants. Without one the integration is not drawn at all.
      calendarSignInAvailable:
        this.#credentialsUsable && googleCalendarSignInConfig(this.#environment) !== undefined,
      // The accounts without their grants: which are connected and which
      // calendars count is the renderer's to draw; the tokens never travel.
      calendarAccounts: (persisted.calendarAccounts ?? []).map((account) => ({
        id: account.id,
        selectedCalendarIds: account.calendars,
      })),
      showInDock: persisted.showInDock,
      showInMenuBar: persisted.showInMenuBar,
      // Resolved the way the minter resolves it, so the panel marks the voice
      // that would actually be heard.
      voice:
        persisted.voice ?? environmentRealtimeVoice(this.#environment) ?? REALTIME_DEFAULTS.VOICE,
      voiceSpeed:
        persisted.voiceSpeed ??
        environmentRealtimeSpeed(this.#environment) ??
        REALTIME_DEFAULTS.SPEED,
      voiceCaptions: persisted.voiceCaptions,
      ...(persisted.voiceHotkey ? { voiceHotkey: persisted.voiceHotkey } : {}),
      ...(persisted.askHotkey ? { askHotkey: persisted.askHotkey } : {}),
      ...(persisted.stopHotkey ? { stopHotkey: persisted.stopHotkey } : {}),
      duckOtherMedia: persisted.duckOtherMedia,
      preferBuiltInMicrophone: persisted.preferBuiltInMicrophone,
      quietDuringMeetings: persisted.quietDuringMeetings,
      showOnAllDisplays: persisted.showOnAllDisplays,
      formFactor: persisted.formFactor ?? DEFAULT_PANEL_FORM_FACTOR,
      ...(persisted.defaultWorkspaceProvider
        ? { defaultWorkspaceProvider: persisted.defaultWorkspaceProvider }
        : {}),
      ...(persisted.workspaceAgentDefaults
        ? { workspaceAgentDefaults: persisted.workspaceAgentDefaults }
        : {}),
      ...(persisted.workspaceProjectDefaults
        ? { workspaceProjectDefaults: persisted.workspaceProjectDefaults }
        : {}),
    };
  }

  /** Returns account credentials only to the main process. */
  async readAccount(): Promise<StoredAccount | undefined> {
    const account = (await this.#load()).account;
    if (!account) return undefined;
    try {
      const tokens: unknown = JSON.parse(
        this.#cipher.decrypt(Buffer.from(account.tokenCipher, "base64")),
      );
      if (tokens === null || typeof tokens !== "object" || Array.isArray(tokens)) return undefined;
      const { accessToken, refreshToken } = tokens as Record<string, unknown>;
      if (typeof accessToken !== "string" || typeof refreshToken !== "string") return undefined;
      return {
        accessToken,
        refreshToken,
        email: account.email,
        ...(account.name ? { name: account.name } : {}),
        ...(account.pictureUrl ? { pictureUrl: account.pictureUrl } : {}),
        provider: account.provider,
      };
    } catch {
      return undefined;
    }
  }

  async accountSnapshot(): Promise<AccountSnapshot> {
    const account = await this.readAccount();
    return account
      ? {
          status: ACCOUNT_STATUS.SIGNED_IN,
          email: account.email,
          ...(account.name ? { name: account.name } : {}),
          ...(account.pictureUrl ? { pictureUrl: account.pictureUrl } : {}),
          provider: account.provider,
        }
      : { status: ACCOUNT_STATUS.SIGNED_OUT };
  }

  /** Stores both OAuth tokens under one Keychain-backed ciphertext. */
  async setAccount(account: StoredAccount): Promise<AccountSnapshot> {
    if (!this.#secretStorageUsable()) {
      throw new Error("Encrypted credential storage is unavailable on this system.");
    }
    await this.#serialize(async () => {
      const persisted = await this.#load();
      const tokenCipher = this.#cipher
        .encrypt(
          JSON.stringify({
            accessToken: account.accessToken,
            refreshToken: account.refreshToken,
          }),
        )
        .toString("base64");
      const next: PersistedSettings = {
        ...persisted,
        version: SETTINGS_FILE_VERSION,
        account: {
          tokenCipher,
          email: account.email,
          ...(account.name ? { name: account.name } : {}),
          ...(account.pictureUrl ? { pictureUrl: account.pictureUrl } : {}),
          provider: account.provider,
        },
      };
      await this.#write(next);
      this.#loading = Promise.resolve(next);
    });
    return this.accountSnapshot();
  }

  async clearAccount(): Promise<AccountSnapshot> {
    await this.#serialize(async () => {
      const persisted = await this.#load();
      if (!persisted.account) return;
      const { account: _account, ...withoutAccount } = persisted;
      const next: PersistedSettings = { ...withoutAccount, version: SETTINGS_FILE_VERSION };
      await this.#write(next);
      this.#loading = Promise.resolve(next);
    });
    return { status: ACCOUNT_STATUS.SIGNED_OUT };
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
    return this.#setField((persisted) => {
      if (persisted.voice === voice) return;
      const next: PersistedSettings = { ...persisted };
      if (voice) next.voice = voice;
      else delete next.voice;
      return next;
    });
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
    return this.#setField((persisted) => {
      if (persisted.voiceSpeed === speed) return;
      const next: PersistedSettings = { ...persisted };
      if (speed) next.voiceSpeed = speed;
      else delete next.voiceSpeed;
      return next;
    });
  }

  /**
   * Turns the on-screen caption of Luke's speech on or off. A plain preference
   * like the menu bar's, and the same shape of change: nothing here needs the
   * cipher, and there is no way to enter an invalid value, so the write either
   * lands or throws.
   */
  async setVoiceCaptions(enabled: boolean): Promise<SettingsUpdateResult> {
    return this.#setField((persisted) => {
      if (persisted.voiceCaptions === enabled) return;
      return { ...persisted, voiceCaptions: enabled };
    });
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
    return this.#setField((persisted) => {
      if (persisted.voiceHotkey === accelerator) return;
      const next: PersistedSettings = { ...persisted };
      if (accelerator) next.voiceHotkey = accelerator;
      else delete next.voiceHotkey;
      return next;
    });
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
    return this.#setField((persisted) => {
      if (persisted.askHotkey === accelerator) return;
      const next: PersistedSettings = { ...persisted };
      if (accelerator) next.askHotkey = accelerator;
      else delete next.askHotkey;
      return next;
    });
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
    return this.#setField((persisted) => {
      if (persisted.stopHotkey === accelerator) return;
      const next: PersistedSettings = { ...persisted };
      if (accelerator) next.stopHotkey = accelerator;
      else delete next.stopHotkey;
      return next;
    });
  }

  /**
   * Turns the quieting of Music and Spotify during a spoken exchange on or
   * off. A plain preference like the caption's: no cipher, no invalid value,
   * so the write either lands or throws.
   */
  async setPreferBuiltInMicrophone(enabled: boolean): Promise<SettingsUpdateResult> {
    return this.#setField((persisted) => {
      if (persisted.preferBuiltInMicrophone === enabled) return;
      return { ...persisted, preferBuiltInMicrophone: enabled };
    });
  }

  async setDuckOtherMedia(enabled: boolean): Promise<SettingsUpdateResult> {
    return this.#setField((persisted) => {
      if (persisted.duckOtherMedia === enabled) return;
      return { ...persisted, duckOtherMedia: enabled };
    });
  }

  /**
   * Counts a landed send and answers how many landed before it, so the
   * composer's confirmation can pick which celebration this delivery gets.
   * Not `#setField`, because the caller needs the count the write was based
   * on, not the settings snapshot — and the snapshot must never carry this:
   * it is bookkeeping about the machine, not a preference with a row.
   */
  async countFeedbackSend(): Promise<number> {
    let before = 0;
    await this.#serialize(async () => {
      const persisted = await this.#load();
      before = persisted.feedbackSends ?? 0;
      const next: PersistedSettings = {
        ...persisted,
        feedbackSends: before + 1,
        version: SETTINGS_FILE_VERSION,
      };
      await this.#write(next);
      this.#loading = Promise.resolve(next);
    });
    return before;
  }

  /**
   * Shallow like `duckOtherMedia()`: every announcement pass asks whether to
   * hold, and asking must never be what wakes the OS keychain.
   */
  async quietDuringMeetings(): Promise<boolean> {
    return (await this.#load()).quietDuringMeetings;
  }

  /**
   * Turns the holding of announcements during meetings on or off. A plain
   * preference like the media duck's: no cipher, no invalid value, so the
   * write either lands or throws.
   */
  async setQuietDuringMeetings(enabled: boolean): Promise<SettingsUpdateResult> {
    return this.#setField((persisted) => {
      if (persisted.quietDuringMeetings === enabled) return;
      return { ...persisted, quietDuringMeetings: enabled };
    });
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
    return this.#setField((persisted) => {
      if (persisted.showOnAllDisplays === show) return;
      return { ...persisted, showOnAllDisplays: show };
    });
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
    return this.#setField((persisted) => {
      if (persisted.formFactor === formFactor) return;
      const next: PersistedSettings = { ...persisted };
      if (formFactor) next.formFactor = formFactor;
      else delete next.formFactor;
      return next;
    });
  }

  /**
   * Shallow like `readFormFactor()`: whether a default provider has been
   * chosen decides only whether a creation saves one, and that answer must
   * never wake the keychain behind the stored keys.
   */
  async readDefaultWorkspaceProvider(): Promise<ProviderId | undefined> {
    return (await this.#load()).defaultWorkspaceProvider;
  }

  /**
   * Stores the provider a nameless creation ask goes to, or returns to asking
   * each time when omitted. A preference like the form factor's: no cipher,
   * and the absence of a choice is itself the stored state.
   */
  async setDefaultWorkspaceProvider(
    providerId: ProviderId | undefined,
  ): Promise<SettingsUpdateResult> {
    return this.#setField((persisted) => {
      if (persisted.defaultWorkspaceProvider === providerId) return;
      const next: PersistedSettings = { ...persisted };
      if (providerId) next.defaultWorkspaceProvider = providerId;
      else delete next.defaultWorkspaceProvider;
      return next;
    });
  }

  /**
   * Shallow like the default provider's read, and read at the same moment: a
   * creation ask must not wake the keychain to learn which model it carries.
   */
  async readWorkspaceAgentDefault(
    providerId: ProviderId,
  ): Promise<WorkspaceAgentSelection | undefined> {
    return (await this.#load()).workspaceAgentDefaults?.[providerId];
  }

  /**
   * Stores the agent kind and model one provider starts new workspaces with,
   * or returns to that provider's own defaults when omitted. One provider's
   * choice never disturbs another's, the way one provider's key never
   * disturbs another's ciphertext.
   */
  async setWorkspaceAgentDefault(
    providerId: ProviderId,
    selection: WorkspaceAgentSelection | undefined,
  ): Promise<SettingsUpdateResult> {
    return this.#setField((persisted) => {
      const current = persisted.workspaceAgentDefaults?.[providerId];
      if (
        current?.agent === selection?.agent &&
        current?.model === selection?.model &&
        current?.effort === selection?.effort
      ) {
        return;
      }
      const defaults = { ...persisted.workspaceAgentDefaults };
      if (selection) defaults[providerId] = selection;
      else delete defaults[providerId];
      const next: PersistedSettings = { ...persisted };
      if (Object.keys(defaults).length > 0) next.workspaceAgentDefaults = defaults;
      else delete next.workspaceAgentDefaults;
      return next;
    });
  }

  /**
   * Shallow like the agent default's read, and read at the same moment: a
   * creation ask must not wake the keychain to learn which project it prefers.
   */
  async readWorkspaceProjectDefault(providerId: ProviderId): Promise<string | undefined> {
    return (await this.#load()).workspaceProjectDefaults?.[providerId];
  }

  /**
   * Stores the project one provider creates nameless-ask workspaces in, or
   * returns to letting the first creation choose when omitted. One provider's
   * choice never disturbs another's, the way the agent defaults keep apart.
   */
  async setWorkspaceProjectDefault(
    providerId: ProviderId,
    providerProjectId: string | undefined,
  ): Promise<SettingsUpdateResult> {
    return this.#setField((persisted) => {
      if (persisted.workspaceProjectDefaults?.[providerId] === providerProjectId) return;
      const defaults = { ...persisted.workspaceProjectDefaults };
      if (providerProjectId) defaults[providerId] = providerProjectId;
      else delete defaults[providerId];
      const next: PersistedSettings = { ...persisted };
      if (Object.keys(defaults).length > 0) next.workspaceProjectDefaults = defaults;
      else delete next.workspaceProjectDefaults;
      return next;
    });
  }

  /**
   * Whether the credential Luke speaks through resolved to something this run
   * would use. A run that refuses its credentials does not ask for the key at
   * all: reading a stored one means a Keychain decrypt, which a run that would
   * not use it has no business asking for.
   */
  async #voiceAvailable(): Promise<boolean> {
    if (!this.#credentialsUsable) return false;
    if ((await this.readApiKey(VOICE_CREDENTIAL_PROVIDER_ID)) !== undefined) return true;
    // A signed-in account carries the hosted allowance, so voice is on without
    // a key of the developer's own — the same resolution the main process makes
    // when it builds the minter.
    return (await this.readAccount()) !== undefined;
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
   * Connects one calendar account: the grant its sign-in produced, encrypted
   * at rest like every credential, under the account's own id. Signing into
   * an account already connected replaces its grant and keeps its calendar
   * choices — the choices are the user's, and a fresh grant is not a fresh
   * mind about them.
   */
  async addCalendarAccount(
    accountId: string,
    refreshToken: string,
    selectedCalendarIds: readonly string[],
  ): Promise<SettingsUpdateResult> {
    const id = calendarIdentifierText(accountId);
    const normalized = refreshToken.trim();
    const rejection = !id
      ? "Google answered the sign-in without naming an account."
      : !this.#secretStorageUsable()
        ? "Encrypted credential storage is unavailable on this system."
        : // The shape rules a pasted key answers to: a grant is Google's to
          // shape, and only sendability is checked.
          apiKeyRejection(normalized);
    if (rejection || !id) return { settings: await this.snapshot(), reason: rejection };

    await this.#serialize(async () => {
      const persisted = await this.#load();
      const token = this.#cipher.encrypt(normalized).toString("base64");
      const existing = persisted.calendarAccounts ?? [];
      const held = existing.find((account) => account.id === id);
      if (!held && existing.length >= MAXIMUM_CALENDAR_ACCOUNTS) {
        throw new Error("More calendar accounts than the store keeps");
      }
      const account: PersistedCalendarAccount = {
        id,
        token,
        calendars: held
          ? held.calendars
          : selectedCalendarIds
              .map(calendarIdentifierText)
              .filter((value): value is string => value !== undefined)
              .slice(0, MAXIMUM_SELECTED_CALENDARS),
      };
      const calendarAccounts = held
        ? existing.map((candidate) => (candidate.id === id ? account : candidate))
        : [...existing, account];
      await this.#writeCalendarAccounts(persisted, calendarAccounts);
    });
    return { settings: await this.snapshot() };
  }

  /** Disconnects one account, deleting its stored grant with it. */
  async removeCalendarAccount(accountId: string): Promise<SettingsUpdateResult> {
    await this.#serialize(async () => {
      const persisted = await this.#load();
      const existing = persisted.calendarAccounts ?? [];
      const calendarAccounts = existing.filter((account) => account.id !== accountId);
      if (calendarAccounts.length === existing.length) return;
      await this.#writeCalendarAccounts(persisted, calendarAccounts);
    });
    return { settings: await this.snapshot() };
  }

  /**
   * Chooses whether one of an account's calendars counts toward meetings.
   * Whether the calendar exists is answered where the list lives — the main
   * process validates a selection against its latest observation — so only
   * the value's shape is held here.
   */
  async setCalendarSelected(
    accountId: string,
    calendarId: string,
    selected: boolean,
  ): Promise<SettingsUpdateResult> {
    const id = calendarIdentifierText(calendarId);
    if (!id) return { settings: await this.snapshot(), reason: "That is not a calendar id." };
    let unknownAccount = false;
    await this.#serialize(async () => {
      const persisted = await this.#load();
      const existing = persisted.calendarAccounts ?? [];
      const held = existing.find((account) => account.id === accountId);
      if (!held) {
        unknownAccount = true;
        return;
      }
      const calendars = held.calendars.filter((candidate) => candidate !== id);
      if (selected) calendars.push(id);
      if (calendars.length > MAXIMUM_SELECTED_CALENDARS) return;
      if (calendars.length === held.calendars.length && held.calendars.includes(id) === selected) {
        return;
      }
      const calendarAccounts = existing.map((account) =>
        account.id === accountId ? { ...account, calendars } : account,
      );
      await this.#writeCalendarAccounts(persisted, calendarAccounts);
    });
    return {
      settings: await this.snapshot(),
      ...(unknownAccount ? { reason: "That calendar account is not connected." } : {}),
    };
  }

  /**
   * Main-process only, like the resolved keys: every connected account with
   * its grant decrypted, for the reader. A grant that no longer decrypts —
   * another OS account, a rotated Keychain — is skipped; its row still shows
   * connected, and the failing read is what says to sign in again.
   */
  async readCalendarAccounts(): Promise<readonly CalendarAccountCredential[]> {
    if (this.#resolvedCalendarAccounts) return this.#resolvedCalendarAccounts;
    const persisted = await this.#load();
    const accounts: CalendarAccountCredential[] = [];
    for (const account of persisted.calendarAccounts ?? []) {
      try {
        const refreshToken = this.#cipher.decrypt(Buffer.from(account.token, "base64")).trim();
        if (!refreshToken || apiKeyRejection(refreshToken)) continue;
        accounts.push({ id: account.id, refreshToken, selectedCalendarIds: account.calendars });
      } catch {
        // Unrecoverable; the user signs into that account again.
      }
    }
    this.#resolvedCalendarAccounts = accounts;
    return accounts;
  }

  /** One place writes the account list, so the cache can never outlive it. */
  async #writeCalendarAccounts(
    persisted: PersistedSettings,
    calendarAccounts: readonly PersistedCalendarAccount[],
  ): Promise<void> {
    const next: PersistedSettings = {
      ...persisted,
      version: SETTINGS_FILE_VERSION,
    };
    if (calendarAccounts.length > 0) next.calendarAccounts = calendarAccounts;
    else delete next.calendarAccounts;
    await this.#write(next);
    this.#loading = Promise.resolve(next);
    this.#resolvedCalendarAccounts = undefined;
  }

  /**
   * Remembers whether the menu bar status item is drawn. A preference is not a
   * credential, so nothing here touches the cipher: storing this choice must
   * never be the reason the Keychain dialog appears.
   */
  async setShowInMenuBar(show: boolean): Promise<SettingsUpdateResult> {
    return this.#setField((persisted) => {
      if (persisted.showInMenuBar === show) return;
      return { ...persisted, showInMenuBar: show };
    });
  }

  /**
   * Remembers whether Luke stands in the Dock. A preference like the menu
   * bar's, and held to the same rule: nothing here touches the cipher.
   */
  async setShowInDock(show: boolean): Promise<SettingsUpdateResult> {
    return this.#setField((persisted) => {
      if (persisted.showInDock === show) return;
      return { ...persisted, showInDock: show };
    });
  }

  /**
   * Returns one group of preferences to its defaults in a single write, by
   * forgetting the choices rather than storing copies of the defaults: an
   * optional field is deleted the way its own clear deletes it, and a plain
   * boolean goes back to the value `APP_SETTING_DEFAULTS` states — so a
   * default that moves in a later build moves these settings with it. The
   * scopes are fixed by this build and none reaches a credential, an account,
   * or the agent pairing, whose own row already offers the provider's default.
   * A scope already at its defaults writes nothing, like any other setter
   * asked for the value it holds.
   */
  async resetSettings(scope: SettingsResetScope): Promise<SettingsUpdateResult> {
    return this.#setField((persisted) => {
      const next: PersistedSettings = { ...persisted };
      switch (scope) {
        case SETTINGS_RESET_SCOPE.VOICE:
          delete next.voice;
          delete next.voiceSpeed;
          next.voiceCaptions = APP_SETTING_DEFAULTS.voiceCaptions;
          next.duckOtherMedia = APP_SETTING_DEFAULTS.duckOtherMedia;
          next.preferBuiltInMicrophone = APP_SETTING_DEFAULTS.preferBuiltInMicrophone;
          break;
        case SETTINGS_RESET_SCOPE.APPEARANCE:
          next.showInMenuBar = APP_SETTING_DEFAULTS.showInMenuBar;
          next.showInDock = APP_SETTING_DEFAULTS.showInDock;
          next.showOnAllDisplays = APP_SETTING_DEFAULTS.showOnAllDisplays;
          delete next.formFactor;
          break;
        case SETTINGS_RESET_SCOPE.SHORTCUTS:
          delete next.voiceHotkey;
          delete next.askHotkey;
          delete next.stopHotkey;
          break;
        case SETTINGS_RESET_SCOPE.WORKSPACES:
          delete next.defaultWorkspaceProvider;
          delete next.workspaceProjectDefaults;
          break;
      }
      const changed = (Object.keys(persisted) as (keyof PersistedSettings)[]).some(
        (field) => next[field] !== persisted[field],
      );
      return changed ? next : undefined;
    });
  }

  /**
   * One preference write: serialize, load, mutate, write, cache. Returning
   * undefined means the stored value is already the one asked for, so nothing
   * is written. Credentials stay on their own path — a preference must never
   * be the reason the Keychain is asked.
   */
  async #setField(
    mutate: (persisted: PersistedSettings) => PersistedSettings | undefined,
  ): Promise<SettingsUpdateResult> {
    await this.#serialize(async () => {
      const persisted = await this.#load();
      const mutated = mutate(persisted);
      if (!mutated) return;
      const next: PersistedSettings = {
        ...mutated,
        version: SETTINGS_FILE_VERSION,
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
      ...APP_SETTING_DEFAULTS,
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
