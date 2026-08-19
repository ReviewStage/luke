import {
  ATTENTION_DECISION_SCHEMA,
  ATTENTION_DECISION_SCHEMA_NAME,
  attentionDecisionFromModel,
} from "./attention.js";
import {
  type AttentionPromptUpdate,
  attentionInstructions,
  attentionUpdateInput,
} from "./attention-prompt.js";
import { isRecord, isWireString, text, type UnparsedWireValue } from "./json.js";
import type { AttentionDecision } from "./session.js";

/**
 * The one OpenAI Responses request an attention review may be. The desktop
 * evaluator sends it on the developer's own key and the hosted endpoint sends
 * it on Luke's, so it is built here once: the instructions, the decision
 * schema, and the refusal to store are fixed by the build on both paths, and
 * only the bounded update varies between two requests.
 */

export const ATTENTION_RESPONSES_PATH = "/responses";

const RESPONSES_TEXT_FORMAT_TYPE = "json_schema";
const RESPONSES_OUTPUT_TEXT_TYPE = "output_text";

const OPENAI_RATE_LIMIT_STATUS = 429;
const OPENAI_RETRY_AFTER_HEADER = "retry-after";

export type AttentionReviewFetch = (input: string, init: RequestInit) => Promise<Response>;

export interface AttentionResponsesOptions {
  model: string;
  maximumOutputTokens: number;
}

export const OPENAI_ATTENTION_REVIEW_DEFAULTS = {
  RATE_LIMIT_COOLDOWN_MS: 60_000,
} as const;

export interface OpenAiAttentionReviewConfig {
  apiKey: string;
  model: string;
  baseUrl: string;
  maximumOutputTokens: number;
  requestTimeoutMs: number;
  fetch: AttentionReviewFetch;
  now: () => number;
  rateLimitCooldownMs?: number;
}

export const OPENAI_ATTENTION_REVIEW_OUTCOME = {
  DECIDED: "decided",
  RATE_LIMITED: "rate-limited",
  HTTP_ERROR: "http-error",
  NETWORK_ERROR: "network-error",
  INVALID_RESPONSE: "invalid-response",
  CONTRACT_VIOLATION: "contract-violation",
} as const;

export type OpenAiAttentionReviewOutcome =
  (typeof OPENAI_ATTENTION_REVIEW_OUTCOME)[keyof typeof OPENAI_ATTENTION_REVIEW_OUTCOME];

export interface OpenAiAttentionReviewResult {
  outcome: OpenAiAttentionReviewOutcome;
  decision?: AttentionDecision;
  httpStatus?: number;
  retryAfterMs?: number;
  message?: string;
}

function withoutTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function parsedJson(outputText: string): UnparsedWireValue | undefined {
  try {
    // SAFETY: JSON.parse returns a wire value; attentionDecisionFromModel validates before use.
    return JSON.parse(outputText) as UnparsedWireValue;
  } catch {
    return undefined;
  }
}

/** Builds the Responses request body one bounded update is reviewed with. */
export function attentionResponsesRequest(
  update: AttentionPromptUpdate,
  options: AttentionResponsesOptions,
) {
  return {
    model: options.model,
    instructions: attentionInstructions(),
    input: attentionUpdateInput(update),
    max_output_tokens: options.maximumOutputTokens,
    // The update is reviewed and discarded; the API is never asked to keep it.
    store: false,
    text: {
      format: {
        type: RESPONSES_TEXT_FORMAT_TYPE,
        name: ATTENTION_DECISION_SCHEMA_NAME,
        schema: ATTENTION_DECISION_SCHEMA,
        strict: true,
      },
    },
  };
}

function outputTextFromContent(content: UnparsedWireValue): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((entry) =>
      isRecord(entry) && entry.type === RESPONSES_OUTPUT_TEXT_TYPE && isWireString(entry.text)
        ? entry.text
        : "",
    )
    .join("");
}

