import type { RealtimeToolWireDefinition } from "@sidecar/acts";
import {
  type CloudFetch,
  positiveInteger,
  text,
  type UnparsedWireValue,
  withoutTrailingSlash,
} from "@sidecar/wire";
import { brainInstructions } from "./brain-instructions.js";
import {
  BRAIN_RESPONSES_PATH,
  brainResponsesRequest,
  type ResponsesInputItem,
} from "./brain-openai.js";

/**
 * How a brain turn reaches a model: directly, on the developer's own key. The
 * client is handed the input array and the tools this turn may call, and
 * answers with the raw Responses payload; it never reads inside the items it
 * carries.
 */

export const BRAIN_CLIENT_OUTCOME = {
  ANSWERED: "answered",
  /** Rate-limited; nothing was sent, and `until` says when to try again. */
  QUIET: "quiet",
  FAILED: "failed",
} as const;

export type BrainClientOutcome = (typeof BRAIN_CLIENT_OUTCOME)[keyof typeof BRAIN_CLIENT_OUTCOME];

export type BrainClientAnswer =
  | { outcome: typeof BRAIN_CLIENT_OUTCOME.ANSWERED; payload: UnparsedWireValue }
  | { outcome: typeof BRAIN_CLIENT_OUTCOME.QUIET; until: number }
  | { outcome: typeof BRAIN_CLIENT_OUTCOME.FAILED; reason: string };

export interface BrainClient {
  /** The model a turn runs on, when the client knows it. */
  readonly model?: string;
  respond(
    input: readonly ResponsesInputItem[],
    tools: readonly RealtimeToolWireDefinition[],
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
  /** A turn may read a transcript, reason over it, and act; the ceiling is for a runaway, not a budget. */
  REQUEST_TIMEOUT_MS: 90_000,
} as const;

/** How long turns stay unsent after a rate limit that names no wait of its own. */
export const BRAIN_RATE_LIMIT_COOLDOWN_MS = 60_000;

const RATE_LIMIT_STATUS = 429;
const RETRY_AFTER_HEADER = "retry-after";

function failed(reason: string): BrainClientAnswer {
  return { outcome: BRAIN_CLIENT_OUTCOME.FAILED, reason };
}

export interface OpenAiBrainClientOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  fetch?: CloudFetch;
  now?: () => number;
  requestTimeoutMs?: number;
  report?: (message: string) => void;
}

/**
 * Runs brain turns against the OpenAI Responses API on the developer's own
 * key. It never asks the API to retain a request, and it answers with the
 * payload alone: reading it is the agent's job.
 */
export class OpenAiBrainClient implements BrainClient {
  readonly model: string;
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #fetch: CloudFetch;
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
    tools: readonly RealtimeToolWireDefinition[],
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
            tools,
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
    try {
      const payload: UnparsedWireValue = await response.json();
      return { outcome: BRAIN_CLIENT_OUTCOME.ANSWERED, payload };
    } catch {
      return failed("response was not JSON");
    }
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
 * next launch. The model and base URL come from the environment when set.
 */
export function openAiBrainClient(apiKey: string | undefined): OpenAiBrainClient | undefined {
  const resolved = text(apiKey);
  if (!resolved) return undefined;
  const model = text(process.env[OPENAI_ENVIRONMENT.MODEL]);
  const baseUrl = text(process.env[OPENAI_ENVIRONMENT.BASE_URL]);
  return new OpenAiBrainClient({
    apiKey: resolved,
    ...(model ? { model } : undefined),
    ...(baseUrl ? { baseUrl } : undefined),
  });
}
