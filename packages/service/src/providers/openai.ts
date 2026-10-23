/**
 * openai.ts -- where the hosted endpoints reach OpenAI. Every call runs on the
 * calling account's own OpenAI API key (`../accounts/own-api-key.ts`); the
 * deployment holds no OpenAI key of its own.
 */

export const HOSTED_OPENAI_DEFAULTS = {
  BASE_URL: "https://api.openai.com/v1",
  REQUEST_TIMEOUT_MS: 15_000,
} as const;
