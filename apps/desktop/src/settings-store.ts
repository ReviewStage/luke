import fs from "node:fs/promises";
import path from "node:path";
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

const SETTINGS_FILE_NAME = "settings.json";
const SETTINGS_TEMPORARY_FILE_NAME = "settings.json.tmp";
/** Version 2 keys credentials by provider id; version 1 held one Conductor key. */
const SETTINGS_FILE_VERSION = 2;
const SETTINGS_FILE_MODE = 0o600;

const SETTINGS_FIELD = {
  API_KEYS: "apiKeys",
  LEGACY_CONDUCTOR_API_KEY: "conductorApiKey",
  VERSION: "version",
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
  return {
    version: typeof version === "number" ? version : SETTINGS_FILE_VERSION,
    apiKeys: storedApiKeys(record),
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
    };
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

    let persisted: PersistedSettings = { version: SETTINGS_FILE_VERSION, apiKeys: {} };
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
