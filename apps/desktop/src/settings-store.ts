import fs from "node:fs/promises";
import path from "node:path";
import {
  type AppSettings,
  CREDENTIAL_SOURCE,
  type CredentialSource,
  type SettingsUpdateResult,
} from "./shared/contracts";

const SETTINGS_FILE_NAME = "settings.json";
const SETTINGS_TEMPORARY_FILE_NAME = "settings.json.tmp";
const SETTINGS_FILE_VERSION = 1;
const SETTINGS_FILE_MODE = 0o600;

const CONDUCTOR_ENVIRONMENT = {
  API_KEY: "CONDUCTOR_API_KEY",
  API_TOKEN: "CONDUCTOR_API_TOKEN",
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
}

interface PersistedSettings {
  version: number;
  conductorApiKey?: string;
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
 * value. Conductor does not publish a key format, so this only rules out values
 * that cannot be sent as an HTTP authorization header.
 */
export function conductorApiKeyRejection(apiKey: string): string | undefined {
  if (apiKey.length < API_KEY_LENGTH.MINIMUM) return "That API key is too short.";
  if (apiKey.length > API_KEY_LENGTH.MAXIMUM) return "That API key is too long.";
  if (!PRINTABLE_ASCII.test(apiKey)) return "That API key contains unsupported characters.";
  return undefined;
}

function environmentApiKey(environment: NodeJS.ProcessEnv): string | undefined {
  for (const variable of [CONDUCTOR_ENVIRONMENT.API_KEY, CONDUCTOR_ENVIRONMENT.API_TOKEN]) {
    const value = environment[variable]?.trim();
    if (value && !conductorApiKeyRejection(value)) return value;
  }
  return undefined;
}

function parsePersistedSettings(source: string): PersistedSettings {
  const parsed: unknown = JSON.parse(source);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Settings file is not an object");
  }
  const record = parsed as Record<string, unknown>;
  const conductorApiKey = record.conductorApiKey;
  return {
    version: typeof record.version === "number" ? record.version : SETTINGS_FILE_VERSION,
    ...(typeof conductorApiKey === "string" && conductorApiKey ? { conductorApiKey } : {}),
  };
}

/**
 * Reads and writes the small set of user-owned settings Luke needs. A stored
 * credential stays in the main process: callers can learn that a key exists and
 * can replace it, but no accessor returns it to a renderer.
 */
export class SettingsStore {
  readonly #directory: () => string;
  readonly #cipher: SecretCipher;
  readonly #environment: NodeJS.ProcessEnv;
  #loading: Promise<PersistedSettings> | undefined;
  #resolved: ResolvedApiKey | undefined;
  #pendingWrite: Promise<void> = Promise.resolve();

  constructor(options: SettingsStoreOptions) {
    this.#directory = options.directory;
    this.#cipher = options.cipher;
    this.#environment = options.environment ?? process.env;
  }

  async snapshot(): Promise<AppSettings> {
    const { source } = await this.#resolveApiKey();
    return {
      conductorApiKeySource: source,
      secretStorageAvailable: this.#secretStorageAvailable(),
    };
  }

  /** Main-process only: the resolved key used to authenticate provider reads. */
  async readConductorApiKey(): Promise<string | undefined> {
    return (await this.#resolveApiKey()).apiKey;
  }

  /**
   * Stores a key encrypted at rest, or clears the stored key when omitted. A key
   * the user cannot use comes back as a `reason` rather than an exception, so
   * only an unexpected filesystem failure throws.
   */
  async setConductorApiKey(apiKey: string | undefined): Promise<SettingsUpdateResult> {
    const normalized = apiKey?.trim();
    const rejection = normalized
      ? !this.#secretStorageAvailable()
        ? "Encrypted credential storage is unavailable on this system."
        : conductorApiKeyRejection(normalized)
      : undefined;
    if (rejection) return { settings: await this.snapshot(), reason: rejection };

    const persisted = await this.#load();
    const ciphertext = normalized ? this.#cipher.encrypt(normalized).toString("base64") : undefined;
    const next: PersistedSettings = {
      version: SETTINGS_FILE_VERSION,
      ...(ciphertext ? { conductorApiKey: ciphertext } : {}),
    };
    if (persisted.conductorApiKey !== next.conductorApiKey) {
      await this.#write(next);
      this.#loading = Promise.resolve(next);
      this.#resolved = undefined;
    }
    return { settings: await this.snapshot() };
  }

  #secretStorageAvailable(): boolean {
    try {
      return this.#cipher.isAvailable();
    } catch {
      return false;
    }
  }

  /**
   * The resolved key is cached because the observation timer asks for it every
   * few seconds, and decrypting on each tick would hit the OS keychain
   * thousands of times a day for a value only the user can change.
   */
  async #resolveApiKey(): Promise<ResolvedApiKey> {
    if (this.#resolved) return this.#resolved;
    const stored = await this.#storedApiKey();
    const fromEnvironment = stored ? undefined : environmentApiKey(this.#environment);
    this.#resolved = stored
      ? { apiKey: stored, source: CREDENTIAL_SOURCE.ENCRYPTED_FILE }
      : fromEnvironment
        ? { apiKey: fromEnvironment, source: CREDENTIAL_SOURCE.ENVIRONMENT }
        : { source: CREDENTIAL_SOURCE.NONE };
    return this.#resolved;
  }

  async #storedApiKey(): Promise<string | undefined> {
    const { conductorApiKey } = await this.#load();
    if (!conductorApiKey) return undefined;
    try {
      const apiKey = this.#cipher.decrypt(Buffer.from(conductorApiKey, "base64")).trim();
      return apiKey && !conductorApiKeyRejection(apiKey) ? apiKey : undefined;
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

    let persisted: PersistedSettings = { version: SETTINGS_FILE_VERSION };
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

  async #write(persisted: PersistedSettings): Promise<void> {
    const write = this.#pendingWrite.then(async () => {
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
    });
    this.#pendingWrite = write.catch(() => undefined);
    await write;
  }
}
