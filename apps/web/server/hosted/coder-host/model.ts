import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { MODEL_PROVIDER, type ModelChoice, type ModelProvider } from "@sidecar/hosted/models-wire";
import type { LanguageModel } from "ai";
import { Redacted, Result } from "effect";
import type { AgentModelOptionsDefinition } from "eve";
import { providerModelOf } from "../model-catalog.js";
import { CODER_REFUSAL, type CoderRefusal } from "./bounds.js";

/**
 * model.ts -- the model one step of a coding agent runs on, reached at its provider directly on Luke's own key.
 *
 * The agent's row names a catalog id and an effort; the step is told the
 * provider's own model and the provider's own word for the effort, since
 * the two providers spell it differently: Anthropic takes `effort` and
 * OpenAI's Responses API `reasoningEffort`, each under its own provider
 * options. Nothing goes through AI Gateway, so the catalog's efforts for a
 * model are handed to the provider as the catalog lists them. Each step
 * also asks for its reasoning in words, so the agent's tab can show what
 * it thought as the Work tab shows Luke's: OpenAI for a summary, as the
 * planning brain does, and Anthropic for its summarized thinking on a
 * model that thinks whether asked or not. The agent's
 * title is one small call beside the steps, on a fixed cheap model at the
 * same provider door. A key is
 * revealed here alone, into the SDK client that puts it on its requests.
 */

/** The one model an agent's title is generated on: the cheapest that names a task well, at Anthropic's own id. */
const AGENT_TITLE_MODEL_ID = "claude-haiku-5-5";

/** How much of its reasoning an OpenAI step is asked to summarise: `auto` lets the model choose how much to say. */
const OPENAI_REASONING_SUMMARY = "auto";

/** The adaptive thinking a Claude step that already thinks is asked to show: summarized words rather than empty blocks. */
const ANTHROPIC_SHOWN_THINKING = { type: "adaptive", display: "summarized" } as const;

/**
 * The Claude models that think when the request names no thinking: the
 * Claude 5 family. Note that only these are asked to show their thinking,
 * because the ask is adaptive thinking itself: for these it changes what
 * the step returns and not what it costs, while an older Claude would
 * start thinking where it did not, which is a step's cost and latency and
 * no one decided that. The next family that thinks by default joins here.
 */
const THINKS_BY_DEFAULT = /^claude-[a-z]+-5(?:-|$)/u;

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

/** The provider's own options for a step: the effort, and the ask for its reasoning in words where that costs nothing more. */
function stepOptions(
  provider: ModelProvider,
  modelId: string,
  effort: string,
): AgentModelOptionsDefinition {
  switch (provider) {
    case MODEL_PROVIDER.ANTHROPIC:
      return {
        providerOptions: {
          anthropic: THINKS_BY_DEFAULT.test(modelId)
            ? { effort, thinking: ANTHROPIC_SHOWN_THINKING }
            : { effort },
        },
      };
    case MODEL_PROVIDER.OPENAI:
      return {
        providerOptions: {
          openai: { reasoningEffort: effort, reasoningSummary: OPENAI_REASONING_SUMMARY },
        },
      };
  }
}

/** The model an agent's title is generated on, or nothing where the deployment holds no Anthropic key, which leaves agents untitled. */
export function titleModel(keys: ProviderKeys): LanguageModel | undefined {
  if (keys.anthropic === undefined) return undefined;
  // The key is revealed here alone, into the SDK client that puts it on its requests.
  return createAnthropic({ apiKey: Redacted.value(keys.anthropic) })(AGENT_TITLE_MODEL_ID);
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
    modelOptions: stepOptions(named.provider, named.modelId, choice.effort),
  });
}
