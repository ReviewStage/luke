import {
  HOSTED_SERVICE_PATH,
  type HostedUsageAnswer,
  hostedUsageAnswerFromWire,
} from "@sidecar/hosted";
import { positiveInteger, text, unparsedWire } from "@sidecar/wire";

const HOSTED_DEFAULTS = {
  REQUEST_TIMEOUT_MS: 10_000,
} as const;

const UNAUTHORIZED_STATUS = 401;

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface HostedUsageReaderOptions {
  /** The hosted service origin, without a trailing slash. */
  serviceBaseUrl: string;
  readAccessToken: () => Promise<string | undefined>;
  refreshAccount: () => Promise<void>;
  fetch?: FetchLike;
  requestTimeoutMs?: number;
}

function withoutTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

/**
 * Reads where today's hosted allowance stands, spending nothing: the one ask
 * that lets the Voice page show what remains before the first call of the day
 * rather than only after one has answered. The shape follows the hosted mint —
 * token read fresh per ask, a 401 refreshed and retried once — and a failure
 * resolves to nothing, leaving the page's wording to the allowance sentence
 * that promises no numbers.
 */
export class HostedUsageReader {
  readonly #endpoint: string;
  readonly #readAccessToken: () => Promise<string | undefined>;
  readonly #refreshAccount: () => Promise<void>;
  readonly #fetch: FetchLike;
  readonly #requestTimeoutMs: number;

  constructor(options: HostedUsageReaderOptions) {
    const baseUrl = text(options.serviceBaseUrl);
    if (!baseUrl) throw new Error("Hosted service base URL must not be empty");
    this.#endpoint = `${withoutTrailingSlash(baseUrl)}${HOSTED_SERVICE_PATH.USAGE}`;
    this.#readAccessToken = options.readAccessToken;
    this.#refreshAccount = options.refreshAccount;
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.#requestTimeoutMs = positiveInteger(
      options.requestTimeoutMs,
      HOSTED_DEFAULTS.REQUEST_TIMEOUT_MS,
    );
  }

  async read(): Promise<HostedUsageAnswer | undefined> {
    const token = await this.#readAccessToken();
    if (!token) return undefined;

    let response = await this.#request(token);
    if (response?.status === UNAUTHORIZED_STATUS) {
      await this.#refreshAccount().catch(() => undefined);
      const refreshed = await this.#readAccessToken();
      if (refreshed && refreshed !== token) {
        response = await this.#request(refreshed);
      }
    }
    if (!response?.ok) return undefined;

    const payload = await response.json().catch(() => undefined);
    return payload === undefined ? undefined : hostedUsageAnswerFromWire(unparsedWire(payload));
  }

  async #request(token: string): Promise<Response | undefined> {
    try {
      return await this.#fetch(this.#endpoint, {
        method: "GET",
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(this.#requestTimeoutMs),
      });
    } catch {
      return undefined;
    }
  }
}
