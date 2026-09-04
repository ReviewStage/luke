import {
  HOSTED_SERVICE_PATH,
  type HostedDigestRequest,
  hostedDigestAnswerFromWire,
  hostedQuotaFromWire,
} from "@sidecar/hosted";
import {
  positiveInteger,
  text,
  type UnparsedWireValue,
  unparsedWire,
  wireRecord,
} from "@sidecar/wire";
import {
  BRAIN_CLIENT_OUTCOME,
  BRAIN_OPENAI_DEFAULTS,
  BRAIN_RATE_LIMIT_COOLDOWN_MS,
  type FetchLike,
  OPENAI_ENVIRONMENT,
  RATE_LIMIT_STATUS,
  RETRY_AFTER_HEADER,
  UNAUTHORIZED_STATUS,
  withoutTrailingSlash,
} from "./brain-client.js";
import { type BrainSessionDigest, type DigestInput, digestFromModel } from "./brain-digest.js";
import { digestFromResponsesPayload, digestResponsesRequest } from "./brain-digest-openai.js";
import {
  BRAIN_REASONING_EFFORT,
  BRAIN_RESPONSES_PATH,
  type BrainReasoningEffort,
} from "./brain-openai.js";

/**
 * How a transcript slice reaches the summarizer: directly, on the developer's
 * own key, or through Luke's hosted service on the signed-in account — the
 * same two paths a brain turn takes. Either client answers a digest the
 * schema reader already accepted, or says why not, and the agent falls back
 * to the deterministic digest on anything but an answer.
 */

export type DigestClientAnswer =
  | { outcome: typeof BRAIN_CLIENT_OUTCOME.ANSWERED; digest: BrainSessionDigest }
  | { outcome: typeof BRAIN_CLIENT_OUTCOME.QUIET; until: number }
  | { outcome: typeof BRAIN_CLIENT_OUTCOME.FAILED; reason: string };

export interface DigestClient {
  /** The model a digest is written by, when the client knows it; the hosted service's stays its own. */
  readonly model?: string;
  summarize(input: DigestInput): Promise<DigestClientAnswer>;
  /** The moment held-back calls may resume, for the agent to skip the call rather than spend it. */
  quietUntil(): number | undefined;
}

export const DIGEST_OPENAI_DEFAULTS = {
  /** A form from a bounded slice, in the background: the cost-optimized tier. */
  MODEL: "gpt-5.6-luna",
  REASONING_EFFORT: BRAIN_REASONING_EFFORT.LOW,
  /** The one ceiling on the form's fields, which carry no length bound of their own. */
  MAXIMUM_OUTPUT_TOKENS: 2_000,
  /** Matches the agent's digest deadline: an answer past it is discarded anyway. */
  REQUEST_TIMEOUT_MS: 8_000,
} as const;

function failed(reason: string): DigestClientAnswer {
  return { outcome: BRAIN_CLIENT_OUTCOME.FAILED, reason };
}

async function payloadOf(response: Response): Promise<UnparsedWireValue | undefined> {
  try {
    const payload: UnparsedWireValue = await response.json();
    return payload;
  } catch {
    return undefined;
  }
}

export interface OpenAiDigestClientOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  reasoningEffort?: BrainReasoningEffort;
  maximumOutputTokens?: number;
  fetch?: FetchLike;
  now?: () => number;
  requestTimeoutMs?: number;
  report?: (message: string) => void;
}

export type OpenAiDigestOptions = Omit<OpenAiDigestClientOptions, "apiKey">;

/**
 * Writes digests with the OpenAI Responses API on the developer's own key,
 * under the strict digest schema. It never asks the API to retain a request,
 * and a rate limit quiets it the way it quiets the brain, since both share
 * the key.
 */
export class OpenAiDigestClient implements DigestClient {
  readonly model: string;
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #reasoningEffort: BrainReasoningEffort;
  readonly #maximumOutputTokens: number;
  readonly #fetch: FetchLike;
  readonly #now: () => number;
  readonly #requestTimeoutMs: number;
  readonly #report: (message: string) => void;
  #quietUntil = 0;

