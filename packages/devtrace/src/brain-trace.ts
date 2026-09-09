import {
  MODEL_RESPONSE_OUTCOME,
  type ModelAdapter,
  type ModelRequestOptions,
  type ModelResponse,
} from "@sidecar/runtime/vocabulary";
import { text, type WireRecord } from "@sidecar/wire";
import type { BrainRequestTraceRecord } from "./trace-writer.js";

interface AnsweredSummary {
  outputItemKinds: readonly string[];
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
}

/**
 * What the trace keeps of an answered inference: the kinds of items that came
 * back and the usage the adapter reported. The items' contents stay in the
 * answer; the trace never reads inside them.
 */
function answeredSummary(answer: Extract<ModelResponse, { outcome: "answered" }>): AnsweredSummary {
  const outputItemKinds = answer.items
    .map((item) => text(item.type))
    .filter((kind): kind is string => kind !== undefined);
  return {
    outputItemKinds,
    ...(answer.usage?.inputTokens !== undefined
      ? { inputTokens: answer.usage.inputTokens }
      : undefined),
    ...(answer.usage?.outputTokens !== undefined
      ? { outputTokens: answer.usage.outputTokens }
      : undefined),
    ...(answer.usage?.cachedInputTokens !== undefined
      ? { cachedInputTokens: answer.usage.cachedInputTokens }
      : undefined),
  };
}

/**
 * Wraps a model adapter so a traced run records what every inference sent and
 * got back, keyed and hosted alike, without the adapter learning it is being
 * watched. The tap observes and never steers: the answer returns exactly as
 * the wrapped adapter produced it, a thrown request still throws, and a
 * recorder that itself fails is swallowed here, because an instrument reading
 * the adapter must not be able to break it. The input reaches the record as
 * its item count and JSON size alone; the other operations pass through
 * untouched.
 */
export function tracedModelAdapter(
  adapter: ModelAdapter,
  record: (record: BrainRequestTraceRecord) => void,
  now: () => number = Date.now,
): ModelAdapter {
  const recordQuietly = (entry: BrainRequestTraceRecord): void => {
    try {
      record(entry);
    } catch {
      // The trace is the instrument; the turn is the point.
    }
  };
  return {
    ...(adapter.model ? { model: adapter.model } : undefined),
    capabilities: () => adapter.capabilities(),
    respond: async (input: readonly WireRecord[], options: ModelRequestOptions) => {
      const started = now();
      const model = adapter.model;
      const about = {
        inputItems: input.length,
        inputChars: JSON.stringify(input).length,
        ...(model ? { model } : undefined),
        // Whether the turn asked for a prefix cache, never which one: the key
        // is a hash of a conversation's key and belongs in no file.
        ...(options.promptCacheKey !== undefined ? { promptCacheKeyed: true } : undefined),
      };
      let answer: ModelResponse;
      try {
        answer = await adapter.respond(input, options);
      } catch (error) {
        recordQuietly({
          ...about,
          outcome: MODEL_RESPONSE_OUTCOME.FAILED,
          elapsedMs: now() - started,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
      recordQuietly({
        ...about,
        outcome: answer.outcome,
        elapsedMs: now() - started,
        ...(answer.outcome === MODEL_RESPONSE_OUTCOME.ANSWERED
          ? answeredSummary(answer)
          : undefined),
        ...(answer.outcome === MODEL_RESPONSE_OUTCOME.FAILED
          ? { error: answer.reason }
          : undefined),
      });
      return answer;
    },
    countInputTokens: (input, options) => adapter.countInputTokens(input, options),
    compact: (input, options) => adapter.compact(input, options),
    quietUntil: () => adapter.quietUntil(),
  };
}
