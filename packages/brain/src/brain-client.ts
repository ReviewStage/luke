import { HOSTED_SERVICE_PATH, type HostedBrainRequest, hostedQuotaFromWire } from "@sidecar/hosted";
import {
  positiveInteger,
  text,
  type UnparsedWireValue,
  unparsedWire,
  wireRecord,
} from "@sidecar/wire";
import { brainInstructions } from "./brain-instructions.js";
import {
  BRAIN_REASONING_EFFORT,
  BRAIN_RESPONSES_PATH,
  type BrainReasoningEffort,
  brainResponsesRequest,
  type ResponsesInputItem,
} from "./brain-openai.js";
import { brainToolDefinitions } from "./brain-tools.js";

/**
 * How a brain turn reaches a model: directly, on the developer's own key, or
 * through Luke's hosted service on the signed-in account. Either way the
 * client is handed the input array and answers with the raw Responses payload,
 * so the agent never knows which path it ran on, and neither client reads
 * inside the items it carries.
 */

export const BRAIN_CLIENT_OUTCOME = {
  ANSWERED: "answered",
  /** Rate-limited or out of allowance; nothing was sent, and `until` says when to try again. */
  QUIET: "quiet",
  FAILED: "failed",
} as const;

export type BrainClientOutcome = (typeof BRAIN_CLIENT_OUTCOME)[keyof typeof BRAIN_CLIENT_OUTCOME];

export type BrainClientAnswer =
  | { outcome: typeof BRAIN_CLIENT_OUTCOME.ANSWERED; payload: UnparsedWireValue }
  | { outcome: typeof BRAIN_CLIENT_OUTCOME.QUIET; until: number }
  | { outcome: typeof BRAIN_CLIENT_OUTCOME.FAILED; reason: string };

export interface BrainRespondOptions {
  maximumOutputTokens: number;
}

export interface BrainClient {
  /** The model a turn runs on, when the client knows it; the hosted service's stays its own. */
  readonly model?: string;
  respond(
    input: readonly ResponsesInputItem[],
    options: BrainRespondOptions,
  ): Promise<BrainClientAnswer>;
  /** The moment held-back turns may resume, for the agent to ask before spending a turn. */
  quietUntil(): number | undefined;
}

/* The key is not read here: it is the stored credential the settings store
   resolves, which reads `OPENAI_API_KEY` as its own fallback. */
export const OPENAI_ENVIRONMENT = {
  BASE_URL: "OPENAI_BASE_URL",
  MODEL: "LUKE_BRAIN_MODEL",
  DIGEST_MODEL: "LUKE_DIGEST_MODEL",
} as const;

export const BRAIN_OPENAI_DEFAULTS = {
  BASE_URL: "https://api.openai.com/v1",
  MODEL: "gpt-5.6-terra",
  REASONING_EFFORT: BRAIN_REASONING_EFFORT.MEDIUM,
  /** A turn may read a transcript, reason over it, and act; the ceiling is for a runaway, not a budget. */
  REQUEST_TIMEOUT_MS: 90_000,
} as const;

/**
 * How long turns stay unsent after a rate limit that names no wait of its own.
 * Wakes held back during the quiet are not lost: they stay pending and open
 * one turn together once it ends.
 */
export const BRAIN_RATE_LIMIT_COOLDOWN_MS = 60_000;

const RATE_LIMIT_STATUS = 429;
const UNAUTHORIZED_STATUS = 401;
const RETRY_AFTER_HEADER = "retry-after";

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

function withoutTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

/** The failed variant both client answer shapes share, so one helper serves the brain and the digest. */
export interface FailedClientAnswer {
  outcome: typeof BRAIN_CLIENT_OUTCOME.FAILED;
  reason: string;
}

export function failedAnswer(reason: string): FailedClientAnswer {
  return { outcome: BRAIN_CLIENT_OUTCOME.FAILED, reason };
}

async function answered(response: Response): Promise<BrainClientAnswer> {
  try {
    const payload: UnparsedWireValue = await response.json();
    return { outcome: BRAIN_CLIENT_OUTCOME.ANSWERED, payload };
  } catch {
    return failedAnswer("response was not JSON");
  }
}

export const KEYED_RESPONSES_RESULT = {
  RESPONSE: "response",
  FAILED: "failed",
} as const;

export type KeyedResponsesResult =
  | { kind: typeof KEYED_RESPONSES_RESULT.RESPONSE; response: Response }
  | { kind: typeof KEYED_RESPONSES_RESULT.FAILED; reason: string };

export interface KeyedResponsesPost {
  apiKey: string;
  baseUrl: string;
  fetch: FetchLike;
  timeoutMs: number;
  body: unknown;
}

/**
 * The one way a keyed client reaches the Responses API, shared by the brain
 * and the digest so the two send the same headers and give up on the same
 * terms. A request that did not complete names only the error's kind: the
 * request, the key, and any session material stay out of the reason.
 */
