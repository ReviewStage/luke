import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { Redacted, Result } from "effect";
import type { AgentModelOptionsDefinition } from "eve";
import { MODEL_PROVIDER, type ModelChoice, providerModelOf } from "../model-catalog.js";
import { CODER_REFUSAL, type CoderRefusal } from "./bounds.js";

/**
 * model.ts -- the model one step of a coding agent runs on, reached at its provider directly on Luke's own key.
 *
 * The agent's row names a catalog id and an effort; the step is told the
 * provider's own model and the provider's own word for the effort, since
 * the two providers spell it differently: Anthropic takes `effort` and
 * OpenAI's Responses API `reasoningEffort`, each under its own provider
 * options. Nothing goes through AI Gateway, so the catalog's efforts for a
 * model are handed to the provider as the catalog lists them. A key is
 * revealed here alone, into the SDK client that puts it on its requests.
 */

/** Luke's own keys, sealed; one absent is that provider's agents refused at their first step. */
export interface ProviderKeys {
  readonly anthropic: Redacted.Redacted | undefined;
  readonly openAi: Redacted.Redacted | undefined;
}

/** What a step is told: the provider's model, the window eve compacts against, and the effort in the provider's own words. */
export interface CoderModelSelection {
  readonly model: LanguageModel;
  readonly modelContextWindowTokens: number;
  readonly modelOptions: AgentModelOptionsDefinition;
}

/** The provider's own option carrying the effort, by provider. */
function effortOptions(
  provider: (typeof MODEL_PROVIDER)[keyof typeof MODEL_PROVIDER],
  effort: string,
): AgentModelOptionsDefinition {
  switch (provider) {
    case MODEL_PROVIDER.ANTHROPIC:
      return { providerOptions: { anthropic: { effort } } };
    case MODEL_PROVIDER.OPENAI:
      return { providerOptions: { openai: { reasoningEffort: effort } } };
  }
}

/** The choice as a step runs it, or why it cannot: a provider Luke does not run, or a key the deployment does not hold. */
export function coderModel(
  choice: ModelChoice,
  keys: ProviderKeys,
  contextWindowTokens: number,
): Result.Result<CoderModelSelection, CoderRefusal> {
  const named = providerModelOf(choice.model);
  if (named === undefined) return Result.fail(CODER_REFUSAL.UNKNOWN_PROVIDER);
  const key = named.provider === MODEL_PROVIDER.ANTHROPIC ? keys.anthropic : keys.openAi;
  if (key === undefined) return Result.fail(CODER_REFUSAL.NO_PROVIDER_KEY);
  // The key is revealed here alone, into the SDK client that puts it on its requests.
  const model =
    named.provider === MODEL_PROVIDER.ANTHROPIC
      ? createAnthropic({ apiKey: Redacted.value(key) })(named.modelId)
      : createOpenAI({ apiKey: Redacted.value(key) }).responses(named.modelId);
  return Result.succeed({
    model,
    modelContextWindowTokens: contextWindowTokens,
    modelOptions: effortOptions(named.provider, choice.effort),
  });
}
