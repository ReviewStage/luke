import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { Redacted, type Result } from "effect";
import type { MeterSeams } from "../agent-runtime/meter.js";
import type { CoderRefusal } from "../coder-host/bounds.js";
import { type CoderModelSelection, coderModel } from "../coder-host/model.js";
import { BRAIN_HOST } from "./bounds.js";
import type { OpenAiAccess } from "./production.js";

/**
 * How the hosted brain reaches its model: as a coding agent's step reaches
 * its own (`../coder-host/model.ts`), the brain's model and effort handed to
 * the provider on Luke's own key, which carries the account's daily meter
 * (`../agent-runtime/meter.ts`). The brain and its workers alike
 * run on that one path, so a worker's model and effort are asked for,
 * recorded, and drawn as an agent's worker's are.
 */

/**
 * One inference of the brain as eve is told it: the coding agents' own
 * selection for the brain's model and effort on Luke's OpenAI key, which
 * asks for the effort and for the reasoning in words, behind the meter; or
 * why the choice cannot run, which only a choice outside the providers
 * Luke runs is.
 */
export function brainModelSelection(
  access: OpenAiAccess,
  meter: MeterSeams,
): Result.Result<CoderModelSelection, CoderRefusal> {
  return coderModel(
    access.choice,
    { anthropic: undefined, openAi: { key: access.apiKey, meter } },
    BRAIN_HOST.MODEL_CONTEXT_WINDOW_TOKENS,
    // The brain runs on OpenAI alone, which has no fast version Luke runs, so no fast step is refused.
    async () => undefined,
  );
}

/** OpenAI's Responses model on Luke's own key, as the AI SDK reaches it. */
export function openAiBrainModel(
  apiKey: Redacted.Redacted,
  modelId: string,
): Exclude<LanguageModel, string> {
  // The key is revealed here alone, into the SDK client that puts it on its requests.
  return createOpenAI({ apiKey: Redacted.value(apiKey) }).responses(modelId);
}
