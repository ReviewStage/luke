import {
  attentionResponsesOutputText,
  SUBJECT_RESPONSES_PATH,
  subjectDerivationFromModel,
  subjectInputFromWire,
  subjectResponsesRequest,
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
 * Derives one local session's subject on Luke's own key for a signed-in user.
 * Like the attention review this is not a proxy: the instructions, the schema,
 * and the refusal to store come from the shared construction the desktop's
 * keyed deriver sends, and the request's whole say is the bounded input,
 * validated here against the same bounds. The transcript slice it carries is
 * read for the one phrase and kept nowhere: it is not logged, not stored, and
 * OpenAI is asked not to retain the request.
 */

export const HOSTED_SUBJECT_DEFAULTS = {
  MODEL: "gpt-5.6-luna",
  MAXIMUM_OUTPUT_TOKENS: 4096,
} as const;

export interface SubjectDeriveOptions {
  request: Request;
  apiKey: string | undefined;
  model?: string;
  resolveUserId: (request: Request) => Promise<string | undefined>;
  spend: (userId: string) => Promise<HostedSpend>;
  fetch?: FetchLike;
  timeoutMs?: number;
}

export interface SubjectDeriveAnswer {
  subject: string | null;
  quota: HostedSpend["quota"];
}

export async function handleSubjectDerive(options: SubjectDeriveOptions): Promise<Response> {
  const { request } = options;
  if (request.method !== "POST") {
    return errorResponse(
      HOSTED_HTTP_STATUS.METHOD_NOT_ALLOWED,
      HOSTED_API_ERROR.METHOD_NOT_ALLOWED,
    );
  }
  const apiKey = trimmedText(options.apiKey);
  if (!apiKey) {
    return errorResponse(HOSTED_HTTP_STATUS.SERVICE_UNAVAILABLE, HOSTED_API_ERROR.UNAVAILABLE);
  }

  const userId = await options.resolveUserId(request);
  if (!userId) {
    return errorResponse(HOSTED_HTTP_STATUS.UNAUTHORIZED, HOSTED_API_ERROR.INVALID_TOKEN);
  }

  const payload: unknown = await request.json().catch(() => undefined);
  const input =
    payload === undefined
      ? undefined
      : subjectInputFromWire(
          // SAFETY: request.json returns a runtime value; subjectInputFromWire validates the wire contract.
          payload as UnparsedWireValue,
        );
  if (!input) {
    return errorResponse(HOSTED_HTTP_STATUS.BAD_REQUEST, HOSTED_API_ERROR.INVALID_REQUEST);
  }

  const spend = await options.spend(userId);
  if (!spend.allowed) {
    return errorResponse(HOSTED_HTTP_STATUS.TOO_MANY_REQUESTS, HOSTED_API_ERROR.QUOTA_EXHAUSTED, {
      quota: spend.quota,
    });
  }

  const response = await postOpenAi(
    SUBJECT_RESPONSES_PATH,
    subjectResponsesRequest(input, {
      model: trimmedText(options.model) ?? HOSTED_SUBJECT_DEFAULTS.MODEL,
      maximumOutputTokens: HOSTED_SUBJECT_DEFAULTS.MAXIMUM_OUTPUT_TOKENS,
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
  let derivation: ReturnType<typeof subjectDerivationFromModel>;
  if (text) {
    try {
      derivation = subjectDerivationFromModel(JSON.parse(text));
    } catch {
      derivation = undefined;
    }
  }
  if (!derivation) {
    return errorResponse(HOSTED_HTTP_STATUS.BAD_GATEWAY, HOSTED_API_ERROR.UPSTREAM_ERROR);
  }

  const answer: SubjectDeriveAnswer = { subject: derivation.subject, quota: spend.quota };
  return jsonResponse(HOSTED_HTTP_STATUS.OK, answer);
}
