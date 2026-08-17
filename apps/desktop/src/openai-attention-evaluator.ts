import {
  ATTENTION_DECISION_SCHEMA,
  ATTENTION_DECISION_SCHEMA_NAME,
  type AttentionDecision,
  type AttentionEvaluator,
  type AttentionUpdate,
  attentionDecisionFromModel,
  attentionInstructions,
  attentionUpdateInput,
  isRecord,
  positiveInteger,
  text,
} from "@sidecar/core";

/* The key is not read here: it is the stored credential the settings store
   resolves, which reads `OPENAI_API_KEY` as its own fallback. */
const OPENAI_ENVIRONMENT = {
  BASE_URL: "OPENAI_BASE_URL",
  MODEL: "LUKE_ATTENTION_MODEL",
} as const;

const OPENAI_DEFAULTS = {
  BASE_URL: "https://api.openai.com/v1",
  // A three-way classification with a fixed prompt, run in the background on a
  // developer's own key. The cost-optimized tier fits it, and its lower latency
  // means fewer decisions are discarded as superseded before they can be used.
  MODEL: "gpt-5.6-luna",
  REQUEST_TIMEOUT_MS: 15_000,
  // The decision itself is a few dozen tokens; this cap only bounds a runaway
  // response. It is set well above that because reasoning tokens are charged
  // against the same budget, and a model that exhausts it returns `incomplete`
  // with no output at all — indistinguishable from having nothing to say.
  MAXIMUM_OUTPUT_TOKENS: 4096,
} as const;

const OPENAI_RESPONSES_PATH = "/responses";
const OPENAI_TEXT_FORMAT_TYPE = "json_schema";
const OPENAI_OUTPUT_TEXT_TYPE = "output_text";
const OPENAI_RATE_LIMIT_STATUS = 429;
const OPENAI_RETRY_AFTER_HEADER = "retry-after";

/**
 * How long attention requests stay quiet after the API rate-limits one, when
 * the refusal names no wait of its own. Reviews run four to a pass and a pass
 * every few seconds, so without this one 429 becomes a sustained storm: every
 * failed review stays derivable and is re-sent at full rate, which starves
 * the same key the voice opens calls with — the announcement that cannot get
 * through is the visible half of that. An update held back here is not lost;
 * it stays derivable and is reviewed once the quiet ends.
 */
export const ATTENTION_RATE_LIMIT_COOLDOWN_MS = 60_000;

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface OpenAiAttentionEvaluatorOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  fetch?: FetchLike;
  now?: () => number;
  requestTimeoutMs?: number;
  maximumOutputTokens?: number;
}

export type OpenAiAttentionOptions = Omit<OpenAiAttentionEvaluatorOptions, "apiKey">;

function withoutTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function outputTextFromContent(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((entry) =>
      isRecord(entry) && entry.type === OPENAI_OUTPUT_TEXT_TYPE && typeof entry.text === "string"
        ? entry.text
        : "",
    )
    .join("");
}

/**
 * Reads the structured decision out of a Responses payload without depending on
 * where a given API version places it.
 */
function outputText(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  if (typeof payload.output_text === "string") return text(payload.output_text);
  if (!Array.isArray(payload.output)) return undefined;
  return text(
    payload.output
      .map((item) => (isRecord(item) ? outputTextFromContent(item.content) : ""))
      .join(""),
  );
}

/**
 * Describes why a payload carried no decision. A model that spends its output
 * budget on reasoning returns `incomplete` with empty output, which would
 * otherwise look identical to a healthy silent pass.
 */
function missingDecisionReason(payload: unknown): string {
  if (!isRecord(payload)) return "";
  const status = typeof payload.status === "string" ? payload.status : undefined;
  const details = isRecord(payload.incomplete_details) ? payload.incomplete_details : undefined;
  const reason = typeof details?.reason === "string" ? details.reason : undefined;
  if (status && reason) return ` (${status}: ${reason})`;
  if (status) return ` (${status})`;
  return "";
}

function parsedJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * Evaluates bounded session updates with the OpenAI Responses API using the
 * shared decision contract as a strict structured-output schema. It sends only
 * the redacted update, never asks the API to retain the request, and answers
 * with nothing when the API is unavailable or replies outside the contract.
 */
export class OpenAiAttentionEvaluator implements AttentionEvaluator {
  readonly #apiKey: string;
  readonly #model: string;
  readonly #baseUrl: string;
  readonly #fetch: FetchLike;
  readonly #now: () => number;
  readonly #requestTimeoutMs: number;
  readonly #maximumOutputTokens: number;
  /** Until when rate-limited requests stay unsent, as epoch milliseconds. */
  #quietUntil = 0;

