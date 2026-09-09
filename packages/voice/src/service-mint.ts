import {
  HOSTED_SERVICE_PATH,
  type HostedQuota,
  hostedMintAnswerAt,
  hostedQuotaSchema,
  type RealtimeConnection,
} from "@sidecar/hosted";
import {
  isRealtimeVoice,
  isRealtimeVoiceSpeed,
  REALTIME_DEFAULTS,
  REALTIME_MINT_OUTCOME,
  type RealtimeDiagnostics,
  type RealtimeMintOutcome,
} from "@sidecar/realtime";
import {
  type CloudFetch,
  isRecord,
  positiveInteger,
  text,
  type UnparsedWireValue,
  unparsedWire,
  withoutTrailingSlash,
} from "@sidecar/wire";

const SERVICE_MINT_DEFAULTS = {
  REQUEST_TIMEOUT_MS: 10_000,
} as const;

const UNAUTHORIZED_STATUS = 401;
const QUOTA_STATUS = 429;
const UNAVAILABLE_STATUS = 503;

/**
 * What the main process asks of whichever credential source voice runs on —
 * the developer's own OpenAI key or the signed-in hosted service. The renderer
 * never sees the difference: either way it receives an ephemeral connection
 * aimed at OpenAI's own calls endpoint, and diagnostics that can say why not.
 */
export interface RealtimeCredentialMinter {
  mint(): Promise<RealtimeConnection | undefined>;
  setVoice(voice: string | undefined): void;
  setSpeed(speed: number | undefined): void;
  diagnostics(): RealtimeDiagnostics;
}

export interface ServiceMintAuthorization {
  /** The signed-in account's current access token, read fresh for every attempt. */
  readAccessToken: () => Promise<string | undefined>;
  /**
   * Asks the account lifecycle to refresh its tokens. Access tokens outlive a
   * mint by an hour at most while the app runs for days, so a 401 here is
   * routine — the mint retries once with whatever the refresh produced, and
   * only a second refusal is reported.
   */
  refreshAccount: () => Promise<void>;
}

interface ServiceMintOptions {
  /** The hosted service origin, without a trailing slash. */
  serviceBaseUrl: string;
  /** The mint endpoint's path under that origin. */
  servicePath: string;
  /** Names the minter in the stderr line a failed mint writes. */
  logLabel: string;
  /** The detail recorded when the service answers with no usable credential. */
  malformedDetail: string;
  /**
   * The identity an attempt carries. An endpoint that takes none omits this,
   * and then neither the header nor the refresh-and-retry exists.
   */
  authorization?: ServiceMintAuthorization;
  voice?: string;
  speed?: number;
  fetch?: CloudFetch;
  now?: () => number;
  requestTimeoutMs?: number;
}

/**
 * Mints ephemeral Realtime credentials from Luke's hosted service. Whichever
 * endpoint it is aimed at, the renderer receives only an ephemeral secret
 * aimed at OpenAI's canonical calls endpoint, validated by the same wire
 * reader, a failure resolves to nothing rather than an error, and the
 * diagnostics say why — including the day's allowance, which is what the
 * refusal a spent quota answers with is diagnosed from.
 */
class ServiceRealtimeCredentialMinter implements RealtimeCredentialMinter {
  readonly #endpoint: string;
  readonly #logLabel: string;
  readonly #malformedDetail: string;
  readonly #authorization: ServiceMintAuthorization | undefined;
  /** The voice from construction, which a cleared setting falls back to. */
  readonly #configuredVoice: string | undefined;
  #voice: string | undefined;
  readonly #configuredSpeed: number | undefined;
  #speed: number | undefined;
  readonly #fetch: CloudFetch;
  readonly #now: () => number;
  readonly #requestTimeoutMs: number;
  #lastModel: string | undefined;
  #lastOutcome: RealtimeMintOutcome = REALTIME_MINT_OUTCOME.NOT_ATTEMPTED;
  #lastDetail: string | undefined;
  #lastAttemptAt: number | undefined;
  #quota: HostedQuota | undefined;

