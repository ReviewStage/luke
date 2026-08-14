import {
  isRealtimeVoice,
  REALTIME_CALLS_PATH,
  REALTIME_CLIENT_SECRETS_PATH,
  REALTIME_DEFAULTS,
  REALTIME_MINT_OUTCOME,
  type RealtimeConnection,
  type RealtimeDiagnostics,
  type RealtimeMintOutcome,
  type RealtimeVoice,
  realtimeClientSecretRequest,
  realtimeCredentialFromResponse,
  realtimeCredentialIsUsable,
} from "@sidecar/core";

export const OPENAI_ENVIRONMENT = {
  API_KEY: "OPENAI_API_KEY",
  MODEL: "LUKE_REALTIME_MODEL",
  VOICE: "LUKE_REALTIME_VOICE",
} as const;

const OPENAI_DEFAULTS = {
  BASE_URL: "https://api.openai.com/v1",
  REQUEST_TIMEOUT_MS: 10_000,
  /**
   * Re-mint slightly before a credential actually expires. The renderer still
   * has to complete an SDP round trip after it receives one, and a secret that
   * dies mid-handshake fails in a way that looks like a network fault.
   */
  EXPIRY_MARGIN_MS: 5_000,
} as const;

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface OpenAiRealtimeCredentialOptions {
  apiKey: string;
  model?: string;
  voice?: string;
  baseUrl?: string;
  fetch?: FetchLike;
  now?: () => number;
  requestTimeoutMs?: number;
  expiryMarginMs?: number;
}

export type OpenAiRealtimeEnvironmentOptions = Omit<OpenAiRealtimeCredentialOptions, "apiKey">;

function positiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

function nonNegativeNumber(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) return fallback;
  return value;
}

