import {
  isRealtimeVoice,
  isRealtimeVoiceSpeed,
  positiveInteger,
  REALTIME_CALLS_PATH,
  REALTIME_CLIENT_SECRETS_PATH,
  REALTIME_DEFAULTS,
  REALTIME_MINT_OUTCOME,
  type RealtimeConnection,
  type RealtimeDiagnostics,
  type RealtimeMintOutcome,
  type RealtimeVoice,
  type RealtimeVoiceSpeed,
  realtimeClientSecretRequest,
  realtimeCredentialFromResponse,
  realtimeCredentialIsUsable,
  text,
} from "@sidecar/core";

export const OPENAI_ENVIRONMENT = {
  API_KEY: "OPENAI_API_KEY",
  MODEL: "LUKE_REALTIME_MODEL",
  VOICE: "LUKE_REALTIME_VOICE",
  SPEED: "LUKE_REALTIME_SPEED",
} as const;

const OPENAI_DEFAULTS = {
  BASE_URL: "https://api.openai.com/v1",
  REQUEST_TIMEOUT_MS: 10_000,
} as const;

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface OpenAiRealtimeCredentialOptions {
  apiKey: string;
  model?: string;
  voice?: string;
  speed?: number;
  baseUrl?: string;
  fetch?: FetchLike;
  now?: () => number;
  requestTimeoutMs?: number;
}

export type OpenAiRealtimeMinterOptions = Omit<OpenAiRealtimeCredentialOptions, "apiKey">;

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

/** The launch environment's speaking pace, gated the same way as the voice. */
export function environmentRealtimeSpeed(
  environment: NodeJS.ProcessEnv = process.env,
): RealtimeVoiceSpeed | undefined {
  const value = environment[OPENAI_ENVIRONMENT.SPEED]?.trim();
  if (!value) return undefined;
  const speed = Number(value);
  return isRealtimeVoiceSpeed(speed) ? speed : undefined;
}

function positiveSpeed(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined;
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
  /** The pace from construction, which a cleared setting falls back to. */
  readonly #configuredSpeed: number;
  #speed: number;
  readonly #baseUrl: string;
  readonly #fetch: FetchLike;
  readonly #now: () => number;
  readonly #requestTimeoutMs: number;
  #lastOutcome: RealtimeMintOutcome = REALTIME_MINT_OUTCOME.NOT_ATTEMPTED;
  #lastDetail: string | undefined;
  #lastAttemptAt: number | undefined;

  constructor(options: OpenAiRealtimeCredentialOptions) {
    const apiKey = text(options.apiKey);
    if (!apiKey) throw new Error("OpenAI API key must not be empty");
    this.#apiKey = apiKey;
    this.#model = text(options.model) ?? REALTIME_DEFAULTS.MODEL;
    this.#configuredVoice = text(options.voice) ?? REALTIME_DEFAULTS.VOICE;
    this.#voice = this.#configuredVoice;
    this.#configuredSpeed = positiveSpeed(options.speed) ?? REALTIME_DEFAULTS.SPEED;
    this.#speed = this.#configuredSpeed;
    this.#baseUrl = withoutTrailingSlash(text(options.baseUrl) ?? OPENAI_DEFAULTS.BASE_URL);
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.#now = options.now ?? Date.now;
    this.#requestTimeoutMs = positiveInteger(
      options.requestTimeoutMs,
      OPENAI_DEFAULTS.REQUEST_TIMEOUT_MS,
    );
  }

  get model(): string {
    return this.#model;
  }

  /**
   * Changes the voice new credentials are minted for. A call already open
   * keeps the voice it answered with, because a credential already handed out
   * cannot be recalled.
   */
  setVoice(voice: string | undefined): void {
    this.#voice = text(voice) ?? this.#configuredVoice;
  }

  /**
   * Changes the pace new credentials are minted for, under the same rule as
   * the voice: a call already open keeps the pace it answered at.
   */
  setSpeed(speed: number | undefined): void {
    this.#speed = positiveSpeed(speed) ?? this.#configuredSpeed;
  }

  /**
   * Mints a fresh credential for every call. A minted secret is deliberately
   * never kept to serve a later call: the service has been seen to refuse a
   * reused secret at the calls endpoint (status 401) even inside its stated
   * expiry, and a refused call in the announcer's path is an announcement
   * lost. One extra POST per call open is cheap; a secret that answers only
   * the call it was minted for cannot go stale in anyone's hands.
   */
  async mint(): Promise<RealtimeConnection | undefined> {
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
      speed: this.#speed,
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
          realtimeClientSecretRequest({
            model: this.#model,
            voice: this.#voice,
            speed: this.#speed,
          }),
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
 * Explains why no minter exists, which is the state the panel shows as "voice
 * unavailable". Distinguishing a missing key from a fixture run matters: they
 * look identical from the UI and have completely different fixes. Whether a key
 * resolved is passed in rather than read here, because it can now come from the
 * settings store as well as from the environment and only the caller knows
 * which.
 */
export function unavailableRealtimeDiagnostics(input: {
  fixtureMode: boolean;
  apiKeyConfigured: boolean;
}): RealtimeDiagnostics {
  return {
    apiKeyConfigured: input.apiKeyConfigured,
    fixtureMode: input.fixtureMode,
    model: text(process.env[OPENAI_ENVIRONMENT.MODEL]) ?? REALTIME_DEFAULTS.MODEL,
    voice: environmentRealtimeVoice() ?? REALTIME_DEFAULTS.VOICE,
    speed: environmentRealtimeSpeed() ?? REALTIME_DEFAULTS.SPEED,
    endpoint: `${OPENAI_DEFAULTS.BASE_URL}${REALTIME_CLIENT_SECRETS_PATH}`,
    lastOutcome: input.fixtureMode
      ? REALTIME_MINT_OUTCOME.DISABLED_BY_FIXTURE
      : REALTIME_MINT_OUTCOME.NO_API_KEY,
  };
}

/**
 * Builds a minter only when there is a key to build one from, and a key arriving
 * later builds one then — which is what lets voice be turned on from the panel
 * rather than only by the environment the app was launched with. The key itself
 * is resolved by the settings store, which reads `OPENAI_API_KEY` as its own
 * fallback; the model, voice, and pace are still resolved here.
 *
 * `OPENAI_BASE_URL` is deliberately not read here. It redirects attention
 * review, which runs entirely in the main process, but the voice path also has
 * to survive the renderer's content-security policy, and that only permits the
 * canonical OpenAI host. Honoring the variable here would mint a credential
 * against one host and then fail the SDP exchange against another — an
 * unsupported endpoint that appears to work until the first word is spoken.
 */
export function openAiRealtimeCredentials(
  apiKey: string | undefined,
  options: OpenAiRealtimeMinterOptions = {},
): OpenAiRealtimeCredentialMinter | undefined {
  const resolved = text(apiKey);
  if (!resolved) return undefined;

  const model = text(options.model) ?? text(process.env[OPENAI_ENVIRONMENT.MODEL]);
  const voice = text(options.voice) ?? environmentRealtimeVoice();
  const speed = positiveSpeed(options.speed) ?? environmentRealtimeSpeed();

  return new OpenAiRealtimeCredentialMinter({
    ...options,
    apiKey: resolved,
    ...(model ? { model } : {}),
    ...(voice ? { voice } : {}),
    ...(speed ? { speed } : {}),
  });
}
