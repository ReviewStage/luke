import type { UnknownException } from "effect/Cause";
import type * as Effect from "effect/Effect";
import { fromPromise, runPromiseOrDie } from "../../src/effect/runtime-bridge.js";
import {
  ATTENTION_RESPONSES_PATH,
  type AttentionDecision,
  attentionDecisionFromModel,
  attentionPromptUpdateFromWire,
  attentionResponsesOutputText,
  attentionResponsesRequest,
  text as trimmedText,
  type UnparsedWireValue,
} from "../core.js";
import {
  errorResponse,
  HOSTED_API_ERROR,
  HOSTED_HTTP_STATUS,
  type HostedErrorFields,
  jsonResponse,
} from "./http.js";
import { type FetchLike, postOpenAi } from "./openai.js";
import type { HostedSpend } from "./quota.js";

/**
 * Reviews one bounded session update on Luke's own key for a signed-in user.
 * This is not a proxy: the instructions, the decision schema, and the refusal
 * to store come from the same shared construction the desktop evaluator sends,
 * and the request's whole say is the update's bounded fields, validated here
 * against the bounds the local roster holds them to. What travels onward is
 * exactly what would have travelled from the desktop under the developer's own
 * key — never more.
 */

export const HOSTED_ATTENTION_DEFAULTS = {
  // The desktop evaluator's own default: a three-way classification with a
  // fixed prompt fits the cost-optimized tier, and its lower latency means
  // fewer decisions are discarded as superseded before they can be used.
  MODEL: "gpt-5.6-luna",
  MAXIMUM_OUTPUT_TOKENS: 4096,
} as const;

export interface AttentionReviewOptions {
  request: Request;
  /** Luke's own OpenAI key, from the deployment environment; absent means the tier is off. */
  apiKey: string | undefined;
  /** A deployment-configured model override; the shared default otherwise. */
  model?: string;
  resolveUserId: (request: Request) => Promise<string | undefined>;
  spend: (userId: string) => Promise<HostedSpend>;
  fetch?: FetchLike;
  now?: () => number;
  timeoutMs?: number;
}

export interface AttentionReviewAnswer {
  decision: AttentionDecision;
  quota: HostedSpend["quota"];
}

export async function handleAttentionReview(options: AttentionReviewOptions): Promise<Response> {
  const { request } = options;
  if (request.method !== "POST") {
    return errorResponse(
      HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
      HOSTED_API_ERROR.METHOD_NOT_ALLOWED,
    );
  }
  // Trimmed like the desktop's own key reads: a whitespace credential is the
  // kill switch, not a key, and a blank model override is no override at all.
  const apiKey = trimmedText(options.apiKey);
  if (!apiKey) {
    return errorResponse(HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE, HOSTED_API_ERROR.UNAVAILABLE);
  }

  const userId = await options.resolveUserId(request);
  if (!userId) {
    return errorResponse(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN);
  }

  const payload: unknown = await request.json().catch(() => undefined);
  const update =
    payload === undefined
      ? undefined
      : attentionPromptUpdateFromWire(
          // SAFETY: request.json returns a runtime value; attentionPromptUpdateFromWire validates the wire contract.
          payload as UnparsedWireValue,
        );
  if (!update) {
    return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
  }

  const spend = await options.spend(userId);
  if (!spend.allowed) {
    return errorResponse(HOSTED_HTTP_STATUS.TOO_MANY_REQUESTS, HOSTED_API_ERROR.QUOTA_EXHAUSTED, {
      quota: spend.quota,
    });
  }

  const response = await postOpenAi(
    ATTENTION_RESPONSES_PATH,
    attentionResponsesRequest(update, {
      model: trimmedText(options.model) ?? HOSTED_ATTENTION_DEFAULTS.MODEL,
      maximumOutputTokens: HOSTED_ATTENTION_DEFAULTS.MAXIMUM_OUTPUT_TOKENS,
    }),
    { apiKey, fetch: options.fetch, timeoutMs: options.timeoutMs },
  );
  if (!response || !response.ok) {
    const extra: HostedErrorFields = {};
    if (response) extra.upstreamStatus = response.status;
    return errorResponse(HOSTED_HTTP_STATUS.BAD_GATEWAY, HOSTED_API_ERROR.UPSTREAM_ERROR, extra);
  }

  const body: unknown = await response.json().catch(() => undefined);
  const text =
    body === undefined
      ? undefined
      : attentionResponsesOutputText(
          // SAFETY: response.json returns a runtime value; attentionResponsesOutputText validates the wire contract.
          body as UnparsedWireValue,
        );
  const now = options.now ?? Date.now;
  let decision: AttentionDecision | undefined;
  if (text) {
    try {
      decision = attentionDecisionFromModel(JSON.parse(text), now());
    } catch {
      decision = undefined;
    }
  }
  if (!decision) {
    return errorResponse(HOSTED_HTTP_STATUS.BAD_GATEWAY, HOSTED_API_ERROR.UPSTREAM_ERROR);
  }

  const answer: AttentionReviewAnswer = { decision, quota: spend.quota };
  return jsonResponse(HOSTED_HTTP_STATUS.OK, answer);
}

/** Effect entry point for the hosted attention review handler; defects stay on the Promise boundary. */
export function attentionReviewEffect(
  options: AttentionReviewOptions,
): Effect.Effect<Response, UnknownException, never> {
  return fromPromise(() => handleAttentionReview(options));
}

/** Runs {@link attentionReviewEffect} through the shared runtime bridge. */
export function runAttentionReview(options: AttentionReviewOptions): Promise<Response> {
  return runPromiseOrDie(attentionReviewEffect(options));
}
