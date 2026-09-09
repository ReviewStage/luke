import {
  type AccountCall,
  type AccountToken,
  accountBearer,
  CALL_FAULT,
  type CallFailure,
  callAnswered,
  createAccountCall,
  HOSTED_SERVICE_PATH,
  type HostedQuota,
  hostedMintAnswerAt,
  hostedQuotaSchema,
  NO_CREDENTIAL,
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
  HTTP_METHOD,
  HTTP_STATUS,
  isRecord,
  text,
  type UnparsedWireValue,
  unparsedWire,
} from "@sidecar/wire";

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
  authorization?: AccountToken;
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
  readonly #call: AccountCall;
  readonly #path: string;
  /** Whether an attempt carried an identity at all, which is what makes a 401 a signed-out answer. */
  readonly #identified: boolean;
  readonly #logLabel: string;
  readonly #malformedDetail: string;
  /** The voice from construction, which a cleared setting falls back to. */
  readonly #configuredVoice: string | undefined;
  #voice: string | undefined;
  readonly #configuredSpeed: number | undefined;
  #speed: number | undefined;
  readonly #now: () => number;
  #lastModel: string | undefined;
  #lastOutcome: RealtimeMintOutcome = REALTIME_MINT_OUTCOME.NOT_ATTEMPTED;
  #lastDetail: string | undefined;
  #lastAttemptAt: number | undefined;
  #quota: HostedQuota | undefined;

  constructor(options: ServiceMintOptions) {
    this.#call = createAccountCall({
      baseUrl: options.serviceBaseUrl,
      credential: options.authorization ? accountBearer(options.authorization) : NO_CREDENTIAL,
      fetch: options.fetch,
      requestTimeoutMs: options.requestTimeoutMs,
    });
    this.#path = options.servicePath;
    this.#identified = options.authorization !== undefined;
    this.#logLabel = options.logLabel;
    this.#malformedDetail = options.malformedDetail;
    this.#configuredVoice = text(options.voice);
    this.#voice = this.#configuredVoice;
    this.#configuredSpeed = options.speed;
    this.#speed = this.#configuredSpeed;
    this.#now = options.now ?? Date.now;
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
    const answer = await this.#call.send({
      method: HTTP_METHOD.POST,
      path: this.#path,
      // Only values inside the build's own sets travel; anything else lets
      // the service mint its default rather than sending a refusable field.
      body: JSON.stringify({
        ...(isRealtimeVoice(this.#voice) ? { voice: this.#voice } : undefined),
        ...(isRealtimeVoiceSpeed(this.#speed) ? { speed: this.#speed } : undefined),
      }),
    });
    if (!callAnswered(answer)) return this.#refuseCall(answer);
    return this.#settleMint(answer.response);
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
      endpoint: this.#call.address(this.#path),
      lastOutcome: this.#lastOutcome,
      ...(this.#lastDetail ? { lastDetail: this.#lastDetail } : undefined),
      ...(this.#lastAttemptAt === undefined ? undefined : { lastAttemptAt: this.#lastAttemptAt }),
      ...(this.#quota ? { quota: this.#quota } : undefined),
    };
  }

  /** A mint that never reached the service, named by the fault the call ended at. */
  #refuseCall(failure: CallFailure): undefined {
    switch (failure.fault) {
      case CALL_FAULT.NO_CREDENTIAL:
        this.#recordOutcome(REALTIME_MINT_OUTCOME.NOT_SIGNED_IN, "no access token");
        return undefined;
      case CALL_FAULT.HOLDER_CHANGED:
        this.#recordOutcome(REALTIME_MINT_OUTCOME.NOT_SIGNED_IN, "the account changed");
        return undefined;
      case CALL_FAULT.NETWORK:
        this.#recordOutcome(
          REALTIME_MINT_OUTCOME.NETWORK_ERROR,
          failure.errorName ?? "unknown error",
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
    if (status === HTTP_STATUS.TOO_MANY_REQUESTS) {
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
    if (status === HTTP_STATUS.UNAUTHORIZED && this.#identified) {
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

export type HostedRealtimeCredentialOptions = RealtimeCredentialOptions & AccountToken;

/**
 * The signed-in account's voice mint, for a developer who has not connected
 * an OpenAI key of their own.
 */
export function hostedRealtimeCredentialMinter(
  options: HostedRealtimeCredentialOptions,
): RealtimeCredentialMinter {
  const { readAccessToken, refreshAccount, readAccountKey, ...rest } = options;
  return new ServiceRealtimeCredentialMinter({
    ...rest,
    servicePath: HOSTED_SERVICE_PATH.VOICE_MINT,
    logLabel: "Hosted realtime mint",
    malformedDetail: "no usable hosted credential",
    authorization: { readAccessToken, refreshAccount, readAccountKey },
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
