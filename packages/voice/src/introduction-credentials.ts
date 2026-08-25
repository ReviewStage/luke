import { HOSTED_SERVICE_PATH } from "@sidecar/hosted";
import { REALTIME_MINT_OUTCOME, type RealtimeConnection } from "@sidecar/realtime";
import type { UnparsedWireValue } from "@sidecar/wire";
import { type FetchLike, ServiceRealtimeCredentialMinter } from "./service-mint.js";

const RATE_LIMITED_STATUS = 429;
const UNAVAILABLE_STATUS = 503;

export interface IntroductionRealtimeCredentialOptions {
  /** The hosted service origin, without a trailing slash. */
  serviceBaseUrl: string;
  voice?: string;
  speed?: number;
  fetch?: FetchLike;
  now?: () => number;
  requestTimeoutMs?: number;
}

/**
 * Mints the one-time onboarding introduction's credential from Luke's hosted
 * service, before any account exists. The request deliberately carries no
 * authorization header — the endpoint takes no identity and this minter holds
 * none to send — and everything else keeps the hosted minter's shape: the
 * renderer still receives only an ephemeral secret aimed at OpenAI's
 * canonical calls endpoint, validated by the same wire reader, a failure
 * resolves to nothing rather than an error, and the diagnostics say why.
 */
export class IntroductionRealtimeCredentialMinter extends ServiceRealtimeCredentialMinter {
  constructor(options: IntroductionRealtimeCredentialOptions) {
    super({
      serviceBaseUrl: options.serviceBaseUrl,
      servicePath: HOSTED_SERVICE_PATH.INTRODUCTION_MINT,
      logLabel: "Introduction realtime mint",
      malformedDetail: "no usable introduction credential",
      voice: options.voice,
      speed: options.speed,
      fetch: options.fetch,
      now: options.now,
      requestTimeoutMs: options.requestTimeoutMs,
    });
  }

  /**
   * Mints a fresh credential for every call, the other minters' own rule: the
   * service refuses a reused secret at the calls endpoint, and the
   * introduction's secret is capped so short that a held-back one would be
   * dead before a second call could want it.
   */
  override async mint(): Promise<RealtimeConnection | undefined> {
    this.beginAttempt();

    const response = await this.requestMint({});
    if (!response) return undefined;
    return this.settleMint(response);
  }

  /**
   * Names a refusal from its status alone: the introduction's 429 carries no
   * quota to keep. The spent introduction cap reads as the quota outcome
   * because that is what it is — today's free allowance for this endpoint is
   * gone and returns at midnight UTC — where the http-error fallback would
   * read as a fault worth chasing.
   */
  protected override refuseMint(status: number, _payload: UnparsedWireValue): void {
    if (status === RATE_LIMITED_STATUS) {
      this.recordOutcome(REALTIME_MINT_OUTCOME.QUOTA_EXHAUSTED);
      return;
    }
    if (status === UNAVAILABLE_STATUS) {
      this.recordOutcome(REALTIME_MINT_OUTCOME.HOSTED_UNAVAILABLE);
      return;
    }
    this.recordOutcome(REALTIME_MINT_OUTCOME.HTTP_ERROR, `status ${status}`);
  }
}
