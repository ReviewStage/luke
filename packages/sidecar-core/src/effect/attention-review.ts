import { Context, Data, Effect, Exit, Layer } from "effect";
import type {
  AttentionEvaluator,
  AttentionReview,
  AttentionUpdate,
  SessionAttentionReviewerOptions,
} from "../attention.js";
import { SessionAttentionReviewer } from "../attention.js";
import {
  type AttentionReviewFetch,
  OPENAI_ATTENTION_REVIEW_OUTCOME,
  type OpenAiAttentionReviewConfig,
  type OpenAiAttentionReviewResult,
  openAiAttentionReviewDecision,
} from "../attention-openai.js";
import type { AttentionDecision, NormalizedSession } from "../session.js";
import { fromPromise } from "./runtime-bridge.js";

export class AttentionReviewNetworkFailure extends Data.TaggedError(
  "AttentionReviewNetworkFailure",
)<{
  readonly message: string;
}> {}

export class AttentionReviewHttpFailure extends Data.TaggedError("AttentionReviewHttpFailure")<{
  readonly status: number;
  readonly message: string;
}> {}

export class AttentionReviewRateLimited extends Data.TaggedError("AttentionReviewRateLimited")<{
  readonly quietUntil: number;
}> {}

export class AttentionReviewInvalidResponse extends Data.TaggedError(
  "AttentionReviewInvalidResponse",
)<{
  readonly message: string;
}> {}

export class AttentionReviewContractViolation extends Data.TaggedError(
  "AttentionReviewContractViolation",
)<{
  readonly message: string;
}> {}

export type AttentionReviewFailure =
  | AttentionReviewNetworkFailure
  | AttentionReviewHttpFailure
  | AttentionReviewRateLimited
  | AttentionReviewInvalidResponse
  | AttentionReviewContractViolation;

export interface AttentionReviewClientService {
  readonly quietUntil: () => number | undefined;
  readonly evaluate: (
    update: AttentionUpdate,
  ) => Effect.Effect<AttentionDecision | undefined, AttentionReviewFailure>;
}

export class AttentionReviewClient extends Context.Tag("AttentionReviewClient")<
  AttentionReviewClient,
  AttentionReviewClientService
>() {}

function mapOpenAiReviewResult(
  result: OpenAiAttentionReviewResult,
  now: () => number,
  onRateLimited: (quietUntil: number) => void,
): Effect.Effect<AttentionDecision | undefined, AttentionReviewFailure> {
  switch (result.outcome) {
    case OPENAI_ATTENTION_REVIEW_OUTCOME.DECIDED:
      return Effect.succeed(result.decision);
    case OPENAI_ATTENTION_REVIEW_OUTCOME.RATE_LIMITED: {
      const waitMs = result.retryAfterMs ?? 0;
      const quietUntil = now() + waitMs;
      onRateLimited(quietUntil);
      return Effect.fail(new AttentionReviewRateLimited({ quietUntil }));
    }
    case OPENAI_ATTENTION_REVIEW_OUTCOME.HTTP_ERROR:
      return Effect.fail(
        new AttentionReviewHttpFailure({
          status: result.httpStatus ?? 0,
          message: result.message ?? "OpenAI attention request failed",
        }),
      );
    case OPENAI_ATTENTION_REVIEW_OUTCOME.NETWORK_ERROR:
      return Effect.fail(
        new AttentionReviewNetworkFailure({
          message: result.message ?? "OpenAI attention request did not complete",
        }),
      );
    case OPENAI_ATTENTION_REVIEW_OUTCOME.INVALID_RESPONSE:
      return Effect.fail(
        new AttentionReviewInvalidResponse({
          message: result.message ?? "OpenAI attention response was invalid",
        }),
      );
    case OPENAI_ATTENTION_REVIEW_OUTCOME.CONTRACT_VIOLATION:
      return Effect.fail(
        new AttentionReviewContractViolation({
          message: result.message ?? "OpenAI attention response broke the decision contract",
        }),
      );
    default: {
      const _exhaustive: never = result.outcome;
      return Effect.fail(
        new AttentionReviewInvalidResponse({
          message: `Unexpected OpenAI attention review outcome: ${String(_exhaustive)}`,
        }),
      );
    }
  }
}

export type AttentionReviewLiveOptions = Omit<OpenAiAttentionReviewConfig, "fetch"> & {
  fetch?: AttentionReviewFetch;
};

