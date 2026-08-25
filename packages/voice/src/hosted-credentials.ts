import {
  HOSTED_API_ERROR,
  HOSTED_SERVICE_PATH,
  hostedErrorFromWire,
  hostedQuotaFromWire,
} from "@sidecar/hosted";
import { REALTIME_MINT_OUTCOME, type RealtimeConnection } from "@sidecar/realtime";
import { isRecord, type UnparsedWireValue, unparsedWire } from "@sidecar/wire";
import { type FetchLike, ServiceRealtimeCredentialMinter } from "./service-mint.js";

const UNAUTHORIZED_STATUS = 401;
const QUOTA_STATUS = 429;
const UNAVAILABLE_STATUS = 503;

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

/**
 * Mints ephemeral Realtime credentials from Luke's hosted service on the
 * signed-in account, for a developer who has not connected an OpenAI key of
 * their own. The shape mirrors the keyed minter deliberately: the renderer
 * still receives only an ephemeral secret aimed at OpenAI's canonical calls
 * endpoint, a failure resolves to nothing rather than an error, and the
 * diagnostics say why — including the day's allowance, which is what the
 * refusal a spent quota answers with is diagnosed from.
 */
export class HostedRealtimeCredentialMinter extends ServiceRealtimeCredentialMinter {
  readonly #readAccessToken: () => Promise<string | undefined>;
  readonly #refreshAccount: () => Promise<void>;

  constructor(options: HostedRealtimeCredentialOptions) {
    super({
      serviceBaseUrl: options.serviceBaseUrl,
      servicePath: HOSTED_SERVICE_PATH.VOICE_MINT,
      logLabel: "Hosted realtime mint",
      malformedDetail: "no usable hosted credential",
      voice: options.voice,
      speed: options.speed,
      fetch: options.fetch,
      now: options.now,
      requestTimeoutMs: options.requestTimeoutMs,
    });
    this.#readAccessToken = options.readAccessToken;
    this.#refreshAccount = options.refreshAccount;
  }

  /**
   * Mints a fresh credential for every call, the keyed minter's own rule: the
   * service has been seen to refuse a reused secret at the calls endpoint
   * (status 401) even inside its stated expiry, and a refused call in the
   * announcer's path is an announcement lost. This is also what the hosted
   * allowance counts — each mint answers exactly one call.
   */
  override async mint(): Promise<RealtimeConnection | undefined> {
    this.beginAttempt();

    const token = await this.#readAccessToken();
    if (!token) {
      this.recordOutcome(REALTIME_MINT_OUTCOME.NOT_SIGNED_IN, "no access token");
      return undefined;
    }

    let response = await this.requestMint({ authorization: `Bearer ${token}` });
    if (response?.status === UNAUTHORIZED_STATUS) {
      // Routine expiry of an hour-lived token inside a day-lived app: refresh
      // and retry once. A retry on the same token would only repeat the no.
      await this.#refreshAccount().catch(() => undefined);
      const refreshed = await this.#readAccessToken();
      if (refreshed && refreshed !== token) {
        response = await this.requestMint({ authorization: `Bearer ${refreshed}` });
      }
    }
    if (!response) return undefined;
    return this.settleMint(response);
  }

  /** Names a refusal from its status and reason, keeping the quota a 429 carries. */
  protected override refuseMint(status: number, payload: UnparsedWireValue): void {
    const reason = hostedErrorFromWire(payload);
    if (status === QUOTA_STATUS && reason === HOSTED_API_ERROR.QUOTA_EXHAUSTED) {
      this.keepQuota(
        isRecord(payload) ? hostedQuotaFromWire(unparsedWire(payload.quota)) : undefined,
      );
      this.recordOutcome(REALTIME_MINT_OUTCOME.QUOTA_EXHAUSTED);
      return;
    }
    if (status === UNAVAILABLE_STATUS) {
      this.recordOutcome(REALTIME_MINT_OUTCOME.HOSTED_UNAVAILABLE);
      return;
    }
    if (status === UNAUTHORIZED_STATUS) {
      this.recordOutcome(REALTIME_MINT_OUTCOME.NOT_SIGNED_IN, `status ${status}`);
      return;
    }
    this.recordOutcome(REALTIME_MINT_OUTCOME.HTTP_ERROR, `status ${status}`);
  }
}
