/**
 * What a brain turn asks of OpenAI's Responses API when nothing names
 * otherwise. The one caller is Luke's hosted brain host, which runs every
 * turn on the deployment's own key; the desktop composes no brain and holds
 * no key of its own.
 */
export const BRAIN_OPENAI_DEFAULTS = {
  MODEL: "gpt-6-sol",
} as const;
