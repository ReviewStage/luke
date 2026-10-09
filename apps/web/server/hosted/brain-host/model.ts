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

/**
 * How much of its reasoning the planning model is asked to summarise. OpenAI
 * never returns a reasoning model's own thinking, only a summary of it, and
 * only when one is asked for; `auto` lets the model choose how much to say.
 */
export const BRAIN_REASONING_SUMMARY = {
  AUTO: "auto",
} as const;

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
/**
 * The model asked to summarise its reasoning on every inference, so each
 * step's reasoning part carries words the Work tab can show. Note that the
 * option joins whatever OpenAI options the call already carries rather than
 * replacing them, because eve sets its own there.
 */
export function summarizedReasoningModel(
  model: Exclude<LanguageModel, string>,
): Exclude<LanguageModel, string> {
  return wrapLanguageModel({
    model,
    middleware: {
      transformParams: async ({ params }) => ({
        ...params,
        providerOptions: {
          ...params.providerOptions,
          openai: {
            ...params.providerOptions?.openai,
            reasoningSummary: BRAIN_REASONING_SUMMARY.AUTO,
          },
        },
      }),
    },
  });
}

export function openAiBrainModel(
  apiKey: Redacted.Redacted,
  modelId: string,
): Exclude<LanguageModel, string> {
  // The key is revealed here alone, into the SDK client that puts it on its requests.
  return createOpenAI({ apiKey: Redacted.value(apiKey) }).responses(modelId);
}