  constructor(options: OpenAiAttentionEvaluatorOptions) {
    const apiKey = text(options.apiKey);
    if (!apiKey) throw new Error("OpenAI API key must not be empty");
    this.#apiKey = apiKey;
    this.#model = text(options.model) ?? OPENAI_DEFAULTS.MODEL;
    this.#baseUrl = withoutTrailingSlash(text(options.baseUrl) ?? OPENAI_DEFAULTS.BASE_URL);
    this.#fetch = options.fetch ?? ((input, init) => fetch(input, init));
    this.#now = options.now ?? Date.now;
    this.#requestTimeoutMs = positiveInteger(
      options.requestTimeoutMs,
      OPENAI_DEFAULTS.REQUEST_TIMEOUT_MS,
    );
    this.#maximumOutputTokens = positiveInteger(
      options.maximumOutputTokens,
      OPENAI_DEFAULTS.MAXIMUM_OUTPUT_TOKENS,
    );
  }

  get model(): string {
    return this.#model;
  }

  async evaluate(update: AttentionUpdate): Promise<AttentionDecision | undefined> {
    // Answering with nothing is how an evaluator stays silent, and staying
    // silent is free: the update stays derivable and returns once the API is
    // taking requests again.
    if (this.#now() < this.#quietUntil) return undefined;
    const response = await this.#request(update);
    if (!response) return undefined;

    if (!response.ok) {
      if (response.status === OPENAI_RATE_LIMIT_STATUS) {
        this.#quiet(response);
        return undefined;
      }
      // Status alone is enough to diagnose credentials or rate limits without
      // writing the request, the key, or any session material to the log.
      this.#report(`OpenAI attention request failed with status ${response.status}`);
      return undefined;
    }

    const payload = await this.#payload(response);
    if (payload === undefined) return undefined;

    const text = outputText(payload);
    if (!text) {
      this.#report(
        `OpenAI attention response carried no decision${missingDecisionReason(payload)}`,
      );
      return undefined;
    }

    const decision = attentionDecisionFromModel(parsedJson(text), this.#now());
    if (!decision) this.#report("OpenAI attention response did not satisfy the decision contract");
    return decision;
  }

  async #request(update: AttentionUpdate): Promise<Response | undefined> {
    try {
      return await this.#fetch(`${this.#baseUrl}${OPENAI_RESPONSES_PATH}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.#apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.#model,
          instructions: attentionInstructions(),
          input: attentionUpdateInput(update),
          max_output_tokens: this.#maximumOutputTokens,
          store: false,
          text: {
            format: {
              type: OPENAI_TEXT_FORMAT_TYPE,
              name: ATTENTION_DECISION_SCHEMA_NAME,
              schema: ATTENTION_DECISION_SCHEMA,
              strict: true,
            },
          },
        }),
        signal: AbortSignal.timeout(this.#requestTimeoutMs),
      });
    } catch (error) {
      this.#report(
        `OpenAI attention request did not complete: ${error instanceof Error ? error.name : "unknown error"}`,
      );
      return undefined;
    }
  }

  /**
   * Starts the quiet a rate limit asked for, taking the API's own word for
   * how long when it gives one. Reported once, at the moment the quiet
   * begins: the requests held back during it are not failures to log.
   */
  #quiet(response: Response): void {
    const retryAfterSeconds = Number(response.headers.get(OPENAI_RETRY_AFTER_HEADER));
    const waitMs =
      Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
        ? retryAfterSeconds * 1000
        : ATTENTION_RATE_LIMIT_COOLDOWN_MS;
    this.#quietUntil = this.#now() + waitMs;
    this.#report(
      `OpenAI attention requests are rate limited; pausing reviews for ${Math.round(waitMs / 1000)}s`,
    );
  }

  async #payload(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      this.#report("OpenAI attention response was not JSON");
      return undefined;
    }
  }

  #report(message: string): void {
    process.stderr.write(`${message}\n`);
  }
}

/**
 * Builds an evaluator only when there is a key to build one from, and a key
 * entered later builds one then rather than leaving review off until the next
 * launch. It is the same stored key the spoken conversation runs on, so one key
 * means one thing wherever it was entered.
 */
export function openAiAttentionEvaluator(
  apiKey: string | undefined,
  options: OpenAiAttentionOptions = {},
): OpenAiAttentionEvaluator | undefined {
  const resolved = text(apiKey);
  if (!resolved) return undefined;

  const model = text(options.model) ?? text(process.env[OPENAI_ENVIRONMENT.MODEL]);
  const baseUrl = text(options.baseUrl) ?? text(process.env[OPENAI_ENVIRONMENT.BASE_URL]);

  return new OpenAiAttentionEvaluator({
    ...options,
    apiKey: resolved,
    ...(model ? { model } : {}),
    ...(baseUrl ? { baseUrl } : {}),
  });
}
