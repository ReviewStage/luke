import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { MODEL_PROVIDER, type ModelProvider } from "@luke/features/models-wire";
import type { LanguageModel } from "ai";
import { Redacted } from "effect";

/**
 * model.ts -- the model a call beside an account's agents runs on, reached at its provider directly on the account's own key.
 *
 * An agent's title is one small call on a fixed cheap model at the
 * provider's own door, on the account's own key (`account-keys.ts`'s
 * `ownKeyOf`); nothing goes through AI Gateway and our own key is never
 * one. A key is revealed here alone, into the SDK client that puts it on
 * its requests.
 */

/** The one model an agent's title is generated on at each provider: the cheapest that names a task well, at the provider's own id. */
const AGENT_TITLE_MODEL_ID = {
  [MODEL_PROVIDER.ANTHROPIC]: "claude-haiku-5-5",
  [MODEL_PROVIDER.OPENAI]: "gpt-6-luna",
} as const;

/** One provider's API key the account saved, opened, for a call beside its agents (`account-keys.ts`'s `ownKeyOf`). */
export interface OwnKey {
  readonly provider: ModelProvider;
  readonly key: Redacted.Redacted;
}

/** The model an agent's title is generated on: its provider's cheap title model, on the account's own key for that provider. */
export function titleModel(own: OwnKey, fetch?: typeof globalThis.fetch): LanguageModel {
  // The key is revealed here alone, into the SDK client that puts it on its requests.
  const settings = {
    apiKey: Redacted.value(own.key),
    ...(fetch === undefined ? undefined : { fetch }),
  };
  const modelId = AGENT_TITLE_MODEL_ID[own.provider];
  return own.provider === MODEL_PROVIDER.ANTHROPIC
    ? createAnthropic(settings)(modelId)
    : createOpenAI(settings).responses(modelId);
}
