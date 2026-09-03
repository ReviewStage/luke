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
const OPENAI_ENVIRONMENT = {
  BASE_URL: "OPENAI_BASE_URL",
  MODEL: "LUKE_BRAIN_MODEL",
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

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

function withoutTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function failed(reason: string): BrainClientAnswer {
  return { outcome: BRAIN_CLIENT_OUTCOME.FAILED, reason };
}

async function answered(response: Response): Promise<BrainClientAnswer> {
  try {
    const payload: UnparsedWireValue = await response.json();
    return { outcome: BRAIN_CLIENT_OUTCOME.ANSWERED, payload };
  } catch {
    return failed("response was not JSON");
  }
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
    this.#baseUrl = withoutTrailingSlash(text(options.baseUrl) ?? BRAIN_OPENAI_DEFAULTS.BASE_URL);
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

    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}${BRAIN_RESPONSES_PATH}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.#apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(
          brainResponsesRequest(input, {
            model: this.model,
            instructions: brainInstructions(),
            tools: brainToolDefinitions(),
            maximumOutputTokens: options.maximumOutputTokens,
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
    // request, the key, or any session material to the log.
    if (!response.ok) return failed(`request failed with status ${response.status}`);
    return answered(response);
  }

  #quiet(response: Response): BrainClientAnswer {
    const retryAfterSeconds = Number(response.headers.get(RETRY_AFTER_HEADER));
    const waitMs =
      Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
        ? retryAfterSeconds * 1000
        : BRAIN_RATE_LIMIT_COOLDOWN_MS;
    this.#quietUntil = this.#now() + waitMs;
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
  const model = text(options.model) ?? text(process.env[OPENAI_ENVIRONMENT.MODEL]);
  const baseUrl = text(options.baseUrl) ?? text(process.env[OPENAI_ENVIRONMENT.BASE_URL]);
  return new OpenAiBrainClient({
    ...options,
    apiKey: resolved,
    ...(model ? { model } : undefined),
    ...(baseUrl ? { baseUrl } : undefined),
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
    if (!token) return failed("no account token");

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
    if (!response) return failed("request did not complete");
    if (response.status === RATE_LIMIT_STATUS) return this.#quiet(response);
    if (!response.ok) return failed(`hosted brain turn failed with status ${response.status}`);
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
