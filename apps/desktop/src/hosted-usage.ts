import {
  HOSTED_SERVICE_PATH,
  type HostedUsageAnswer,
  hostedUsageAnswerFromWire,
  positiveInteger,
  text,
} from "@sidecar/core";
import { Effect } from "effect";
import { Http } from "./services/http";
import { unparsedWire } from "./wire-boundary";

const HOSTED_DEFAULTS = {
  REQUEST_TIMEOUT_MS: 10_000,
} as const;

const UNAUTHORIZED_STATUS = 401;

export interface HostedUsageReaderOptions {
  /** The hosted service origin, without a trailing slash. */
  serviceBaseUrl: string;
  readAccessToken: () => Effect.Effect<string | undefined, unknown, Http>;
  refreshAccount: () => Effect.Effect<void, unknown, unknown>;
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
  readonly #readAccessToken: () => Effect.Effect<string | undefined, unknown, Http>;
  readonly #refreshAccount: () => Effect.Effect<void, unknown, unknown>;
  readonly #requestTimeoutMs: number;

  constructor(options: HostedUsageReaderOptions) {
    const baseUrl = text(options.serviceBaseUrl);
    if (!baseUrl) throw new Error("Hosted service base URL must not be empty");
    this.#endpoint = `${withoutTrailingSlash(baseUrl)}${HOSTED_SERVICE_PATH.USAGE}`;
    this.#readAccessToken = options.readAccessToken;
    this.#refreshAccount = options.refreshAccount;
    this.#requestTimeoutMs = positiveInteger(
      options.requestTimeoutMs,
      HOSTED_DEFAULTS.REQUEST_TIMEOUT_MS,
    );
  }

  read(): Effect.Effect<HostedUsageAnswer | undefined, unknown, Http> {
    return Effect.gen(this, function* () {
      const token = yield* this.#readAccessToken() as Effect.Effect<
        string | undefined,
        never,
        Http
      >;
      if (!token) return undefined;

      let response = yield* this.#request(token);
      if (response?.status === UNAUTHORIZED_STATUS) {
        yield* (this.#refreshAccount() as Effect.Effect<void, never, Http>).pipe(
          Effect.catchAll(() => Effect.void),
        );
        const refreshed = yield* this.#readAccessToken() as Effect.Effect<
          string | undefined,
          never,
          Http
        >;
        if (refreshed && refreshed !== token) {
          response = yield* this.#request(refreshed);
        }
      }
      if (!response?.ok) return undefined;

      const http = yield* Http;
      const payload = yield* http
        .readJson(response)
        .pipe(Effect.catchAll(() => Effect.succeed(undefined)));
      return payload === undefined
        ? undefined
        : hostedUsageAnswerFromWire(
            unparsedWire(payload as import("./wire-boundary").WireBoundaryInput),
          );
    });
  }

  #request(token: string): Effect.Effect<Response | undefined, never, Http> {
    return Effect.gen(this, function* () {
      const http = yield* Http;
      return yield* http
        .request(this.#endpoint, {
          method: "GET",
          headers: { authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(this.#requestTimeoutMs),
        })
        .pipe(Effect.catchAll(() => Effect.succeed(undefined)));
    });
  }
}
