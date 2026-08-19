import {
  HOSTED_API_ERROR,
  HOSTED_SERVICE_PATH,
  type HostedQuota,
  hostedErrorFromWire,
  hostedMintAnswerFromWire,
  hostedQuotaFromWire,
  isRealtimeVoice,
  isRealtimeVoiceSpeed,
  isRecord,
  positiveInteger,
  REALTIME_DEFAULTS,
  REALTIME_MINT_OUTCOME,
  type RealtimeConnection,
  type RealtimeDiagnostics,
  type RealtimeMintOutcome,
  text,
  type UnparsedWireValue,
} from "@sidecar/core";
import type { RealtimeCredentialMinter } from "./realtime-minter";

const HOSTED_DEFAULTS = {
  REQUEST_TIMEOUT_MS: 10_000,
} as const;

const UNAUTHORIZED_STATUS = 401;
const QUOTA_STATUS = 429;
const UNAVAILABLE_STATUS = 503;

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface HostedRealtimeCredentialOptions {
  /** The hosted service origin, without a trailing slash. */
  serviceBaseUrl: string;
  /** The signed-in account's current access token, read fresh for every mint. */
  readAccessToken: () => Promise<string | undefined>;
  /**
   * Asks the account lifecycle to refresh its tokens. Access tokens outlive a
   * mint by an hour at most while the app runs for days, so a 401 here is
   * routine — the mint retries once with whatever the refresh produced, and
   * only a second refusal is reported.
   */
  refreshAccount: () => Promise<void>;
  voice?: string;
  speed?: number;
  fetch?: FetchLike;
  now?: () => number;
  requestTimeoutMs?: number;
}

function withoutTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

/**
 * Mints ephemeral Realtime credentials from Luke's hosted service on the
 * signed-in account, for a developer who has not connected an OpenAI key of
 * their own. The shape mirrors the keyed minter deliberately: the renderer
 * still receives only an ephemeral secret aimed at OpenAI's canonical calls
 * endpoint, a failure resolves to nothing rather than an error, and the
 * diagnostics say why — including the day's allowance, which is what the
 * refusal a spent quota answers with is diagnosed from.
 */
export class HostedRealtimeCredentialMinter implements RealtimeCredentialMinter {
  readonly #endpoint: string;
  readonly #readAccessToken: () => Promise<string | undefined>;
  readonly #refreshAccount: () => Promise<void>;
  /** The voice from construction, which a cleared setting falls back to. */
  readonly #configuredVoice: string | undefined;
  #voice: string | undefined;
  readonly #configuredSpeed: number | undefined;
  #speed: number | undefined;
  readonly #fetch: FetchLike;
  readonly #now: () => number;
  readonly #requestTimeoutMs: number;
  #lastModel: string | undefined;
  #lastOutcome: RealtimeMintOutcome = REALTIME_MINT_OUTCOME.NOT_ATTEMPTED;
  #lastDetail: string | undefined;
  #lastAttemptAt: number | undefined;
  #quota: HostedQuota | undefined;

  constructor(options: HostedRealtimeCredentialOptions) {
    const baseUrl = text(options.serviceBaseUrl);
    if (!baseUrl) throw new Error("Hosted service base URL must not be empty");
    this.#endpoint = `${withoutTrailingSlash(baseUrl)}${HOSTED_SERVICE_PATH.VOICE_MINT}`;
    this.#readAccessToken = options.readAccessToken;
    this.#refreshAccount = options.refreshAccount;
    this.#configuredVoice = text(options.voice);
    this.#voice = this.#configuredVoice;
    this.#configuredSpeed = options.speed;
    this.#speed = this.#configuredSpeed;
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.#now = options.now ?? Date.now;
    this.#requestTimeoutMs = positiveInteger(
      options.requestTimeoutMs,
      HOSTED_DEFAULTS.REQUEST_TIMEOUT_MS,
    );
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

  /**
   * Mints a fresh credential for every call, the keyed minter's own rule: the
   * service has been seen to refuse a reused secret at the calls endpoint
   * (status 401) even inside its stated expiry, and a refused call in the
   * announcer's path is an announcement lost. This is also what the hosted
   * allowance counts — each mint answers exactly one call.
   */
  async mint(): Promise<RealtimeConnection | undefined> {
    this.#lastAttemptAt = this.#now();

    const token = await this.#readAccessToken();
    if (!token) {
      this.#record(REALTIME_MINT_OUTCOME.NOT_SIGNED_IN, "no access token");
      return undefined;
    }

    let response = await this.#request(token);
    if (response?.status === UNAUTHORIZED_STATUS) {
      // Routine expiry of an hour-lived token inside a day-lived app: refresh
      // and retry once. A retry on the same token would only repeat the no.
      await this.#refreshAccount().catch(() => undefined);
      const refreshed = await this.#readAccessToken();
      if (refreshed && refreshed !== token) {
        response = await this.#request(refreshed);
      }
    }
    if (!response) return undefined;

    const payload: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      this.#refuse(response.status, payload);
      return undefined;
    }

    const answer =
      payload === undefined ? undefined : hostedMintAnswerFromWire(payload, this.#now());
    if (!answer) {
      this.#record(REALTIME_MINT_OUTCOME.MALFORMED_RESPONSE, "no usable hosted credential");
      return undefined;
    }

    this.#lastModel = answer.connection.model;
    this.#quota = answer.quota ?? this.#quota;
    this.#record(REALTIME_MINT_OUTCOME.SUCCEEDED);
    return answer.connection;
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

  /** Names a refusal from its status and reason, keeping the quota a 429 carries. */
  #refuse(status: number, payload: UnparsedWireValue): void {
    const reason = hostedErrorFromWire(payload);
    if (status === QUOTA_STATUS && reason === HOSTED_API_ERROR.QUOTA_EXHAUSTED) {
      this.#quota = isRecord(payload) ? hostedQuotaFromWire(payload.quota) : undefined;
      this.#record(REALTIME_MINT_OUTCOME.QUOTA_EXHAUSTED);
      return;
    }
    if (status === UNAVAILABLE_STATUS) {
      this.#record(REALTIME_MINT_OUTCOME.HOSTED_UNAVAILABLE);
      return;
    }
    if (status === UNAUTHORIZED_STATUS) {
      this.#record(REALTIME_MINT_OUTCOME.NOT_SIGNED_IN, `status ${status}`);
      return;
    }
    this.#record(REALTIME_MINT_OUTCOME.HTTP_ERROR, `status ${status}`);
  }

  async #request(token: string): Promise<Response | undefined> {
    // The kind of call and nothing else: the token, the preferences, and the
    // minted secret stay out of the log. The model is the service's choice, so
    // it has no name to log until the answer arrives.
    console.log("AI call: hosted realtime voice credential mint");
    try {
      return await this.#fetch(this.#endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
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
    process.stderr.write(`Hosted realtime mint: ${outcome}${detail ? ` (${detail})` : ""}\n`);
  }
}
