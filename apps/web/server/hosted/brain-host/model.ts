import { createOpenAI } from "@ai-sdk/openai";
import { type LanguageModel, type LanguageModelMiddleware, wrapLanguageModel } from "ai";
import { Redacted } from "effect";

/**
 * How the hosted brain reaches OpenAI: directly, on Luke's own key, through
 * the AI SDK's Responses model, with the account's daily meter counted before
 * every inference. eve makes one model call per step, so wrapping the calls
 * counts each inference exactly once. The count enforces nothing: a meter
 * that cannot be written is reported and the inference runs anyway, because
 * a usage row is for the admin pages and is no reason to fail a turn.
 */

/** The meter in front of the model: what counts a use, and where a count that failed is reported. */
export interface MeterSeams {
  /** Counts one hosted use; nothing to answer, since nothing is refused on the count. */
  readonly spend: () => Promise<void>;
  /** Where a meter that could not be written is reported. */
  readonly report: (message: string) => void;
}

/** How much of a failed write's own wording the report keeps. */
const REPORT_REASON_BOUND = 200;

function meteredMiddleware(meter: MeterSeams): LanguageModelMiddleware {
  const record = async () => {
    try {
      await meter.spend();
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      meter.report(`A hosted inference was not counted: ${reason.slice(0, REPORT_REASON_BOUND)}`);
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
): LanguageModel {
  return wrapLanguageModel({ model, middleware: meteredMiddleware(meter) });
}

/** OpenAI's Responses model on Luke's own key, as the AI SDK reaches it. */
export function openAiBrainModel(
  apiKey: Redacted.Redacted,
  modelId: string,
): Exclude<LanguageModel, string> {
  // The key is revealed here alone, into the SDK client that puts it on its requests.
  return createOpenAI({ apiKey: Redacted.value(apiKey) }).responses(modelId);
}
