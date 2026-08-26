import type { AttentionEvaluator, AttentionUpdate } from "@sidecar/attention";
import type { AttentionTraceRecord } from "./trace-writer.js";

/**
 * Wraps an evaluator so a traced run records what every pass sent and got
 * back, keyed and hosted alike, without either evaluator learning it is being
 * watched. The tap observes and never steers: the decision returns exactly as
 * the wrapped evaluator produced it, a failed pass still throws, and a
 * recorder that itself fails is swallowed here, because an instrument reading
 * the evaluator must not be able to break it.
 */
export function tracedAttentionEvaluator(
  evaluator: AttentionEvaluator,
  record: (record: AttentionTraceRecord) => void,
  now: () => number = Date.now,
): AttentionEvaluator {
  const recordQuietly = (entry: AttentionTraceRecord): void => {
    try {
      record(entry);
    } catch {
      // The trace is the instrument; the pass is the point.
    }
  };
  const quietUntil = evaluator.quietUntil;
  return {
    evaluate: async (update: AttentionUpdate) => {
      const started = now();
      try {
        const decision = await evaluator.evaluate(update);
        recordQuietly({ update, decision, elapsedMs: now() - started });
        return decision;
      } catch (error) {
        recordQuietly({
          update,
          decision: undefined,
          elapsedMs: now() - started,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
    // Forwarded only when the wrapped evaluator has one: the reviewer treats
    // the member's absence as "requests are welcome", and a wrapper that
    // always answered would change that reading.
    ...(quietUntil ? { quietUntil: () => quietUntil.call(evaluator) } : undefined),
  };
}