  constructor(options: OpenAiDigestClientOptions) {
    const apiKey = text(options.apiKey);
    if (!apiKey) throw new Error("OpenAI API key must not be empty");
    this.#apiKey = apiKey;
    this.model = text(options.model) ?? DIGEST_OPENAI_DEFAULTS.MODEL;
    this.#baseUrl = withoutTrailingSlash(text(options.baseUrl) ?? BRAIN_OPENAI_DEFAULTS.BASE_URL);
    this.#reasoningEffort = options.reasoningEffort ?? DIGEST_OPENAI_DEFAULTS.REASONING_EFFORT;
    this.#maximumOutputTokens = positiveInteger(
      options.maximumOutputTokens,
      DIGEST_OPENAI_DEFAULTS.MAXIMUM_OUTPUT_TOKENS,
    );
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.#now = options.now ?? Date.now;
    this.#requestTimeoutMs = positiveInteger(
      options.requestTimeoutMs,
      DIGEST_OPENAI_DEFAULTS.REQUEST_TIMEOUT_MS,
    );
    this.#report = options.report ?? ((message) => process.stderr.write(`${message}\n`));
  }

  quietUntil(): number | undefined {
    return this.#quietUntil > this.#now() ? this.#quietUntil : undefined;
  }

  async summarize(input: DigestInput): Promise<DigestClientAnswer> {
    const quietUntil = this.quietUntil();
    if (quietUntil !== undefined) return { outcome: BRAIN_CLIENT_OUTCOME.QUIET, until: quietUntil };

    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}${BRAIN_RESPONSES_PATH}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.#apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(
          digestResponsesRequest(input, {
            model: this.model,
            maximumOutputTokens: this.#maximumOutputTokens,
            reasoningEffort: this.#reasoningEffort,
          }),
        ),
        signal: AbortSignal.timeout(this.#requestTimeoutMs),
      });
    } catch (error) {
      return failed(
        `request did not complete: ${error instanceof Error ? error.name : "unknown error"}`,
      );
    }

    if (response.status === RATE_LIMIT_STATUS) return this.#quiet(response);
    // Status alone diagnoses credentials or an outage without writing the
    // request, the key, or any transcript to the log.
    if (!response.ok) return failed(`request failed with status ${response.status}`);
    const digest = digestFromResponsesPayload(await payloadOf(response));
    return digest
      ? { outcome: BRAIN_CLIENT_OUTCOME.ANSWERED, digest }
      : failed("response did not satisfy the digest schema");
  }

  #quiet(response: Response): DigestClientAnswer {
    const retryAfterSeconds = Number(response.headers.get(RETRY_AFTER_HEADER));
    const waitMs =
      Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
        ? retryAfterSeconds * 1000
        : BRAIN_RATE_LIMIT_COOLDOWN_MS;
    this.#quietUntil = this.#now() + waitMs;
    this.#report(`OpenAI digests are rate limited; pausing for ${Math.round(waitMs / 1000)}s`);
    return { outcome: BRAIN_CLIENT_OUTCOME.QUIET, until: this.#quietUntil };
  }
}

/** Builds a keyed client only when there is a key to build one from, like the brain's. */
export function openAiDigestClient(
  apiKey: string | undefined,
  options: OpenAiDigestOptions = {},
): OpenAiDigestClient | undefined {
  const resolved = text(apiKey);
  if (!resolved) return undefined;
  const model = text(options.model) ?? text(process.env[OPENAI_ENVIRONMENT.DIGEST_MODEL]);
  const baseUrl = text(options.baseUrl) ?? text(process.env[OPENAI_ENVIRONMENT.BASE_URL]);
  return new OpenAiDigestClient({
    ...options,
    apiKey: resolved,
    ...(model ? { model } : undefined),
    ...(baseUrl ? { baseUrl } : undefined),
  });
}

export interface HostedDigestClientOptions {
  /** The hosted service origin, without a trailing slash. */
  serviceBaseUrl: string;
  readAccessToken: () => Promise<string | undefined>;
  refreshAccount: () => Promise<void>;
  fetch?: FetchLike;
  now?: () => number;
  requestTimeoutMs?: number;
  report?: (message: string) => void;
}

