/**
 * How the hosted endpoints reach OpenAI on Luke's own key. The key comes from
 * the deployment's environment and never appears in a response, a log line, or
 * an error; without one the endpoints answer 503 and the hosted tier is simply
 * off, the same kill switch the feedback endpoint uses.
 */

import type * as HttpClient from "@effect/platform/HttpClient";
import { HTTP_METHOD } from "@sidecar/wire";
import { Effect } from "effect";
import type {
  BrainEmbeddingsRequest,
  BrainInputTokensRequest,
  BrainResponsesRequest,
  realtimeClientSecretRequest,
  remoteRealtimeClientSecretRequest,
} from "../core.js";
import { accountCall, callAnswered, fixedBearer } from "../core.js";
// Type-only, so the value-level import the introduction handler takes from
// this module never becomes a runtime cycle.
import type { introductionClientSecretRequest } from "./introduction-mint.js";

export const HOSTED_OPENAI_ENVIRONMENT = {
  API_KEY: "OPENAI_API_KEY",
  /** The same override names the desktop honours, so one convention configures both. */
  REALTIME_MODEL: "LUKE_REALTIME_MODEL",
  BRAIN_MODEL: "LUKE_BRAIN_MODEL",
} as const;

export const HOSTED_OPENAI_DEFAULTS = {
  BASE_URL: "https://api.openai.com/v1",
  REQUEST_TIMEOUT_MS: 15_000,
} as const;

/** Build-fixed documents the hosted tier POSTs to OpenAI. */
export type OpenAiPostBody =
  | ReturnType<typeof realtimeClientSecretRequest>
  | ReturnType<typeof remoteRealtimeClientSecretRequest>
  | ReturnType<typeof introductionClientSecretRequest>
  | BrainResponsesRequest
  | BrainInputTokensRequest
  | BrainEmbeddingsRequest;

export interface OpenAiUpstreamOptions {
  apiKey: string;
  timeoutMs?: number | undefined;
}

/**
 * Posts one build-fixed document to OpenAI, resolving to nothing on a network
 * fault so a caller answers 502 without ever holding an error that could name
 * the key. The caller's own cancellation is the run's interruption: a turn
 * dropped mid-call drops the request with it, over the ambient `HttpClient`.
 */
export function postOpenAiEffect(
  path: string,
  body: OpenAiPostBody,
  options: OpenAiUpstreamOptions,
): Effect.Effect<Response | undefined, never, HttpClient.HttpClient> {
  const call = accountCall({
    baseUrl: HOSTED_OPENAI_DEFAULTS.BASE_URL,
    credential: fixedBearer(options.apiKey),
    requestTimeoutMs: options.timeoutMs ?? HOSTED_OPENAI_DEFAULTS.REQUEST_TIMEOUT_MS,
  });
  return Effect.map(
    call.send({ method: HTTP_METHOD.POST, path, body: JSON.stringify(body) }),
    (answer) => (callAnswered(answer) ? answer.response : undefined),
  );
}