/**
 * Reads the structured decision out of a Responses payload without depending on
 * where a given API version places it.
 */
export function attentionResponsesOutputText(payload: UnparsedWireValue): string | undefined {
  if (!isRecord(payload)) return undefined;
  if (isWireString(payload.output_text)) return text(payload.output_text);
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
export function attentionResponsesMissingReason(payload: UnparsedWireValue): string {
  if (!isRecord(payload)) return "";
  const status = text(payload.status);
  const details = isRecord(payload.incomplete_details) ? payload.incomplete_details : undefined;
  const reason = details ? text(details.reason) : undefined;
  if (status && reason) return ` (${status}: ${reason})`;
  if (status) return ` (${status})`;
  return "";
}

/**
 * Sends one bounded update to the OpenAI Responses API and reads the decision
 * out of the answer. Network, HTTP, and contract failures stay on the result
 * rather than throwing, so callers can map them without a catch.
 */
export async function openAiAttentionReviewDecision(
  update: AttentionPromptUpdate,
  config: OpenAiAttentionReviewConfig,
): Promise<OpenAiAttentionReviewResult> {
  const baseUrl = withoutTrailingSlash(config.baseUrl);
  const cooldown =
    config.rateLimitCooldownMs ?? OPENAI_ATTENTION_REVIEW_DEFAULTS.RATE_LIMIT_COOLDOWN_MS;

  try {
    const response = await config.fetch(`${baseUrl}${ATTENTION_RESPONSES_PATH}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(
        attentionResponsesRequest(update, {
          model: config.model,
          maximumOutputTokens: config.maximumOutputTokens,
        }),
      ),
      signal: AbortSignal.timeout(config.requestTimeoutMs),
    });

    if (!response.ok) {
      if (response.status === OPENAI_RATE_LIMIT_STATUS) {
        const retryAfterSeconds = Number(response.headers.get(OPENAI_RETRY_AFTER_HEADER));
        const retryAfterMs =
          Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
            ? retryAfterSeconds * 1000
            : cooldown;
        return {
          outcome: OPENAI_ATTENTION_REVIEW_OUTCOME.RATE_LIMITED,
          httpStatus: response.status,
          retryAfterMs,
        };
      }
      return {
        outcome: OPENAI_ATTENTION_REVIEW_OUTCOME.HTTP_ERROR,
        httpStatus: response.status,
        message: `OpenAI attention request failed with status ${response.status}`,
      };
    }

    let payload: UnparsedWireValue | undefined;
    try {
      // SAFETY: response.json returns a runtime value; attentionResponsesOutputText validates the wire contract.
      payload = (await response.json()) as UnparsedWireValue;
    } catch {
      return {
        outcome: OPENAI_ATTENTION_REVIEW_OUTCOME.INVALID_RESPONSE,
        message: "OpenAI attention response was not JSON",
      };
    }

    const outputText = attentionResponsesOutputText(payload);
    if (!outputText) {
      return {
        outcome: OPENAI_ATTENTION_REVIEW_OUTCOME.INVALID_RESPONSE,
        message: `OpenAI attention response carried no decision${attentionResponsesMissingReason(payload)}`,
      };
    }

    const decision = attentionDecisionFromModel(parsedJson(outputText), config.now());
    if (!decision) {
      return {
        outcome: OPENAI_ATTENTION_REVIEW_OUTCOME.CONTRACT_VIOLATION,
        message: "OpenAI attention response did not satisfy the decision contract",
      };
    }

    return {
      outcome: OPENAI_ATTENTION_REVIEW_OUTCOME.DECIDED,
      decision,
    };
  } catch (error) {
    return {
      outcome: OPENAI_ATTENTION_REVIEW_OUTCOME.NETWORK_ERROR,
      message: `OpenAI attention request did not complete: ${error instanceof Error ? error.name : "unknown error"}`,
    };
  }
}