/** Default Layer for the OpenAI Responses attention review path. */
export function AttentionReviewLive(
  options: AttentionReviewLiveOptions,
): Layer.Layer<AttentionReviewClient> {
  let quietUntil = 0;
  const now = options.now;
  const fetchImpl: AttentionReviewFetch =
    options.fetch ?? ((input: string, init: RequestInit) => fetch(input, init));
  const config: OpenAiAttentionReviewConfig = {
    ...options,
    fetch: fetchImpl,
  };

  const service: AttentionReviewClientService = {
    quietUntil: () => (quietUntil > now() ? quietUntil : undefined),
    evaluate: (update) =>
      Effect.gen(function* () {
        if (now() < quietUntil) return undefined;
        const result = yield* Effect.tryPromise({
          try: () => openAiAttentionReviewDecision(update, config),
          catch: (cause) =>
            new AttentionReviewNetworkFailure({
              message: cause instanceof Error ? cause.message : "network error",
            }),
        });
        return yield* mapOpenAiReviewResult(result, now, (nextQuietUntil) => {
          quietUntil = nextQuietUntil;
        });
      }),
  };

  return Layer.succeed(AttentionReviewClient, service);
}

export function attentionReviewClientLayer(
  service: AttentionReviewClientService,
): Layer.Layer<AttentionReviewClient> {
  return Layer.succeed(AttentionReviewClient, service);
}

/** Reviews one bounded update through the injected client. */
export function evaluateAttentionUpdate(
  update: AttentionUpdate,
): Effect.Effect<AttentionDecision | undefined, AttentionReviewFailure, AttentionReviewClient> {
  return Effect.gen(function* () {
    const client = yield* AttentionReviewClient;
    return yield* client.evaluate(update);
  });
}

export type EffectSessionAttentionReviewerOptions = Omit<
  SessionAttentionReviewerOptions,
  "evaluator"
>;

function evaluatorFromClient(client: AttentionReviewClientService): AttentionEvaluator {
  return {
    quietUntil: () => client.quietUntil(),
    evaluate: async (update) => {
      const exit = await Effect.runPromiseExit(
        evaluateAttentionUpdate(update).pipe(Effect.provideService(AttentionReviewClient, client)),
      );
      if (Exit.isFailure(exit)) return undefined;
      return exit.value;
    },
  };
}

export interface EffectAttentionReviewer {
  readonly review: (
    sessions: readonly NormalizedSession[],
  ) => Effect.Effect<readonly AttentionReview[], never>;
}

/** Builds a stateful reviewer that remembers baselines across passes. */
export function makeEffectAttentionReviewer(
  options: EffectSessionAttentionReviewerOptions,
): Effect.Effect<EffectAttentionReviewer, never, AttentionReviewClient> {
  return Effect.gen(function* () {
    const client = yield* AttentionReviewClient;
    const reviewer = new SessionAttentionReviewer({
      ...options,
      evaluator: evaluatorFromClient(client),
    });
    return {
      review: (sessions) => Effect.promise(() => reviewer.review(sessions)),
    };
  });
}

/**
 * Effect entry point for the session attention review pipeline. Failures from
 * the model call become unavailable reviews, matching the Promise reviewer.
 *
 * Each call uses a fresh reviewer with no remembered baselines; prefer
 * {@link makeEffectAttentionReviewer} when reviews run across observation passes.
 */
export function reviewAttentionUpdates(
  sessions: readonly NormalizedSession[],
  options: EffectSessionAttentionReviewerOptions,
): Effect.Effect<readonly AttentionReview[], never, AttentionReviewClient> {
  return Effect.gen(function* () {
    const client = yield* AttentionReviewClient;
    const reviewer = new SessionAttentionReviewer({
      ...options,
      evaluator: evaluatorFromClient(client),
    });
    return yield* Effect.promise(() => reviewer.review(sessions));
  });
}

/** Wraps an existing Promise-based {@link AttentionEvaluator} as a client Layer. */
export function fromPromiseAttentionReview(
  evaluator: AttentionEvaluator,
): Layer.Layer<AttentionReviewClient> {
  const service: AttentionReviewClientService = {
    quietUntil: () => evaluator.quietUntil?.(),
    evaluate: (update) =>
      fromPromise(() => evaluator.evaluate(update)).pipe(
        Effect.catchAll(() => Effect.succeed(undefined)),
      ),
  };
  return Layer.succeed(AttentionReviewClient, service);
}
