/**
 * How the hosted endpoints reach OpenAI on Luke's own key. The key comes from
 * the deployment's environment and never appears in a response, a log line, or
 * an error; without one the endpoints answer 503 and the hosted tier is simply
 * off, the same kill switch the feedback endpoint uses.
 */

export const HOSTED_OPENAI_ENVIRONMENT = {
  API_KEY: "OPENAI_API_KEY",
} as const;

export const HOSTED_OPENAI_DEFAULTS = {
  BASE_URL: "https://api.openai.com/v1",
  REQUEST_TIMEOUT_MS: 15_000,
} as const;
