/**
 * How the hosted endpoints reach OpenAI on Luke's own key. The key comes from
 * the deployment's environment and never appears in a response, a log line, or
 * an error; without one the endpoints answer 503 and the hosted tier is simply
 * off, the same kill switch the feedback endpoint uses.
 */

import type { attentionResponsesRequest, realtimeClientSecretRequest } from "../core.js";

export const HOSTED_OPENAI_ENVIRONMENT = {
  API_KEY: "OPENAI_API_KEY",
  /** The same override names the desktop honours, so one convention configures both. */
  REALTIME_MODEL: "LUKE_REALTIME_MODEL",
  ATTENTION_MODEL: "LUKE_ATTENTION_MODEL",
} as const;

export const HOSTED_OPENAI_DEFAULTS = {
  BASE_URL: "https://api.openai.com/v1",
  REQUEST_TIMEOUT_MS: 15_000,
} as const;

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** Build-fixed documents the hosted tier POSTs to OpenAI. */
export type OpenAiPostBody =
  | ReturnType<typeof realtimeClientSecretRequest>
  | ReturnType<typeof attentionResponsesRequest>;

export interface OpenAiUpstreamOptions {
  apiKey: string;
  fetch?: FetchLike;
  timeoutMs?: number;
}

/**
 * Posts one build-fixed document to OpenAI, resolving to nothing on a network
 * fault so a caller answers 502 without ever holding an error that could name
 * the key.
 */
export async function postOpenAi(
  path: string,
  body: OpenAiPostBody,
  options: OpenAiUpstreamOptions,
): Promise<Response | undefined> {
  const send = options.fetch ?? ((input: string, init: RequestInit) => fetch(input, init));
  try {
    return await send(`${HOSTED_OPENAI_DEFAULTS.BASE_URL}${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${options.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeoutMs ?? HOSTED_OPENAI_DEFAULTS.REQUEST_TIMEOUT_MS),
    });
  } catch {
    return undefined;
  }
}
