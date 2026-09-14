import { REASONING_EFFORT } from "@sidecar/runtime/vocabulary";
import { BRAIN_MAXIMUM_OUTPUT_TOKENS, BRAIN_REQUEST_TIMEOUT_MS } from "./model-adapter-shared.js";

/**
 * What a brain turn asks of OpenAI's Responses API when nothing names
 * otherwise. The one caller is Luke's hosted brain host, which runs every
 * turn on the deployment's own key; the desktop composes no brain and holds
 * no key of its own.
 */
export const BRAIN_OPENAI_DEFAULTS = {
  BASE_URL: "https://api.openai.com/v1",
  MODEL: "gpt-5.6-terra",
  REASONING_EFFORT: REASONING_EFFORT.MEDIUM,
  REQUEST_TIMEOUT_MS: BRAIN_REQUEST_TIMEOUT_MS,
  MAXIMUM_OUTPUT_TOKENS: BRAIN_MAXIMUM_OUTPUT_TOKENS,
} as const;
