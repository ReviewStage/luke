import { positiveInteger, text, type UnparsedWireValue } from "@sidecar/wire";
import {
  attentionResponsesMissingReason,
  attentionResponsesOutputText,
} from "./attention-openai.js";
import { ATTENTION_RATE_LIMIT_COOLDOWN_MS } from "./openai-evaluator.js";
import {
  type SubjectDerivation,
  type SubjectEvaluator,
  type SubjectInput,
  subjectDerivationFromModel,
} from "./subject.js";
import { SUBJECT_RESPONSES_PATH, subjectResponsesRequest } from "./subject-openai.js";

/* The key is not read here: it is the stored credential the settings store
   resolves, the same one the attention evaluator and the voice run on. */
const OPENAI_ENVIRONMENT = {
  BASE_URL: "OPENAI_BASE_URL",
  MODEL: "LUKE_SUBJECT_MODEL",
} as const;

const OPENAI_DEFAULTS = {
  BASE_URL: "https://api.openai.com/v1",
  // A short phrase from a bounded transcript, in the background on the
  // developer's own key: the cost-optimized tier the attention review uses.
  MODEL: "gpt-5.6-luna",
  REQUEST_TIMEOUT_MS: 20_000,
  MAXIMUM_OUTPUT_TOKENS: 4096,
} as const;

const OPENAI_RATE_LIMIT_STATUS = 429;
const OPENAI_RETRY_AFTER_HEADER = "retry-after";

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface OpenAiSubjectDeriverOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  fetch?: FetchLike;
  now?: () => number;
  requestTimeoutMs?: number;
  maximumOutputTokens?: number;
}

export type OpenAiSubjectOptions = Omit<OpenAiSubjectDeriverOptions, "apiKey">;

function withoutTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function parsedJson(text: string): UnparsedWireValue | undefined {
  try {
    // SAFETY: JSON.parse returns a wire value; callers validate before use.
    return JSON.parse(text) as UnparsedWireValue;
  } catch {
    return undefined;
  }
}

/**
 * Derives subjects with the OpenAI Responses API under the strict subject
 * schema. It sends the bounded input alone, never asks the API to retain the
 * request, and answers nothing when the API is unavailable or replies
 * outside the contract. A rate limit quiets it the way it quiets the
 * attention evaluator, since both share the key the voice opens calls with.
 */
export class OpenAiSubjectDeriver implements SubjectEvaluator {
  readonly #apiKey: string;
  readonly #model: string;
  readonly #baseUrl: string;
  readonly #fetch: FetchLike;
  readonly #now: () => number;
  readonly #requestTimeoutMs: number;
  readonly #maximumOutputTokens: number;
  #quietUntil = 0;

  constructor(options: OpenAiSubjectDeriverOptions) {
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

  quietUntil(): number | undefined {
    return this.#quietUntil > this.#now() ? this.#quietUntil : undefined;
  }

  async derive(input: SubjectInput): Promise<SubjectDerivation | undefined> {
    if (this.#now() < this.#quietUntil) return undefined;
    const response = await this.#request(input);
    if (!response) return undefined;

    if (!response.ok) {
      if (response.status === OPENAI_RATE_LIMIT_STATUS) {
        this.#quiet(response);
        return undefined;
      }
      // Status alone diagnoses the refusal without writing the request, the
      // key, or any transcript to the log.
      this.#report(`OpenAI subject request failed with status ${response.status}`);
      return undefined;
    }

    const payload = await this.#payload(response);
    if (payload === undefined) return undefined;
    const text = attentionResponsesOutputText(payload);
    if (!text) {
      this.#report(
        `OpenAI subject response carried no subject${attentionResponsesMissingReason(payload)}`,
      );
      return undefined;
    }
    const derivation = subjectDerivationFromModel(parsedJson(text));
    if (!derivation) this.#report("OpenAI subject response did not satisfy the subject contract");
    return derivation;
  }

  async #request(input: SubjectInput): Promise<Response | undefined> {
    try {
      return await this.#fetch(`${this.#baseUrl}${SUBJECT_RESPONSES_PATH}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.#apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(
          subjectResponsesRequest(input, {
            model: this.#model,
            maximumOutputTokens: this.#maximumOutputTokens,
          }),
        ),
        signal: AbortSignal.timeout(this.#requestTimeoutMs),
      });
    } catch (error) {
      this.#report(
        `OpenAI subject request did not complete: ${error instanceof Error ? error.name : "unknown error"}`,
      );
      return undefined;
    }
  }

  #quiet(response: Response): void {
    const retryAfterSeconds = Number(response.headers.get(OPENAI_RETRY_AFTER_HEADER));
    const waitMs =
      Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
        ? retryAfterSeconds * 1000
        : ATTENTION_RATE_LIMIT_COOLDOWN_MS;
    this.#quietUntil = this.#now() + waitMs;
    this.#report(
      `OpenAI subject requests are rate limited; pausing derivations for ${Math.round(waitMs / 1000)}s`,
    );
  }

  async #payload(response: Response): Promise<void> {
    try {
      return await response.json();
    } catch {
      this.#report("OpenAI subject response was not JSON");
      return undefined;
    }
  }

  #report(message: string): void {
    process.stderr.write(`${message}\n`);
  }
}

/** Builds a deriver only when there is a key to build one from. */
export function openAiSubjectDeriver(
  apiKey: string | undefined,
  options: OpenAiSubjectOptions = {},
): OpenAiSubjectDeriver | undefined {
  const resolved = text(apiKey);
  if (!resolved) return undefined;
  const model = text(options.model) ?? text(process.env[OPENAI_ENVIRONMENT.MODEL]);
  const baseUrl = text(options.baseUrl) ?? text(process.env[OPENAI_ENVIRONMENT.BASE_URL]);
  return new OpenAiSubjectDeriver({
    ...options,
    apiKey: resolved,
    ...(model ? { model } : undefined),
    ...(baseUrl ? { baseUrl } : undefined),
  });
}