/**
 * Writes digests through Luke's hosted service on the signed-in account, for
 * a developer with no OpenAI key of their own. What leaves the machine is the
 * same bounded input the keyed client sends; the service holds the
 * instructions, schema, and model fixed by its own build. The answer is read
 * through the same schema reader the keyed path uses, so a service that
 * answered off-schema is refused here exactly as the model would be.
 */
export class HostedDigestClient implements DigestClient {
  readonly #endpoint: string;
  readonly #readAccessToken: () => Promise<string | undefined>;
  readonly #refreshAccount: () => Promise<void>;
  readonly #fetch: FetchLike;
  readonly #now: () => number;
  readonly #requestTimeoutMs: number;
  readonly #report: (message: string) => void;
  #quietUntil = 0;

  constructor(options: HostedDigestClientOptions) {
    const baseUrl = text(options.serviceBaseUrl);
    if (!baseUrl) throw new Error("Hosted service base URL must not be empty");
    this.#endpoint = `${withoutTrailingSlash(baseUrl)}${HOSTED_SERVICE_PATH.BRAIN_DIGEST}`;
    this.#readAccessToken = options.readAccessToken;
    this.#refreshAccount = options.refreshAccount;
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.#now = options.now ?? Date.now;
    this.#requestTimeoutMs = positiveInteger(
      options.requestTimeoutMs,
      DIGEST_OPENAI_DEFAULTS.REQUEST_TIMEOUT_MS,
    );
    this.#report = options.report ?? ((message) => process.stderr.write(`${message}\n`));
  }

  quietUntil(): number | undefined {
    return this.#quietUntil > this.#now() ? this.#quietUntil : undefined;
  }

  async summarize(input: DigestInput): Promise<DigestClientAnswer> {
    const quietUntil = this.quietUntil();
    if (quietUntil !== undefined) return { outcome: BRAIN_CLIENT_OUTCOME.QUIET, until: quietUntil };

    const token = await this.#readAccessToken();
    if (!token) return failed("no account token");

    const request: HostedDigestRequest = {
      provider_name: input.providerName,
      ...(input.title ? { title: input.title } : undefined),
      ...(input.status ? { status: input.status } : undefined),
      ...(input.hookEvent ? { hook: input.hookEvent } : undefined),
      truncated: input.truncated,
      transcript: input.transcript,
    };
    let response = await this.#request(token, request);
    if (response?.status === UNAUTHORIZED_STATUS) {
      // Routine expiry of an hour-lived token inside a day-lived app: refresh
      // and retry once, like the hosted brain client.
      await this.#refreshAccount().catch(() => undefined);
      const refreshed = await this.#readAccessToken();
      if (refreshed && refreshed !== token) response = await this.#request(refreshed, request);
    }
    if (!response) return failed("request did not complete");
    if (response.status === RATE_LIMIT_STATUS) return this.#quiet(response);
    if (!response.ok) return failed(`hosted digest failed with status ${response.status}`);
    const answer = hostedDigestAnswerFromWire(await payloadOf(response));
    const digest = answer ? digestFromModel(answer.digest) : undefined;
    return digest
      ? { outcome: BRAIN_CLIENT_OUTCOME.ANSWERED, digest }
      : failed("hosted digest did not satisfy the digest schema");
  }

  async #request(token: string, request: HostedDigestRequest): Promise<Response | undefined> {
    try {
      return await this.#fetch(this.#endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(this.#requestTimeoutMs),
      });
    } catch {
      return undefined;
    }
  }

  async #quiet(response: Response): Promise<DigestClientAnswer> {
    const record = wireRecord(unparsedWire(await payloadOf(response)));
    const quota = record ? hostedQuotaFromWire(unparsedWire(record.quota)) : undefined;
    const resetsAt = quota?.resetsAt;
    this.#quietUntil =
      resetsAt !== undefined && resetsAt > this.#now()
        ? resetsAt
        : this.#now() + BRAIN_RATE_LIMIT_COOLDOWN_MS;
    const waitMs = Math.max(0, this.#quietUntil - this.#now());
    this.#report(
      `Hosted digests are out of today's allowance; pausing for ${Math.round(waitMs / 1000)}s`,
    );
    return { outcome: BRAIN_CLIENT_OUTCOME.QUIET, until: this.#quietUntil };
  }
}
