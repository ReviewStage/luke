import { createOpenAI } from "@ai-sdk/openai";
import { failureKind } from "@sidecar/runtime/effect";
import { type LanguageModel, type LanguageModelMiddleware, wrapLanguageModel } from "ai";
import { Redacted, Result } from "effect";
import type { CoderRefusal } from "../coder-host/bounds.js";
import { type CoderModelSelection, coderModel } from "../coder-host/model.js";
import { BRAIN_HOST } from "./bounds.js";
import type { OpenAiAccess } from "./production.js";

/**
 * How the hosted brain reaches its model: as a coding agent's step reaches
 * its own (`../coder-host/model.ts`), the brain's model and effort handed to
 * the provider on Luke's own key, with the account's daily meter counted
 * before every inference. The planning model and its workers alike run on
 * that one path, so a worker's model and effort are asked for, recorded,
 * and drawn as an agent's worker's are. eve makes one model call per step,
 * so wrapping the calls counts each inference exactly once. The count
 * enforces nothing: a meter that cannot be written is reported and the
 * inference runs anyway, because a usage row is for the admin pages and is
 * no reason to fail a turn.
 */

/** The meter in front of the model: what counts a use, and where a count that failed is reported. */
export interface MeterSeams {
  /** Counts one hosted use; nothing to answer, since nothing is refused on the count. */
  readonly spend: () => Promise<void>;
  /** Where a meter that could not be written is reported. */
  readonly report: (message: string) => void;
}

function meteredMiddleware(meter: MeterSeams): LanguageModelMiddleware {
  const record = async () => {
    try {
      await meter.spend();
    } catch (cause) {
      // Note that the failure is reported by its kind, because a store's message can quote a row.
      meter.report(`A hosted inference was not counted: ${failureKind(cause)}`);
    }
  };
  return {
    async wrapGenerate({ doGenerate }) {
      await record();
      return doGenerate();
    },
    async wrapStream({ doStream }) {
      await record();
      return doStream();
    },
  };
}

/** The model with the meter in front of it: every generate or stream is counted first. */
export function meteredModel(
  model: Exclude<LanguageModel, string>,
  meter: MeterSeams,
): Exclude<LanguageModel, string> {
  return wrapLanguageModel({ model, middleware: meteredMiddleware(meter) });
}

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
  const selected = coderModel(
    access.choice,
    { anthropic: undefined, openAi: { key: access.apiKey } },
    BRAIN_HOST.MODEL_CONTEXT_WINDOW_TOKENS,
  );
  return Result.map(selected, (selection) => ({
    ...selection,
    model: meteredModel(selection.model, meter),
  }));
}

/** OpenAI's Responses model on Luke's own key, as the AI SDK reaches it. */
export function openAiBrainModel(
  apiKey: Redacted.Redacted,
  modelId: string,
): Exclude<LanguageModel, string> {
  // The key is revealed here alone, into the SDK client that puts it on its requests.
  return createOpenAI({ apiKey: Redacted.value(apiKey) }).responses(modelId);
}
