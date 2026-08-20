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
import { Effect } from "effect";
import type { RealtimeCredentialMinter } from "./realtime-minter";
import { Http } from "./services/http";
import { unparsedWire, type WireBoundaryInput } from "./wire-boundary";

const HOSTED_DEFAULTS = {
  REQUEST_TIMEOUT_MS: 10_000,
} as const;

const UNAUTHORIZED_STATUS = 401;
const QUOTA_STATUS = 429;
const UNAVAILABLE_STATUS = 503;

export interface HostedRealtimeCredentialOptions {
  /** The hosted service origin, without a trailing slash. */
  serviceBaseUrl: string;
  /** The signed-in account's current access token, read fresh for every mint. */
  readAccessToken: () => Effect.Effect<string | undefined, unknown, unknown>;
  /**
   * Asks the account lifecycle to refresh its tokens. Access tokens outlive a
   * mint by an hour at most while the app runs for days, so a 401 here is
   * routine — the mint retries once with whatever the refresh produced, and
   * only a second refusal is reported.
   */
  refreshAccount: () => Effect.Effect<void, unknown, unknown>;
  voice?: string;
  speed?: number;
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
  readonly #readAccessToken: () => Effect.Effect<string | undefined, unknown, unknown>;
  readonly #refreshAccount: () => Effect.Effect<void, unknown, unknown>;
  /** The voice from construction, which a cleared setting falls back to. */
  readonly #configuredVoice: string | undefined;
  #voice: string | undefined;
  readonly #configuredSpeed: number | undefined;
  #speed: number | undefined;
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
  mint(): Effect.Effect<RealtimeConnection | undefined, never, Http> {
    return Effect.gen(this, function* () {
      this.#lastAttemptAt = this.#now();

      // SAFETY: Hosted mint reads access tokens through the Http service requirement.
      const token = yield* this.#readAccessToken() as Effect.Effect<
        string | undefined,
        never,
        Http
      >;
      if (!token) {
        this.#record(REALTIME_MINT_OUTCOME.NOT_SIGNED_IN, "no access token");
        return undefined;
      }

      let response = yield* this.#request(token);
      if (response?.status === UNAUTHORIZED_STATUS) {
        // SAFETY: Account refresh runs through the Http service requirement on this path.
        yield* (this.#refreshAccount() as Effect.Effect<void, never, Http>).pipe(
          Effect.catchAll(() => Effect.void),
        );
        // SAFETY: Hosted mint re-reads access tokens through the Http service requirement.
        const refreshed = yield* this.#readAccessToken() as Effect.Effect<
          string | undefined,
          never,
          Http
        >;
        if (refreshed && refreshed !== token) {
          response = yield* this.#request(refreshed);
        }
      }
      if (!response) return undefined;

      const http = yield* Http;
      const payload = yield* http
        .readJson(response)
        .pipe(Effect.catchAll(() => Effect.succeed(undefined)));
      if (!response.ok) {
        this.#refuse(
          response.status,
          payload === undefined
            ? undefined
            : unparsedWire(
                // SAFETY: Hosted mint error JSON matches WireBoundaryInput at this HTTP boundary.
                payload as WireBoundaryInput,
              ),
        );
        return undefined;
      }

      const answer =
        payload === undefined
          ? undefined
          : hostedMintAnswerFromWire(
              unparsedWire(
                // SAFETY: Hosted mint JSON matches WireBoundaryInput at this HTTP boundary.
                payload as WireBoundaryInput,
              ),
              this.#now(),
            );
      if (!answer) {
        this.#record(REALTIME_MINT_OUTCOME.MALFORMED_RESPONSE, "no usable hosted credential");
        return undefined;
      }

      this.#lastModel = answer.connection.model;
      this.#quota = answer.quota ?? this.#quota;
      this.#record(REALTIME_MINT_OUTCOME.SUCCEEDED);
      return answer.connection;
    });
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
  #refuse(status: number, payload: UnparsedWireValue | undefined): void {
    const reason = hostedErrorFromWire(payload);
    if (status === QUOTA_STATUS && reason === HOSTED_API_ERROR.QUOTA_EXHAUSTED) {
      this.#quota = isRecord(payload)
        ? hostedQuotaFromWire(unparsedWire(payload.quota))
        : undefined;
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

  #request(token: string): Effect.Effect<Response | undefined, never, Http> {
    return Effect.gen(this, function* () {
      const http = yield* Http;
      return yield* http
        .request(this.#endpoint, {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            ...(isRealtimeVoice(this.#voice) ? { voice: this.#voice } : undefined),
            ...(isRealtimeVoiceSpeed(this.#speed) ? { speed: this.#speed } : undefined),
          }),
          signal: AbortSignal.timeout(this.#requestTimeoutMs),
        })
        .pipe(
          Effect.catchAll((error) => {
            this.#record(
              REALTIME_MINT_OUTCOME.NETWORK_ERROR,
              error instanceof Error ? error.failure : "unknown error",
            );
            return Effect.succeed(undefined);
          }),
        );
    });
  }

  #record(outcome: RealtimeMintOutcome, detail?: string): void {
    this.#lastOutcome = outcome;
    this.#lastDetail = detail;
    if (outcome === REALTIME_MINT_OUTCOME.SUCCEEDED) return;
    process.stderr.write(`Hosted realtime mint: ${outcome}${detail ? ` (${detail})` : ""}\n`);
  }
}
