import {
  type AttentionDecision,
  type AttentionEvaluator,
  type AttentionUpdate,
  positiveInteger,
  text,
} from "@sidecar/core";
import {
  AttentionReviewClient,
  type AttentionReviewFailure,
  AttentionReviewLive,
  evaluateAttentionUpdate,
} from "@sidecar/core/effect";
import { Cause, Effect, Exit, type Layer, pipe } from "effect";

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

/**
 * Evaluates bounded session updates with the OpenAI Responses API using the
 * shared decision contract as a strict structured-output schema. It sends only
 * the redacted update, never asks the API to retain the request, and answers
 * with nothing when the API is unavailable or replies outside the contract.
 */
export class OpenAiAttentionEvaluator implements AttentionEvaluator {
  readonly #layer: Layer.Layer<AttentionReviewClient>;
  readonly #now: () => number;
  readonly #model: string;

  constructor(options: OpenAiAttentionEvaluatorOptions) {
    const apiKey = text(options.apiKey);
    if (!apiKey) throw new Error("OpenAI API key must not be empty");
    this.#now = options.now ?? Date.now;
    this.#model = text(options.model) ?? OPENAI_DEFAULTS.MODEL;
    const baseUrl = withoutTrailingSlash(text(options.baseUrl) ?? OPENAI_DEFAULTS.BASE_URL);
    const requestTimeoutMs = positiveInteger(
      options.requestTimeoutMs,
      OPENAI_DEFAULTS.REQUEST_TIMEOUT_MS,
    );
    const maximumOutputTokens = positiveInteger(
      options.maximumOutputTokens,
      OPENAI_DEFAULTS.MAXIMUM_OUTPUT_TOKENS,
    );
    this.#layer = AttentionReviewLive({
      apiKey,
      model: this.#model,
      baseUrl,
      fetch: options.fetch,
      now: this.#now,
      requestTimeoutMs,
      maximumOutputTokens,
      rateLimitCooldownMs: ATTENTION_RATE_LIMIT_COOLDOWN_MS,
    });
  }

  get model(): string {
    return this.#model;
  }

  /**
   * The moment rate-limited requests resume, for the reviewer to ask before a
   * pass. A reviewer that asks skips the pass without spending anything; the
   * guard inside {@link evaluate} still answers a caller that did not.
   */
  quietUntil(): number | undefined {
    return Effect.runSync(
      pipe(
        Effect.gen(function* () {
          const client = yield* AttentionReviewClient;
          return client.quietUntil();
        }),
        Effect.provide(this.#layer),
      ),
    );
  }

  async evaluate(update: AttentionUpdate): Promise<AttentionDecision | undefined> {
    const exit = await Effect.runPromiseExit(
      pipe(evaluateAttentionUpdate(update), Effect.provide(this.#layer)),
    );
    if (Exit.isFailure(exit)) {
      const failure = Cause.failureOption(exit.cause);
      if (failure._tag === "Some") this.#reportFailure(failure.value);
      return undefined;
    }
    return exit.value;
  }

  #reportFailure(failure: AttentionReviewFailure): void {
    switch (failure._tag) {
      case "AttentionReviewRateLimited": {
        const waitMs = Math.max(0, failure.quietUntil - this.#now());
        this.#report(
          `OpenAI attention requests are rate limited; pausing reviews for ${Math.round(waitMs / 1000)}s`,
        );
        return;
      }
      case "AttentionReviewHttpFailure":
      case "AttentionReviewNetworkFailure":
      case "AttentionReviewInvalidResponse":
      case "AttentionReviewContractViolation":
        this.#report(failure.message);
        return;
      default: {
        failure satisfies never;
      }
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
    ...(model ? { model } : undefined),
    ...(baseUrl ? { baseUrl } : undefined),
  });
}
