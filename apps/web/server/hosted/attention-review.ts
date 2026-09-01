import { Effect } from "effect";
import {
  ATTENTION_RESPONSES_PATH,
  type AttentionDecision,
  attentionDecisionFromModel,
  attentionResponsesOutputText,
  attentionResponsesRequest,
  HOSTED_ATTENTION_CONTRACT_HEADER,
  HOSTED_ATTENTION_CONTRACT_VERSION,
  type LegacyAttentionDecision,
  legacyAttentionDecisionFromModel,
  legacyAttentionResponsesRequest,
  text as trimmedText,
  type UnparsedWireValue,
} from "../core.js";
import { HostedAuth, HostedClock, HostedMeterService, HostedOpenAi } from "../services/tags.js";
import type { HostedErrorFields } from "./http.js";
import {
  decodeJsonBody,
  HOSTED_HTTP_STATUS,
  invalidRequest,
  jsonResponseEffect,
  methodNotAllowed,
  quotaExhausted,
  readJsonBody,
  unauthorized,
  unavailable,
  upstreamError,
} from "./http-effect.js";
import { HOSTED_METER } from "./quota.js";
import { AttentionPromptUpdateSchema } from "./schema.js";

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
  MODEL: "gpt-5.6-luna",
  MAXIMUM_OUTPUT_TOKENS: 4096,
} as const;

export interface AttentionReviewAnswer {
  decision: AttentionDecision | LegacyAttentionDecision;
  quota: import("./quota.js").HostedSpend["quota"];
}

export const handleAttentionReview = Effect.fn("handleAttentionReview")(function* (
  request: Request,
) {
  if (request.method !== "POST") {
    return methodNotAllowed();
  }

  const openAi = yield* HostedOpenAi;
  const apiKey = trimmedText(openAi.apiKey);
  if (!apiKey) {
    return unavailable();
  }

  const auth = yield* HostedAuth;
  const userId = yield* auth.resolveUserId(request);
  if (!userId) {
    return unauthorized();
  }

  const contractVersion = request.headers.get(HOSTED_ATTENTION_CONTRACT_HEADER);
  const legacyContract = contractVersion === null;
  if (!legacyContract && contractVersion !== HOSTED_ATTENTION_CONTRACT_VERSION) {
    return invalidRequest();
  }

  const payload = yield* readJsonBody(request);
  const update =
    payload === undefined ? undefined : decodeJsonBody(AttentionPromptUpdateSchema, payload);
  if (!update) {
    return invalidRequest();
  }

  const meter = yield* HostedMeterService;
  const spend = yield* meter.spend(userId, HOSTED_METER.ATTENTION_REVIEW);
  if (!spend.allowed) {
    return quotaExhausted(spend.quota);
  }

  const model = trimmedText(openAi.attentionModel) ?? HOSTED_ATTENTION_DEFAULTS.MODEL;
  const response = yield* openAi.post(
    ATTENTION_RESPONSES_PATH,
    (legacyContract ? legacyAttentionResponsesRequest : attentionResponsesRequest)(update, {
      model,
      maximumOutputTokens: HOSTED_ATTENTION_DEFAULTS.MAXIMUM_OUTPUT_TOKENS,
    }),
  );
  if (!response?.ok) {
    const extra: HostedErrorFields = {};
    if (response) extra.upstreamStatus = response.status;
    return upstreamError(extra.upstreamStatus);
  }

  const body: unknown = yield* Effect.promise(() => response.json().catch(() => undefined));
  const text =
    body === undefined ? undefined : attentionResponsesOutputText(body as UnparsedWireValue);
  const clock = yield* HostedClock;
  const now = clock.now();
  let decision: AttentionDecision | LegacyAttentionDecision | undefined;
  if (text) {
    try {
      decision = (legacyContract ? legacyAttentionDecisionFromModel : attentionDecisionFromModel)(
        JSON.parse(text),
        now,
      );
    } catch {
      decision = undefined;
    }
  }
  if (!decision) {
    return upstreamError();
  }

  const answer: AttentionReviewAnswer = { decision, quota: spend.quota };
  return yield* jsonResponseEffect(HOSTED_HTTP_STATUS.OK, answer);
});

/** @deprecated Tests use hosted-runner shims. */
export interface AttentionReviewOptions {
  request: Request;
  apiKey: string | undefined;
  model?: string;
  resolveUserId: (request: Request) => Promise<string | undefined>;
  spend: (userId: string) => Promise<import("./quota.js").HostedSpend>;
  fetch?: (input: string, init: RequestInit) => Promise<Response>;
  now?: () => number;
  timeoutMs?: number;
}