function trimmedText(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function withoutTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

/**
 * The launch environment's voice, honoured only when it is one Luke offers.
 * The one gate for every reader — the minter, its diagnostics, and the
 * settings snapshot — so what the panel marks is always what would be minted.
 */
export function environmentRealtimeVoice(
  environment: NodeJS.ProcessEnv = process.env,
): RealtimeVoice | undefined {
  const value = environment[OPENAI_ENVIRONMENT.VOICE]?.trim();
  return isRealtimeVoice(value) ? value : undefined;
}

/**
 * Mints short-lived Realtime credentials from the standing OpenAI API key.
 *
 * The standing key never leaves the main process: the renderer only ever
 * receives an ephemeral client secret that expires on its own, so a compromised
 * renderer cannot outlive the credential it was handed. A failure resolves to
 * nothing rather than an error, leaving the voice experience unavailable and
 * the rest of Luke working.
 */
export class OpenAiRealtimeCredentialMinter {
  readonly #apiKey: string;
  readonly #model: string;
  /** The voice from construction, which a cleared setting falls back to. */
  readonly #configuredVoice: string;
  #voice: string;
  readonly #baseUrl: string;
  readonly #fetch: FetchLike;
  readonly #now: () => number;
  readonly #requestTimeoutMs: number;
  readonly #expiryMarginMs: number;
  #credential: RealtimeConnection | undefined;
  #lastOutcome: RealtimeMintOutcome = REALTIME_MINT_OUTCOME.NOT_ATTEMPTED;
  #lastDetail: string | undefined;
  #lastAttemptAt: number | undefined;

  constructor(options: OpenAiRealtimeCredentialOptions) {
    const apiKey = trimmedText(options.apiKey);
    if (!apiKey) throw new Error("OpenAI API key must not be empty");
    this.#apiKey = apiKey;
    this.#model = trimmedText(options.model) ?? REALTIME_DEFAULTS.MODEL;
    this.#configuredVoice = trimmedText(options.voice) ?? REALTIME_DEFAULTS.VOICE;
    this.#voice = this.#configuredVoice;
    this.#baseUrl = withoutTrailingSlash(trimmedText(options.baseUrl) ?? OPENAI_DEFAULTS.BASE_URL);
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.#now = options.now ?? Date.now;
    this.#requestTimeoutMs = positiveInteger(
      options.requestTimeoutMs,
      OPENAI_DEFAULTS.REQUEST_TIMEOUT_MS,
    );
    this.#expiryMarginMs = nonNegativeNumber(
      options.expiryMarginMs,
      OPENAI_DEFAULTS.EXPIRY_MARGIN_MS,
    );
  }

  get model(): string {
    return this.#model;
  }

  /**
   * Changes the voice new credentials are minted for. The outstanding
   * credential was minted against the old voice, so it is discarded rather
   * than served speaking the wrong one; a call already open keeps the voice it
   * answered with, because a credential already handed out cannot be recalled.
   */
  setVoice(voice: string | undefined): void {
    const next = trimmedText(voice) ?? this.#configuredVoice;
    if (next === this.#voice) return;
    this.#voice = next;
    this.#credential = undefined;
  }

  /** Returns a usable credential, reusing the outstanding one until it nears expiry. */
  async mint(): Promise<RealtimeConnection | undefined> {
    const existing = this.#credential;
    if (existing && realtimeCredentialIsUsable(existing, this.#now() + this.#expiryMarginMs)) {
      return existing;
    }
    this.#credential = undefined;
    this.#lastAttemptAt = this.#now();

    const response = await this.#request();
    if (!response) return undefined;

    if (!response.ok) {
      // Status alone diagnoses credentials or rate limits without writing the
      // request, the key, or the minted secret to the log.
      this.#record(REALTIME_MINT_OUTCOME.HTTP_ERROR, `status ${response.status}`);
      return undefined;
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      this.#record(REALTIME_MINT_OUTCOME.MALFORMED_RESPONSE, "response was not JSON");
      return undefined;
    }

    const credential = realtimeCredentialFromResponse(payload, this.#model);
    if (!credential) {
      this.#record(REALTIME_MINT_OUTCOME.MALFORMED_RESPONSE, "no usable client secret");
      return undefined;
    }
    if (!realtimeCredentialIsUsable(credential, this.#now())) {
      this.#record(REALTIME_MINT_OUTCOME.EXPIRED_CREDENTIAL, "already expired on arrival");
      return undefined;
    }

    const connection: RealtimeConnection = {
      ...credential,
      callsUrl: `${this.#baseUrl}${REALTIME_CALLS_PATH}`,
    };
    this.#credential = connection;
    this.#record(REALTIME_MINT_OUTCOME.SUCCEEDED);
    return connection;
  }

  /**
   * Reports why voice is or is not available, without any credential material.
   * A packaged app has no visible stderr, so this is the only way the failure
   * reaches the person trying to use it.
   */
  diagnostics(): RealtimeDiagnostics {
    return {
      apiKeyConfigured: true,
      fixtureMode: false,
      model: this.#model,
      voice: this.#voice,
      endpoint: `${this.#baseUrl}${REALTIME_CLIENT_SECRETS_PATH}`,
      lastOutcome: this.#lastOutcome,
      ...(this.#lastDetail ? { lastDetail: this.#lastDetail } : {}),
      ...(this.#lastAttemptAt === undefined ? {} : { lastAttemptAt: this.#lastAttemptAt }),
    };
  }

  async #request(): Promise<Response | undefined> {
    try {
      return await this.#fetch(`${this.#baseUrl}${REALTIME_CLIENT_SECRETS_PATH}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.#apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(
          realtimeClientSecretRequest({ model: this.#model, voice: this.#voice }),
        ),
        signal: AbortSignal.timeout(this.#requestTimeoutMs),
      });
    } catch (error) {
      this.#record(
        REALTIME_MINT_OUTCOME.NETWORK_ERROR,
        error instanceof Error ? error.name : "unknown error",
      );
      return undefined;
    }
  }

  #record(outcome: RealtimeMintOutcome, detail?: string): void {
    this.#lastOutcome = outcome;
    this.#lastDetail = detail;
    if (outcome === REALTIME_MINT_OUTCOME.SUCCEEDED) return;
    this.#report(`OpenAI realtime mint: ${outcome}${detail ? ` (${detail})` : ""}`);
  }

  #report(message: string): void {
    process.stderr.write(`${message}\n`);
  }
}

/**
 * Builds a minter only when an API key is configured. Luke observes sessions
 * and stays silent without one, so no part of the app requires credentials.
 *
 * `OPENAI_BASE_URL` is deliberately not read here. It redirects attention
 * review, which runs entirely in the main process, but the voice path also has
 * to survive the renderer's content-security policy, and that only permits the
 * canonical OpenAI host. Honoring the variable here would mint a credential
 * against one host and then fail the SDP exchange against another — an
 * unsupported endpoint that appears to work until the first word is spoken.
 */
/**
 * Explains why no minter exists, which is the state the panel shows as "voice
 * unavailable". Distinguishing a missing key from a fixture run matters: they
 * look identical from the UI and have completely different fixes.
 */
export function unavailableRealtimeDiagnostics(fixtureMode: boolean): RealtimeDiagnostics {
  const apiKeyConfigured = trimmedText(process.env[OPENAI_ENVIRONMENT.API_KEY]) !== undefined;
  return {
    apiKeyConfigured,
    fixtureMode,
    model: trimmedText(process.env[OPENAI_ENVIRONMENT.MODEL]) ?? REALTIME_DEFAULTS.MODEL,
    voice: environmentRealtimeVoice() ?? REALTIME_DEFAULTS.VOICE,
    endpoint: `${OPENAI_DEFAULTS.BASE_URL}${REALTIME_CLIENT_SECRETS_PATH}`,
    lastOutcome: fixtureMode
      ? REALTIME_MINT_OUTCOME.DISABLED_BY_FIXTURE
      : REALTIME_MINT_OUTCOME.NO_API_KEY,
  };
}

export function openAiRealtimeCredentialsFromEnvironment(
  options: OpenAiRealtimeEnvironmentOptions = {},
): OpenAiRealtimeCredentialMinter | undefined {
  const apiKey = trimmedText(process.env[OPENAI_ENVIRONMENT.API_KEY]);
  if (!apiKey) return undefined;

  const model = trimmedText(options.model) ?? trimmedText(process.env[OPENAI_ENVIRONMENT.MODEL]);
  const voice = trimmedText(options.voice) ?? environmentRealtimeVoice();

  return new OpenAiRealtimeCredentialMinter({
    ...options,
    apiKey,
    ...(model ? { model } : {}),
    ...(voice ? { voice } : {}),
  });
}
