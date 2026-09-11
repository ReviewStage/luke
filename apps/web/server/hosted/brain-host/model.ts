import { createOpenAI } from "@ai-sdk/openai";
import { type LanguageModel, type LanguageModelMiddleware, wrapLanguageModel } from "ai";
import type { HostedSpend } from "../quota.js";

/**
 * How the hosted brain reaches OpenAI: directly, on Luke's own key, through
 * the AI SDK's Responses model, with the account's daily meter spent before
 * every inference. eve makes one model call per step, so wrapping the calls
 * meters each inference exactly once; a spend the day cannot fit refuses the
 * call before anything travels, and the turn ends failed with the quota as
 * its reason rather than the model's.
 */

/** Thrown in place of an inference the meter refused; eve reports it as the turn's failure. */
export class HostedQuotaExceeded extends Error {
  readonly spend: HostedSpend;
  constructor(spend: HostedSpend) {
    super("The account's daily hosted allowance is spent.");
    this.name = "HostedQuotaExceeded";
    this.spend = spend;
  }
}

/** Spends one hosted use; answers whether the inference may run. */
export type MeterSpend = () => Promise<HostedSpend>;

function meteredMiddleware(spend: MeterSpend): LanguageModelMiddleware {
  const admit = async () => {
    const spent = await spend();
    if (!spent.allowed) throw new HostedQuotaExceeded(spent);
  };
  return {
    async wrapGenerate({ doGenerate }) {
      await admit();
      return doGenerate();
    },
    async wrapStream({ doStream }) {
      await admit();
      return doStream();
    },
  };
}

/** The model with the meter in front of it: every generate or stream spends first. */
export function meteredModel(
  model: Exclude<LanguageModel, string>,
  spend: MeterSpend,
): LanguageModel {
  return wrapLanguageModel({ model, middleware: meteredMiddleware(spend) });
}

/** OpenAI's Responses model on Luke's own key, as the AI SDK reaches it. */
export function openAiBrainModel(apiKey: string, modelId: string): Exclude<LanguageModel, string> {
  return createOpenAI({ apiKey }).responses(modelId);
}
