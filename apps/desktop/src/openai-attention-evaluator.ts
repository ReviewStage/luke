import {
  ATTENTION_DECISION_SCHEMA,
  ATTENTION_DECISION_SCHEMA_NAME,
  type AttentionDecision,
  type AttentionEvaluator,
  type AttentionUpdate,
  attentionDecisionFromModel,
  attentionInstructions,
  attentionUpdateInput,
} from "@sidecar/core";

const OPENAI_ENVIRONMENT = {
  API_KEY: "OPENAI_API_KEY",
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
  MAXIMUM_OUTPUT_TOKENS: 1024,
} as const;

const OPENAI_RESPONSES_PATH = "/responses";
const OPENAI_TEXT_FORMAT_TYPE = "json_schema";
const OPENAI_OUTPUT_TEXT_TYPE = "output_text";

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

export type OpenAiAttentionEnvironmentOptions = Omit<OpenAiAttentionEvaluatorOptions, "apiKey">;

function positiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

function trimmedText(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function withoutTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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
  if (typeof payload.output_text === "string") return trimmedText(payload.output_text);
  if (!Array.isArray(payload.output)) return undefined;
  const text = payload.output
    .map((item) => (isRecord(item) ? outputTextFromContent(item.content) : ""))
    .join("");
  return trimmedText(text);
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

  constructor(options: OpenAiAttentionEvaluatorOptions) {
    const apiKey = trimmedText(options.apiKey);
    if (!apiKey) throw new Error("OpenAI API key must not be empty");
    this.#apiKey = apiKey;
    this.#model = trimmedText(options.model) ?? OPENAI_DEFAULTS.MODEL;
    this.#baseUrl = withoutTrailingSlash(trimmedText(options.baseUrl) ?? OPENAI_DEFAULTS.BASE_URL);
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
    const response = await this.#request(update);
    if (!response) return undefined;

    if (!response.ok) {
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
 * Builds an evaluator only when an API key is configured. Luke observes
 * sessions and stays silent without one, so no part of the app requires
 * credentials.
 */
export function openAiAttentionEvaluatorFromEnvironment(
  options: OpenAiAttentionEnvironmentOptions = {},
): OpenAiAttentionEvaluator | undefined {
  const apiKey = trimmedText(process.env[OPENAI_ENVIRONMENT.API_KEY]);
  if (!apiKey) return undefined;

  const model = trimmedText(options.model) ?? trimmedText(process.env[OPENAI_ENVIRONMENT.MODEL]);
  const baseUrl =
    trimmedText(options.baseUrl) ?? trimmedText(process.env[OPENAI_ENVIRONMENT.BASE_URL]);

  return new OpenAiAttentionEvaluator({
    ...options,
    apiKey,
    ...(model ? { model } : {}),
    ...(baseUrl ? { baseUrl } : {}),
  });
}
