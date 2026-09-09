import {
  HOSTED_BRAIN_CONTRACT_VERSION,
  HOSTED_BRAIN_OPTION_BOUNDS,
  HOSTED_SERVICE_PATH,
  type HostedBrainCapabilities,
  hostedBrainCapabilitiesFromWire,
} from "@sidecar/hosted";
import {
  MODEL_FAILURE,
  MODEL_RESPONSE_OUTCOME,
  type ModelFailure,
} from "@sidecar/runtime/vocabulary";
import {
  type CloudFetch,
  HTTP_STATUS,
  positiveInteger,
  text,
  type UnparsedWireValue,
  withoutTrailingSlash,
} from "@sidecar/wire";

/** The output budget one inference is asked for, the same on every transport: the hosted contract's ceiling. */
export const BRAIN_MAXIMUM_OUTPUT_TOKENS = HOSTED_BRAIN_OPTION_BOUNDS.MAXIMUM_OUTPUT_TOKENS;

/** A turn may read a transcript, reason over it, and act; the ceiling is for a runaway, not a budget. */
export const BRAIN_REQUEST_TIMEOUT_MS = 90_000;

/**
 * What the two Responses adapters share: the statuses they read off a
 * transport, the cooldown a rate limit earns, and the shapes of a failure.
 */

export const HTTP_METHOD = {
  GET: "GET",
  POST: "POST",
} as const;

export type HttpMethod = (typeof HTTP_METHOD)[keyof typeof HTTP_METHOD];

export const RETRY_AFTER_HEADER = "retry-after";

/**
 * How long inferences stay unsent after a rate limit that names no wait of
 * its own. Wakes held back during the quiet are not lost: they stay pending
 * and open one turn together once it ends.
 */
export const BRAIN_RATE_LIMIT_COOLDOWN_MS = 60_000;

/**
 * The longest a `Retry-After` may stand the adapter down: a provider's header
 * is honored, but a header naming an hour is not a reason to sit an hour, and
 * one naming nothing readable earns the fixed cooldown instead.
 */
export const BRAIN_RATE_LIMIT_RETRY_AFTER_BOUND_MS = 10 * 60 * 1000;

/** The wait a rate limit earns from its header, bounded, or the fixed cooldown when the header says nothing usable. */
export function rateLimitWaitMs(retryAfter: string | null): number {
  const seconds = Number(retryAfter);
  if (!Number.isFinite(seconds) || seconds <= 0) return BRAIN_RATE_LIMIT_COOLDOWN_MS;
  return Math.min(Math.round(seconds * 1000), BRAIN_RATE_LIMIT_RETRY_AFTER_BOUND_MS);
}

/** The per-request timeout, joined with the run's own cancellation when the inference belongs to one. */
export function requestSignal(
  timeoutMs: number,
  cancellation: AbortSignal | undefined,
): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return cancellation ? AbortSignal.any([timeout, cancellation]) : timeout;
}

/** The body as JSON, or nothing when it is not; every reader validates what comes back as wire. */
export async function payloadOf(response: Response): Promise<UnparsedWireValue | undefined> {
  try {
    // SAFETY: response.json returns a runtime value; the caller's reader validates it as wire.
    return (await response.json()) as UnparsedWireValue;
  } catch {
    return undefined;
  }
}

export function failed(failure: ModelFailure, reason: string) {
  return { outcome: MODEL_RESPONSE_OUTCOME.FAILED, failure, reason } as const;
}

export function throttled(until: number) {
  return { outcome: MODEL_RESPONSE_OUTCOME.THROTTLED, until } as const;
}

export type Failure = ReturnType<typeof failed>;
/** An end already normalized for the host: a failure by kind, or a throttle with the moment to resume. */
export type Normalized = Failure | ReturnType<typeof throttled>;

/** A network fault or a timeout, named by the error's kind alone, never its words, which could carry a key. */
export function requestFault(error: Error | undefined) {
  return failed(
    MODEL_FAILURE.NETWORK,
    `request did not complete: ${error?.name ?? "unknown error"}`,
  );
}

/** Whether the service answered that it does not serve the path at all, as distinct from refusing the call. */
export function notServed(response: Response): boolean {
  return (
    response.status === HTTP_STATUS.NOT_FOUND || response.status === HTTP_STATUS.METHOD_NOT_ALLOWED
  );
}

export interface HostedServiceCallOptions {
  serviceBaseUrl: string;
  readAccessToken: () => Promise<string | undefined>;
  refreshAccount: () => Promise<void>;
  fetch?: CloudFetch;
  requestTimeoutMs?: number;
}

/**
 * One call to Luke's hosted service under the account's token, shared by
 * every adapter that speaks to it: the request itself, the token refreshed
 * once when the first is refused — the routine expiry of an hour-lived token
 * inside a day-lived app, handled like the hosted mint handles it — and the
 * capabilities read that admits an operation. No token at all is a
 * credential failure before anything is sent.
 */
export class HostedServiceCalls {
  readonly #baseUrl: string;
  readonly #readAccessToken: () => Promise<string | undefined>;
  readonly #refreshAccount: () => Promise<void>;
  readonly #fetch: CloudFetch;
  readonly #requestTimeoutMs: number;

  constructor(options: HostedServiceCallOptions) {
    const baseUrl = text(options.serviceBaseUrl);
    if (!baseUrl) throw new Error("Hosted service base URL must not be empty");
    this.#baseUrl = withoutTrailingSlash(baseUrl);
    this.#readAccessToken = options.readAccessToken;
    this.#refreshAccount = options.refreshAccount;
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.#requestTimeoutMs = positiveInteger(options.requestTimeoutMs, BRAIN_REQUEST_TIMEOUT_MS);
  }

  async send(
    path: string,
    method: HttpMethod,
    token: string,
    body?: string,
    signal?: AbortSignal,
  ): Promise<Response | undefined> {
    try {
      return await this.#fetch(`${this.#baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(body !== undefined ? { "content-type": "application/json" } : undefined),
        },
        ...(body !== undefined ? { body } : undefined),
        signal: requestSignal(this.#requestTimeoutMs, signal),
      });
    } catch {
      return undefined;
    }
  }

  async authorized(
    call: (token: string) => Promise<Response | undefined>,
  ): Promise<Response | Failure | undefined> {
    const token = await this.#readAccessToken();
    if (!token) return failed(MODEL_FAILURE.CREDENTIAL, "no account token");
    const response = await call(token);
    if (response?.status !== HTTP_STATUS.UNAUTHORIZED) return response;
    await this.#refreshAccount().catch(() => undefined);
    const refreshed = await this.#readAccessToken();
    if (refreshed && refreshed !== token) return call(refreshed);
    return response;
  }

  /** One authorized call to `path`, or the failure the transport earned; an unauthorized answer after the refresh stands as a response. */
  request(
    path: string,
    method: HttpMethod,
    body?: string,
    signal?: AbortSignal,
  ): Promise<Response | Failure | undefined> {
    return this.authorized((token) => this.send(path, method, token, body, signal));
  }

  /** Reads the service's capabilities; a service that has none, or names another contract, is incompatible. */
  async capabilities(): Promise<HostedBrainCapabilities | Failure> {
    const response = await this.request(HOSTED_SERVICE_PATH.BRAIN_CAPABILITIES, HTTP_METHOD.GET);
    if (!(response instanceof Response)) {
      return response ?? failed(MODEL_FAILURE.NETWORK, "capabilities request did not complete");
    }
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
}
