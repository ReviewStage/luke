import assert from "node:assert/strict";
import test from "node:test";
import { Cause, Effect, Exit } from "effect";
import {
  ATTENTION_REVIEW_OUTCOME,
  ATTENTION_TRIGGER,
  type AttentionUpdate,
} from "../../src/attention.js";
import {
  ATTENTION_RESPONSES_PATH,
  OPENAI_ATTENTION_REVIEW_OUTCOME,
  openAiAttentionReviewDecision,
} from "../../src/attention-openai.js";
import {
  AttentionReviewContractViolation,
  AttentionReviewHttpFailure,
  AttentionReviewLive,
  AttentionReviewNetworkFailure,
  AttentionReviewRateLimited,
  attentionReviewClientLayer,
  evaluateAttentionUpdate,
  fromPromiseAttentionReview,
  makeEffectAttentionReviewer,
  reviewAttentionUpdates,
} from "../../src/effect/attention-review.js";
import {
  ATTENTION_DISPOSITION,
  type AttentionDecision,
  type NormalizedSession,
  normalizeSession,
  type ProviderSessionObservation,
  SESSION_STATUS,
} from "../../src/session.js";

const claude = { id: "claude-code", displayName: "Claude Code" };
const DECIDED_AT = 1_800_000_000_000;
const API_KEY = "test-key";
const SPOKEN_SUMMARY = "Claude Code is waiting on you in checkout-service.";

function session(
  providerSessionId: string,
  overrides: Partial<ProviderSessionObservation> = {},
): NormalizedSession {
  const observation: ProviderSessionObservation = {
    providerSessionId,
    title: "Claude Code: checkout-service",
    status: SESSION_STATUS.WORKING,
    observedAt: DECIDED_AT,
    ...overrides,
  };
  return normalizeSession(claude, observation);
}

function speakDecision(summary = SPOKEN_SUMMARY): AttentionDecision {
  return {
    disposition: ATTENTION_DISPOSITION.SPEAK_DURING_TURN,
    decidedAt: DECIDED_AT,
    summary,
  };
}

function sampleUpdate(): AttentionUpdate {
  return {
    providerId: claude.id,
    providerSessionId: "review",
    trigger: ATTENTION_TRIGGER.OBSERVED,
    providerName: claude.displayName,
    title: "Claude Code: checkout-service",
    status: SESSION_STATUS.WORKING,
    observedAt: DECIDED_AT,
  };
}

test("evaluateAttentionUpdate returns a decision from a fake client layer", async () => {
  const layer = attentionReviewClientLayer({
    quietUntil: () => undefined,
    evaluate: () => Effect.succeed(speakDecision()),
  });
  const decision = await Effect.runPromise(
    evaluateAttentionUpdate(sampleUpdate()).pipe(Effect.provide(layer)),
  );
  assert.deepEqual(decision, speakDecision());
});

test("evaluateAttentionUpdate surfaces tagged failures from the client", async () => {
  const layer = attentionReviewClientLayer({
    quietUntil: () => undefined,
    evaluate: () =>
      Effect.fail(
        new AttentionReviewHttpFailure({
          status: 503,
          message: "upstream unavailable",
        }),
      ),
  });
  const exit = await Effect.runPromiseExit(
    evaluateAttentionUpdate(sampleUpdate()).pipe(Effect.provide(layer)),
  );
  assert.equal(Exit.isFailure(exit), true);
  if (Exit.isFailure(exit)) {
    const failure = Cause.failureOption(exit.cause);
    assert.equal(failure._tag, "Some");
    if (failure._tag === "Some") {
      assert.equal(failure.value._tag, "AttentionReviewHttpFailure");
    }
  }
});

test("makeEffectAttentionReviewer reviews only changed sessions across passes", async () => {
  const updates: AttentionUpdate[] = [];
  const layer = attentionReviewClientLayer({
    quietUntil: () => undefined,
    evaluate: (update) => {
      updates.push(update);
      return Effect.succeed(speakDecision());
    },
  });

  const reviewer = await Effect.runPromise(
    makeEffectAttentionReviewer({ now: () => DECIDED_AT }).pipe(Effect.provide(layer)),
  );

  const working = session("review");
  const [firstReview] = await Effect.runPromise(reviewer.review([working]));
  assert.equal(firstReview?.outcome, ATTENTION_REVIEW_OUTCOME.DECIDED);
  assert.deepEqual(firstReview?.decision, speakDecision());
  assert.equal(updates.length, 1);

  assert.deepEqual(await Effect.runPromise(reviewer.review([working])), []);
  assert.equal(updates.length, 1);
});

test("reviewAttentionUpdates evaluates a fresh roster on each call", async () => {
  const updates: AttentionUpdate[] = [];
  const layer = attentionReviewClientLayer({
    quietUntil: () => undefined,
    evaluate: (update) => {
      updates.push(update);
      return Effect.succeed(speakDecision());
    },
  });

  const working = session("review");
  const reviews = await Effect.runPromise(
    reviewAttentionUpdates([working], { now: () => DECIDED_AT }).pipe(Effect.provide(layer)),
  );

  assert.equal(reviews.length, 1);
  assert.equal(reviews[0]?.outcome, ATTENTION_REVIEW_OUTCOME.DECIDED);
  assert.equal(updates.length, 1);
});

