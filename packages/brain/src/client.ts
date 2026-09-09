import {
  type AccountToken,
  HOSTED_API_ERROR,
  HOSTED_BRAIN_CONTRACT_VERSION,
  HOSTED_SERVICE_PATH,
  type HostedBrainCapabilities,
  hostedBrainCapabilitiesFromWire,
  hostedQuotaSchema,
} from "@sidecar/hosted";
import { MODEL_FAILURE } from "@sidecar/runtime/vocabulary";
import {
  type CloudFetch,
  HTTP_STATUS,
  positiveInteger,
  text,
  type UnparsedWireValue,
  unparsedWire,
  wireRecord,
  withoutTrailingSlash,
} from "@sidecar/wire";
import {
  BRAIN_REQUEST_TIMEOUT_MS,
  type Failure,
  failed,
  HTTP_METHOD,
  type HttpMethod,
  notServed,
  payloadOf,
  RETRY_AFTER_HEADER,
  rateLimitWaitMs,
  requestFault,
} from "./model-adapter-shared.js";
import type { Quiet } from "./responses-model-adapter.js";

/** What every call out of the brain is addressed and bounded by, whatever authorizes it. */
export interface BrainTransportOptions {
  /** The origin the calls are addressed to; any trailing separator is trimmed. */
  baseUrl: string;
  fetch?: CloudFetch;
  now?: () => number;
  requestTimeoutMs?: number;
}

/**
 * One call out of the brain, whatever authorizes it: the base URL trimmed
 * once, the bearer header written once, the per-request timeout joined with
 * the caller's own cancellation once, a fetch that throws read as a network
 * failure by the error's kind alone and never by its words, which could carry
 * a key, and one reading of what a 429 means. What a subclass supplies is the
 * credential — a key the developer typed, or the signed-in account's token,
 * which is refreshed once when the first attempt is refused.
 */
export abstract class BrainTransport {
  protected readonly baseUrl: string;
  protected readonly now: () => number;
  readonly #fetch: CloudFetch;
  readonly #requestTimeoutMs: number;

  protected constructor(options: BrainTransportOptions) {
    const baseUrl = text(options.baseUrl);
    if (!baseUrl) throw new Error("Brain transport base URL must not be empty");
    this.baseUrl = withoutTrailingSlash(baseUrl);
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.now = options.now ?? Date.now;
    this.#requestTimeoutMs = positiveInteger(options.requestTimeoutMs, BRAIN_REQUEST_TIMEOUT_MS);
  }

  /** The words a quiet is reported with, which name the transport the developer is on. */
  protected abstract readonly label: string;

  /** The authorization header for one attempt, or nothing when there is no credential to send. */
  protected abstract authorization(): Promise<string | undefined>;

  /** A fresh authorization for one retry of a refused attempt, or nothing to let the refusal stand. */
  protected retryUnauthorized(_used: string): Promise<string | undefined> {
    return Promise.resolve(undefined);
  }

  /**
   * One authorized request. No credential at all and a fetch that did not
   * complete are already ends, named by kind; every status is the caller's to
   * read, including the refusal that outlived a refreshed credential.
   */
  async send(
    path: string,
    method: HttpMethod,
    body?: string,
    signal?: AbortSignal,
  ): Promise<Response | Failure> {
    const authorization = await this.authorization();
    if (!authorization) return failed(MODEL_FAILURE.CREDENTIAL, "no account token");
    const response = await this.#attempt(path, method, authorization, body, signal);
    if (!(response instanceof Response) || response.status !== HTTP_STATUS.UNAUTHORIZED) {
      return response;
    }
    const refreshed = await this.retryUnauthorized(authorization);
    return refreshed === undefined
      ? response
      : this.#attempt(path, method, refreshed, body, signal);
  }

  /**
   * What a 429 means. The bounded `Retry-After` wait is the floor every
   * transport takes, so a hosted developer and a keyed one wait the same way
   * for the same provider limit; a body naming a later reset — a spent daily
   * allowance — stands the transport down until then instead.
   */
  quietUntil(response: Response, body?: UnparsedWireValue): Quiet {
    const record = wireRecord(unparsedWire(body));
    const quota =
      record?.error === HOSTED_API_ERROR.QUOTA_EXHAUSTED
        ? hostedQuotaSchema.parse(unparsedWire(record.quota))
        : undefined;
    const resetsAt = quota?.resetsAt;
    if (resetsAt !== undefined && resetsAt > this.now()) {
      return {
        until: resetsAt,
        message: `${this.label} are out of today's allowance; pausing for ${Math.round((resetsAt - this.now()) / 1000)}s`,
      };
    }
    const waitMs = rateLimitWaitMs(response.headers.get(RETRY_AFTER_HEADER));
    return {
      until: this.now() + waitMs,
      message: `${this.label} are rate limited; pausing for ${Math.round(waitMs / 1000)}s`,
    };
  }

