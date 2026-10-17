/**
 * meter.ts -- the account's daily meter in front of every model Luke pays for.
 *
 * Every inference that runs on Luke's own key is counted on the account's
 * daily meter before it runs, whichever agent asked: the brain and
 * its workers, a coding agent and its workers on Luke's key, and a title
 * generated for any of them. A step on the account's own key is the
 * account's to pay for and is never counted. eve makes one model call per
 * step, so wrapping the model counts each inference exactly once. The count
 * enforces nothing: a meter that cannot be written is reported and the
 * inference runs anyway, because a usage row is for the admin pages and is
 * no reason to fail a turn.
 */

import { failureKind } from "@luke/runtime/effect";
import { type LanguageModel, type LanguageModelMiddleware, wrapLanguageModel } from "ai";

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

/** One account's meter over the deployment's count of a use, a count that failed reported to the log. */
export function accountMeter(spend: (userId: string) => Promise<void>, userId: string): MeterSeams {
  return {
    spend: () => spend(userId),
    report: (message) => console.warn(message),
  };
}