  constructor(options: ServiceMintOptions) {
    const baseUrl = text(options.serviceBaseUrl);
    if (!baseUrl) throw new Error("Hosted service base URL must not be empty");
    this.#endpoint = `${withoutTrailingSlash(baseUrl)}${options.servicePath}`;
    this.#logLabel = options.logLabel;
    this.#malformedDetail = options.malformedDetail;
    this.#authorization = options.authorization;
    this.#configuredVoice = text(options.voice);
    this.#voice = this.#configuredVoice;
    this.#configuredSpeed = options.speed;
    this.#speed = this.#configuredSpeed;
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.#now = options.now ?? Date.now;
    this.#requestTimeoutMs = positiveInteger(
      options.requestTimeoutMs,
      SERVICE_MINT_DEFAULTS.REQUEST_TIMEOUT_MS,
    );
  }

  /**
   * Mints a fresh credential for every call: the service has been seen to
   * refuse a reused secret at the calls endpoint (status 401) even inside its
   * stated expiry, and a refused call in the announcer's path is an
   * announcement lost. This is also what the hosted allowance counts — each
   * mint answers exactly one call.
   */
  async mint(): Promise<RealtimeConnection | undefined> {
    this.#lastAttemptAt = this.#now();
    const response = await this.#authorizedMint();
    if (!response) return undefined;
    return this.#settleMint(response);
  }

  /**
   * Changes the voice new credentials are minted for. A call already open
   * keeps the voice it answered with, the keyed minter's own rule.
   */
  setVoice(voice: string | undefined): void {
    this.#voice = text(voice) ?? this.#configuredVoice;
  }

  setSpeed(speed: number | undefined): void {
    this.#speed = speed ?? this.#configuredSpeed;
  }

  diagnostics(): RealtimeDiagnostics {
    return {
      apiKeyConfigured: false,
      hosted: true,
      fixtureMode: false,
      model: this.#lastModel ?? REALTIME_DEFAULTS.MODEL,
      voice: this.#voice ?? REALTIME_DEFAULTS.VOICE,
      speed: this.#speed ?? REALTIME_DEFAULTS.SPEED,
      endpoint: this.#endpoint,
      lastOutcome: this.#lastOutcome,
      ...(this.#lastDetail ? { lastDetail: this.#lastDetail } : undefined),
      ...(this.#lastAttemptAt === undefined ? undefined : { lastAttemptAt: this.#lastAttemptAt }),
      ...(this.#quota ? { quota: this.#quota } : undefined),
    };
  }

  async #authorizedMint(): Promise<Response | undefined> {
    if (!this.#authorization) return this.#requestMint({});

    const token = await this.#authorization.readAccessToken();
    if (!token) {
      this.#recordOutcome(REALTIME_MINT_OUTCOME.NOT_SIGNED_IN, "no access token");
      return undefined;
    }

    const response = await this.#requestMint({ authorization: `Bearer ${token}` });
    if (response?.status !== UNAUTHORIZED_STATUS) return response;

    // Routine expiry of an hour-lived token inside a day-lived app: refresh
    // and retry once. A retry on the same token would only repeat the no.
    await this.#authorization.refreshAccount().catch(() => undefined);
    const refreshed = await this.#authorization.readAccessToken();
    if (!refreshed || refreshed === token) return response;
    return this.#requestMint({ authorization: `Bearer ${refreshed}` });
  }

  async #requestMint(headers: Record<string, string>): Promise<Response | undefined> {
    try {
      return await this.#fetch(this.#endpoint, {
        method: "POST",
        headers: {
          ...headers,
          "content-type": "application/json",
        },
        // Only values inside the build's own sets travel; anything else lets
        // the service mint its default rather than sending a refusable field.
        body: JSON.stringify({
          ...(isRealtimeVoice(this.#voice) ? { voice: this.#voice } : undefined),
          ...(isRealtimeVoiceSpeed(this.#speed) ? { speed: this.#speed } : undefined),
        }),
        signal: AbortSignal.timeout(this.#requestTimeoutMs),
      });
    } catch (error) {
      this.#recordOutcome(
        REALTIME_MINT_OUTCOME.NETWORK_ERROR,
        error instanceof Error ? error.name : "unknown error",
      );
      return undefined;
    }
  }

  async #settleMint(response: Response): Promise<RealtimeConnection | undefined> {
    const payload = await response.json().catch(() => undefined);
    if (!response.ok) {
      this.#refuseMint(response.status, unparsedWire(payload));
      return undefined;
    }

    const answer =
      payload === undefined ? undefined : hostedMintAnswerAt(unparsedWire(payload), this.#now());
    if (!answer) {
      this.#recordOutcome(REALTIME_MINT_OUTCOME.MALFORMED_RESPONSE, this.#malformedDetail);
      return undefined;
    }

    this.#lastModel = answer.connection.model;
    this.#quota = answer.quota ?? this.#quota;
    this.#recordOutcome(REALTIME_MINT_OUTCOME.SUCCEEDED);
    return answer.connection;
  }

  /**
   * Names a refusal from its status. A 429 is read as a spent allowance
   * whatever reason it names, because that is the only thing either endpoint
   * refuses a mint for, and the http-error fallback would read as a fault
   * worth chasing; the quota it carries is kept where it carries one, and the
   * introduction endpoint carries none. A 401 is only a signed-out answer
   * where an identity was sent at all.
   */
  #refuseMint(status: number, payload: UnparsedWireValue): void {
    if (status === QUOTA_STATUS) {
      this.#quota = isRecord(payload)
        ? hostedQuotaSchema.parse(unparsedWire(payload.quota))
        : undefined;
      this.#recordOutcome(REALTIME_MINT_OUTCOME.QUOTA_EXHAUSTED);
      return;
    }
    if (status === UNAVAILABLE_STATUS) {
      this.#recordOutcome(REALTIME_MINT_OUTCOME.HOSTED_UNAVAILABLE);
      return;
    }
    if (status === UNAUTHORIZED_STATUS && this.#authorization) {
      this.#recordOutcome(REALTIME_MINT_OUTCOME.NOT_SIGNED_IN, `status ${status}`);
      return;
    }
    this.#recordOutcome(REALTIME_MINT_OUTCOME.HTTP_ERROR, `status ${status}`);
  }

  #recordOutcome(outcome: RealtimeMintOutcome, detail?: string): void {
    this.#lastOutcome = outcome;
    this.#lastDetail = detail;
    if (outcome === REALTIME_MINT_OUTCOME.SUCCEEDED) return;
    process.stderr.write(`${this.#logLabel}: ${outcome}${detail ? ` (${detail})` : ""}\n`);
  }
}

/**
 * What a caller says about a mint; the endpoint, its label, and whether it
 * carries an identity at all are the build's own.
 */
type RealtimeCredentialOptions = Omit<
  ServiceMintOptions,
  "servicePath" | "logLabel" | "malformedDetail" | "authorization"
>;

export type HostedRealtimeCredentialOptions = RealtimeCredentialOptions & ServiceMintAuthorization;

/**
 * The signed-in account's voice mint, for a developer who has not connected
 * an OpenAI key of their own.
 */
export function hostedRealtimeCredentialMinter(
  options: HostedRealtimeCredentialOptions,
): RealtimeCredentialMinter {
  const { readAccessToken, refreshAccount, ...rest } = options;
  return new ServiceRealtimeCredentialMinter({
    ...rest,
    servicePath: HOSTED_SERVICE_PATH.VOICE_MINT,
    logLabel: "Hosted realtime mint",
    malformedDetail: "no usable hosted credential",
    authorization: { readAccessToken, refreshAccount },
  });
}

export type IntroductionRealtimeCredentialOptions = RealtimeCredentialOptions;

/**
 * The one-time onboarding introduction's mint, before any account exists. The
 * request deliberately carries no authorization header — the endpoint takes no
 * identity and this minter holds none to send.
 */
export function introductionRealtimeCredentialMinter(
  options: IntroductionRealtimeCredentialOptions,
): RealtimeCredentialMinter {
  return new ServiceRealtimeCredentialMinter({
    ...options,
    servicePath: HOSTED_SERVICE_PATH.INTRODUCTION_MINT,
    logLabel: "Introduction realtime mint",
    malformedDetail: "no usable introduction credential",
  });
}
