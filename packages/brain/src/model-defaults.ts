import { REASONING_EFFORT } from "@sidecar/runtime/vocabulary";
import { BRAIN_MAXIMUM_OUTPUT_TOKENS, BRAIN_REQUEST_TIMEOUT_MS } from "./model-adapter-shared.js";

/**
 * The small model the read prefetch plans and summarizes on: it sees the words
 * so far and the roster the turn would see anyway, and decides only which
 * reads to begin, so a fast low-effort model is the right one. The hosted
 * service's prefetch operation runs on it unless its deployment names another.
 */
export const BRAIN_PREFETCH_MODEL = "gpt-5.6-luna";

/**
 * What a brain turn asks of OpenAI's Responses API when nothing names
 * otherwise. The one caller is Luke's hosted service, which runs every turn
 * on the deployment's own key; the desktop reaches OpenAI through that
 * service and never with a key of its own.
 */
export const BRAIN_OPENAI_DEFAULTS = {
  BASE_URL: "https://api.openai.com/v1",
  MODEL: "gpt-5.6-terra",
  REASONING_EFFORT: REASONING_EFFORT.MEDIUM,
  REQUEST_TIMEOUT_MS: BRAIN_REQUEST_TIMEOUT_MS,
  MAXIMUM_OUTPUT_TOKENS: BRAIN_MAXIMUM_OUTPUT_TOKENS,
} as const;
