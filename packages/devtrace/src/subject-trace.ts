import type { SubjectEvaluator, SubjectInput } from "@sidecar/attention";
import type { SubjectTraceRecord } from "./trace-writer.js";

/**
 * Wraps a subject evaluator the way `tracedAttentionEvaluator` wraps the
 * attention one: every derivation is recorded, keyed and hosted alike, and
 * the tap observes without steering. The derivation returns exactly as the
 * wrapped evaluator produced it, a failure still throws, and a recorder that
 * itself fails is swallowed. The transcript reaches the record as its byte
 * count alone.
 */
export function tracedSubjectEvaluator(
  evaluator: SubjectEvaluator,
  record: (record: SubjectTraceRecord) => void,
  now: () => number = Date.now,
): SubjectEvaluator {
  const recordQuietly = (entry: SubjectTraceRecord): void => {
    try {
      record(entry);
    } catch {
      // The trace is the instrument; the derivation is the point.
    }
  };
  const about = (input: SubjectInput) => ({
    providerName: input.providerName,
    title: input.title,
    ...(input.recap ? { recap: input.recap } : undefined),
    transcriptBytes: Buffer.byteLength(input.transcript, "utf8"),
  });
  const quietUntil = evaluator.quietUntil;
  return {
    derive: async (input: SubjectInput) => {
      const started = now();
      const model = evaluator.model;
      try {
        const derivation = await evaluator.derive(input);
        recordQuietly({
          ...about(input),
          subject: derivation?.subject,
          elapsedMs: now() - started,
          ...(model ? { model } : undefined),
        });
        return derivation;
      } catch (error) {
        recordQuietly({
          ...about(input),
          subject: undefined,
          elapsedMs: now() - started,
          error: error instanceof Error ? error.message : String(error),
          ...(model ? { model } : undefined),
        });
        throw error;
      }
    },
    ...(evaluator.model ? { model: evaluator.model } : undefined),
    ...(quietUntil ? { quietUntil: () => quietUntil.call(evaluator) } : undefined),
  };
}
