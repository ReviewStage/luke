import { MODEL_RESPONSE_OUTCOME, type ModelAdapter } from "../../core.js";
import type { HostedSpend } from "../quota.js";

/**
 * The model adapter with the daily meter in front of it. Every inference —
 * an answer, or the explicit compaction that is one — spends one unit of the
 * account's single daily allowance before the upstream is asked, and a spend
 * the meter refuses ends the inference as a throttle until the day's counter
 * resets, which the runtime carries as the run's quiet end exactly as the
 * desktop's hosted adapter does when the service answers it the same. A
 * token count spends nothing: it asks the model for no words.
 */
export function meteredModelAdapter(
  inner: ModelAdapter,
  spend: () => Promise<HostedSpend>,
): ModelAdapter {
  const admitted = async () => {
    const spent = await spend();
    return spent.allowed ? undefined : spent.quota.resetsAt;
  };
  return {
    ...(inner.model !== undefined ? { model: inner.model } : undefined),
    capabilities: () => inner.capabilities(),
    respond: async (items, options) => {
      const until = await admitted();
      if (until !== undefined) return { outcome: MODEL_RESPONSE_OUTCOME.THROTTLED, until };
      return inner.respond(items, options);
    },
    countInputTokens: (items, options) => inner.countInputTokens(items, options),
    compact: async (items, options) => {
      const until = await admitted();
      if (until !== undefined) return { outcome: MODEL_RESPONSE_OUTCOME.THROTTLED, until };
      return inner.compact(items, options);
    },
    quietUntil: () => inner.quietUntil(),
  };
}