export async function postKeyedResponses(post: KeyedResponsesPost): Promise<KeyedResponsesResult> {
  try {
    const response = await post.fetch(`${post.baseUrl}${BRAIN_RESPONSES_PATH}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${post.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(post.body),
      signal: AbortSignal.timeout(post.timeoutMs),
    });
    return { kind: KEYED_RESPONSES_RESULT.RESPONSE, response };
  } catch (error) {
    return {
      kind: KEYED_RESPONSES_RESULT.FAILED,
      reason: `request did not complete: ${error instanceof Error ? error.name : "unknown error"}`,
    };
  }
}

/** Whether a response is the rate limit that quiets a keyed client. */
export function isRateLimited(response: Response): boolean {
  return response.status === RATE_LIMIT_STATUS;
}

/** When a rate-limited keyed client may send again: the retry-after it names, or the fixed cooldown. */
export function rateLimitQuietUntil(response: Response, now: number): number {
  const retryAfterSeconds = Number(response.headers.get(RETRY_AFTER_HEADER));
  const waitMs =
    Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
      ? retryAfterSeconds * 1000
      : BRAIN_RATE_LIMIT_COOLDOWN_MS;
  return now + waitMs;
}

/** A keyed client's base URL: the option when given, else the default, without a trailing slash. */
export function keyedBaseUrl(option: string | undefined): string {
  return withoutTrailingSlash(text(option) ?? BRAIN_OPENAI_DEFAULTS.BASE_URL);
}

/** What a keyed client factory may override from the environment. */
export interface KeyedClientOverrides {
  model?: string;
  baseUrl?: string;
}

/**
 * The environment's overrides for a keyed client factory: the model from the
 * variable the caller names, and the base URL from `OPENAI_BASE_URL`, each
 * only when the option itself is silent.
 */
export function keyedClientOverrides(
  options: KeyedClientOverrides,
  modelVariable: string,
): KeyedClientOverrides {
  const model = text(options.model) ?? text(process.env[modelVariable]);
  const baseUrl = text(options.baseUrl) ?? text(process.env[OPENAI_ENVIRONMENT.BASE_URL]);
  return { ...(model ? { model } : undefined), ...(baseUrl ? { baseUrl } : undefined) };
}

export interface OpenAiBrainClientOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  reasoningEffort?: BrainReasoningEffort;
  fetch?: FetchLike;
  now?: () => number;
  requestTimeoutMs?: number;
  report?: (message: string) => void;
}

export type OpenAiBrainOptions = Omit<OpenAiBrainClientOptions, "apiKey">;

/**
 * Runs brain turns against the OpenAI Responses API on the developer's own
 * key. It never asks the API to retain a request, and it answers with the
 * payload alone: reading it is the agent's job.
 */
export class OpenAiBrainClient implements BrainClient {
  readonly model: string;
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #reasoningEffort: BrainReasoningEffort;
  readonly #fetch: FetchLike;
  readonly #now: () => number;
  readonly #requestTimeoutMs: number;
  readonly #report: (message: string) => void;
  #quietUntil = 0;

  constructor(options: OpenAiBrainClientOptions) {
    const apiKey = text(options.apiKey);
    if (!apiKey) throw new Error("OpenAI API key must not be empty");
    this.#apiKey = apiKey;
    this.model = text(options.model) ?? BRAIN_OPENAI_DEFAULTS.MODEL;
    this.#baseUrl = keyedBaseUrl(options.baseUrl);
    this.#reasoningEffort = options.reasoningEffort ?? BRAIN_OPENAI_DEFAULTS.REASONING_EFFORT;
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.#now = options.now ?? Date.now;
    this.#requestTimeoutMs = positiveInteger(
      options.requestTimeoutMs,
      BRAIN_OPENAI_DEFAULTS.REQUEST_TIMEOUT_MS,
    );
    this.#report = options.report ?? ((message) => process.stderr.write(`${message}\n`));
  }

  quietUntil(): number | undefined {
    return this.#quietUntil > this.#now() ? this.#quietUntil : undefined;
  }

  async respond(
    input: readonly ResponsesInputItem[],
    options: BrainRespondOptions,
  ): Promise<BrainClientAnswer> {
    const quietUntil = this.quietUntil();
    if (quietUntil !== undefined) return { outcome: BRAIN_CLIENT_OUTCOME.QUIET, until: quietUntil };

    const posted = await postKeyedResponses({
      apiKey: this.#apiKey,
      baseUrl: this.#baseUrl,
      fetch: this.#fetch,
      timeoutMs: this.#requestTimeoutMs,
      body: brainResponsesRequest(input, {
        model: this.model,
        instructions: brainInstructions(),
        tools: brainToolDefinitions(),
        maximumOutputTokens: options.maximumOutputTokens,
        reasoningEffort: this.#reasoningEffort,
      }),
    });
    if (posted.kind === KEYED_RESPONSES_RESULT.FAILED) return failedAnswer(posted.reason);
    const { response } = posted;
    if (isRateLimited(response)) return this.#quiet(response);
    // Status alone diagnoses credentials or an outage without writing the
    // request, the key, or any session material to the log.
    if (!response.ok) return failedAnswer(`request failed with status ${response.status}`);
    return answered(response);
  }

  #quiet(response: Response): BrainClientAnswer {
    this.#quietUntil = rateLimitQuietUntil(response, this.#now());
    const waitMs = this.#quietUntil - this.#now();
    this.#report(`OpenAI brain turns are rate limited; pausing for ${Math.round(waitMs / 1000)}s`);
    return { outcome: BRAIN_CLIENT_OUTCOME.QUIET, until: this.#quietUntil };
  }
}

/**
 * Builds a keyed client only when there is a key to build one from, so a key
 * entered later builds one then rather than leaving the brain off until the
 * next launch.
 */
export function openAiBrainClient(
  apiKey: string | undefined,
  options: OpenAiBrainOptions = {},
): OpenAiBrainClient | undefined {
  const resolved = text(apiKey);
  if (!resolved) return undefined;
  return new OpenAiBrainClient({
    ...options,
    apiKey: resolved,
    ...keyedClientOverrides(options, OPENAI_ENVIRONMENT.MODEL),
  });
}

export interface HostedBrainClientOptions {
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
 * Runs brain turns through Luke's hosted service on the signed-in account, for
 * a developer with no OpenAI key of their own. What leaves the machine is the
 * same input array the keyed client sends; the service holds the instructions,
 * tools, and model fixed by its own build. A spent allowance stands the client
 * down until the day's counters reset rather than spending refusals on it.
 */
export class HostedBrainClient implements BrainClient {
  readonly #endpoint: string;
  readonly #readAccessToken: () => Promise<string | undefined>;
  readonly #refreshAccount: () => Promise<void>;
  readonly #fetch: FetchLike;
  readonly #now: () => number;
  readonly #requestTimeoutMs: number;
  readonly #report: (message: string) => void;
  #quietUntil = 0;

  constructor(options: HostedBrainClientOptions) {
    const baseUrl = text(options.serviceBaseUrl);
    if (!baseUrl) throw new Error("Hosted service base URL must not be empty");
    this.#endpoint = `${withoutTrailingSlash(baseUrl)}${HOSTED_SERVICE_PATH.BRAIN_RESPOND}`;
    this.#readAccessToken = options.readAccessToken;
    this.#refreshAccount = options.refreshAccount;
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.#now = options.now ?? Date.now;
    this.#requestTimeoutMs = positiveInteger(
      options.requestTimeoutMs,
      BRAIN_OPENAI_DEFAULTS.REQUEST_TIMEOUT_MS,
    );
    this.#report = options.report ?? ((message) => process.stderr.write(`${message}\n`));
  }

  quietUntil(): number | undefined {
    return this.#quietUntil > this.#now() ? this.#quietUntil : undefined;
  }

  async respond(
    input: readonly ResponsesInputItem[],
    options: BrainRespondOptions,
  ): Promise<BrainClientAnswer> {
    const quietUntil = this.quietUntil();
    if (quietUntil !== undefined) return { outcome: BRAIN_CLIENT_OUTCOME.QUIET, until: quietUntil };

    const token = await this.#readAccessToken();
    if (!token) return failedAnswer("no account token");

    const request: HostedBrainRequest = {
      input,
      max_output_tokens: options.maximumOutputTokens,
    };
    let response = await this.#request(token, request);
    if (response?.status === UNAUTHORIZED_STATUS) {
      // Routine expiry of an hour-lived token inside a day-lived app: refresh
      // and retry once, like the hosted mint.
      await this.#refreshAccount().catch(() => undefined);
      const refreshed = await this.#readAccessToken();
      if (refreshed && refreshed !== token) response = await this.#request(refreshed, request);
    }
    if (!response) return failedAnswer("request did not complete");
    if (isRateLimited(response)) return this.#quiet(response);
    if (!response.ok)
      return failedAnswer(`hosted brain turn failed with status ${response.status}`);
    return answered(response);
  }

  async #request(token: string, request: HostedBrainRequest): Promise<Response | undefined> {
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

  async #quiet(response: Response): Promise<BrainClientAnswer> {
    const payload = await response.json().catch(() => undefined);
    const record = wireRecord(unparsedWire(payload));
    const quota = record ? hostedQuotaFromWire(unparsedWire(record.quota)) : undefined;
    const resetsAt = quota?.resetsAt;
    this.#quietUntil =
      resetsAt !== undefined && resetsAt > this.#now()
        ? resetsAt
        : this.#now() + BRAIN_RATE_LIMIT_COOLDOWN_MS;
    const waitMs = Math.max(0, this.#quietUntil - this.#now());
    this.#report(
      `Hosted brain turns are out of today's allowance; pausing for ${Math.round(waitMs / 1000)}s`,
    );
    return { outcome: BRAIN_CLIENT_OUTCOME.QUIET, until: this.#quietUntil };
  }
}