  async #attempt(
    path: string,
    method: HttpMethod,
    authorization: string,
    body: string | undefined,
    signal: AbortSignal | undefined,
  ): Promise<Response | Failure> {
    try {
      return await this.#fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          authorization,
          ...(body !== undefined ? { "content-type": "application/json" } : undefined),
        },
        ...(body !== undefined ? { body } : undefined),
        signal: requestSignal(this.#requestTimeoutMs, signal),
      });
    } catch (error) {
      return requestFault(error instanceof Error ? error : undefined);
    }
  }
}

/** The developer's own key straight to the provider: one header, one attempt, nothing to refresh. */
export class KeyedBrainTransport extends BrainTransport {
  protected readonly label = "OpenAI brain turns";
  readonly #authorization: string;

  constructor(options: BrainTransportOptions & { apiKey: string }) {
    super(options);
    const apiKey = text(options.apiKey);
    if (!apiKey) throw new Error("OpenAI API key must not be empty");
    this.#authorization = bearer(apiKey);
  }

  protected authorization(): Promise<string | undefined> {
    return Promise.resolve(this.#authorization);
  }
}

/**
 * Luke's hosted service on the signed-in account, shared by every adapter
 * that speaks to it: the token read fresh per attempt and refreshed once when
 * the first is refused, and the capabilities read that admits an operation.
 */
export class HostedBrainTransport extends BrainTransport {
  protected readonly label = "Hosted brain turns";
  readonly #readAccessToken: () => Promise<string | undefined>;
  readonly #refreshAccount: () => Promise<void>;

  constructor(options: BrainTransportOptions & AccountToken) {
    super(options);
    this.#readAccessToken = options.readAccessToken;
    this.#refreshAccount = options.refreshAccount;
  }

  /** Reads the service's capabilities; a service that has none, or names another contract, is incompatible. */
  async capabilities(): Promise<HostedBrainCapabilities | Failure> {
    const response = await this.send(HOSTED_SERVICE_PATH.BRAIN_CAPABILITIES, HTTP_METHOD.GET);
    if (!(response instanceof Response)) return response;
    if (notServed(response)) {
      return failed(
        MODEL_FAILURE.COMPATIBILITY,
        `the hosted service does not offer brain contract ${HOSTED_BRAIN_CONTRACT_VERSION}`,
      );
    }
    if (response.status === HTTP_STATUS.UNAUTHORIZED) {
      return failed(MODEL_FAILURE.CREDENTIAL, "the account token was refused");
    }
    if (!response.ok) {
      return failed(MODEL_FAILURE.UPSTREAM, `capabilities failed with status ${response.status}`);
    }
    const capabilities = hostedBrainCapabilitiesFromWire(await payloadOf(response));
    if (!capabilities) {
      return failed(
        MODEL_FAILURE.COMPATIBILITY,
        `the hosted service's capabilities are not brain contract ${HOSTED_BRAIN_CONTRACT_VERSION}`,
      );
    }
    return capabilities;
  }

  protected override async retryUnauthorized(used: string): Promise<string | undefined> {
    // Routine expiry of an hour-lived token inside a day-lived app: refresh and
    // retry once. A retry on the same token would only repeat the no.
    await this.#refreshAccount().catch(() => undefined);
    const refreshed = await this.#readAccessToken();
    if (!refreshed) return undefined;
    const authorization = bearer(refreshed);
    return authorization === used ? undefined : authorization;
  }

  protected async authorization(): Promise<string | undefined> {
    const token = await this.#readAccessToken();
    return token ? bearer(token) : undefined;
  }
}

function bearer(credential: string): string {
  return `Bearer ${credential}`;
}

/** The per-request timeout, joined with the run's own cancellation when the call belongs to one. */
function requestSignal(timeoutMs: number, cancellation: AbortSignal | undefined): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return cancellation ? AbortSignal.any([timeout, cancellation]) : timeout;
}