test("reviewAttentionUpdates treats client failures as unavailable reviews", async () => {
  const layer = attentionReviewClientLayer({
    quietUntil: () => undefined,
    evaluate: () =>
      Effect.fail(
        new AttentionReviewNetworkFailure({
          message: "network down",
        }),
      ),
  });

  const waiting = session("review", { status: SESSION_STATUS.WAITING });
  const [review] = await Effect.runPromise(
    reviewAttentionUpdates([waiting], { now: () => DECIDED_AT }).pipe(Effect.provide(layer)),
  );

  assert.equal(review?.outcome, ATTENTION_REVIEW_OUTCOME.UNAVAILABLE);
  assert.equal(review?.decision.disposition, ATTENTION_DISPOSITION.SILENT);
});

test("fromPromiseAttentionReview wraps an AttentionEvaluator", async () => {
  const updates: AttentionUpdate[] = [];
  const layer = fromPromiseAttentionReview({
    evaluate: async (update) => {
      updates.push(update);
      return speakDecision();
    },
  });

  const decision = await Effect.runPromise(
    evaluateAttentionUpdate(sampleUpdate()).pipe(Effect.provide(layer)),
  );
  assert.deepEqual(decision, speakDecision());
  assert.equal(updates.length, 1);
});

test("AttentionReviewLive maps OpenAI rate limits to AttentionReviewRateLimited", async () => {
  let now = DECIDED_AT;
  const layer = AttentionReviewLive({
    apiKey: API_KEY,
    model: "gpt-test",
    baseUrl: "https://api.test/v1",
    maximumOutputTokens: 64,
    requestTimeoutMs: 5_000,
    now: () => now,
    fetch: async () =>
      new Response("", {
        status: 429,
        headers: { "retry-after": "30" },
      }),
  });

  const exit = await Effect.runPromiseExit(
    evaluateAttentionUpdate(sampleUpdate()).pipe(Effect.provide(layer)),
  );
  assert.equal(Exit.isFailure(exit), true);
  if (Exit.isFailure(exit)) {
    const failure = Cause.failureOption(exit.cause);
    assert.equal(failure._tag, "Some");
    if (failure._tag === "Some") {
      assert(failure.value instanceof AttentionReviewRateLimited);
      assert.equal(failure.value.quietUntil, DECIDED_AT + 30_000);
    }
  }

  now = DECIDED_AT + 5_000;
  const quietExit = await Effect.runPromiseExit(
    evaluateAttentionUpdate(sampleUpdate()).pipe(Effect.provide(layer)),
  );
  assert.equal(Exit.isSuccess(quietExit), true);
  if (Exit.isSuccess(quietExit)) {
    assert.equal(quietExit.value, undefined);
  }
});

test("openAiAttentionReviewDecision returns a parsed decision on success", async () => {
  const decisionBody = {
    disposition: ATTENTION_DISPOSITION.SPEAK_DURING_TURN,
    summary: SPOKEN_SUMMARY,
    answers_ask: false,
  };
  const result = await openAiAttentionReviewDecision(sampleUpdate(), {
    apiKey: API_KEY,
    model: "gpt-test",
    baseUrl: "https://api.test/v1",
    maximumOutputTokens: 64,
    requestTimeoutMs: 5_000,
    now: () => DECIDED_AT,
    fetch: async (url: string, init: RequestInit) => {
      assert.equal(url, `https://api.test/v1${ATTENTION_RESPONSES_PATH}`);
      assert.equal(init.method, "POST");
      return new Response(JSON.stringify({ output_text: JSON.stringify(decisionBody) }), {
        status: 200,
      });
    },
  });

  assert.equal(result.outcome, OPENAI_ATTENTION_REVIEW_OUTCOME.DECIDED);
  assert.deepEqual(result.decision, speakDecision());
});

test("openAiAttentionReviewDecision maps contract violations without throwing", async () => {
  const result = await openAiAttentionReviewDecision(sampleUpdate(), {
    apiKey: API_KEY,
    model: "gpt-test",
    baseUrl: "https://api.test/v1",
    maximumOutputTokens: 64,
    requestTimeoutMs: 5_000,
    now: () => DECIDED_AT,
    fetch: async () =>
      new Response(JSON.stringify({ output_text: JSON.stringify({ disposition: "speak" }) }), {
        status: 200,
      }),
  });

  assert.equal(result.outcome, OPENAI_ATTENTION_REVIEW_OUTCOME.CONTRACT_VIOLATION);
});

test("AttentionReviewLive maps contract violations to AttentionReviewContractViolation", async () => {
  const layer = AttentionReviewLive({
    apiKey: API_KEY,
    model: "gpt-test",
    baseUrl: "https://api.test/v1",
    maximumOutputTokens: 64,
    requestTimeoutMs: 5_000,
    now: () => DECIDED_AT,
    fetch: async () =>
      new Response(JSON.stringify({ output_text: JSON.stringify({ disposition: "speak" }) }), {
        status: 200,
      }),
  });

  const exit = await Effect.runPromiseExit(
    evaluateAttentionUpdate(sampleUpdate()).pipe(Effect.provide(layer)),
  );
  assert.equal(Exit.isFailure(exit), true);
  if (Exit.isFailure(exit)) {
    const failure = Cause.failureOption(exit.cause);
    assert.equal(failure._tag, "Some");
    if (failure._tag === "Some") {
      assert(failure.value instanceof AttentionReviewContractViolation);
    }
  }
});
