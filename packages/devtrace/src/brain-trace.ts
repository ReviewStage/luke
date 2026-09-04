import {
  BRAIN_CLIENT_OUTCOME,
  type BrainClient,
  type BrainClientAnswer,
  type BrainRespondOptions,
  type ResponsesInputItem,
} from "@sidecar/brain";
import { isRecord, text, type UnparsedWireValue, wholeNumber } from "@sidecar/wire";
import type { BrainRequestTraceRecord } from "./trace-writer.js";

interface AnsweredPayloadSummary {
  outputItemKinds: readonly string[];
  inputTokens?: number;
  outputTokens?: number;
}

/**
 * What the trace keeps of an answered payload: the kinds of items that came
 * back and the usage the API reported, each read defensively because the
 * payload is what a service actually sent. The items' contents stay in the
 * payload; the trace never reads inside them.
 */
function answeredPayloadSummary(payload: UnparsedWireValue): AnsweredPayloadSummary {
  const record = isRecord(payload) ? payload : undefined;
  const outputItemKinds = Array.isArray(record?.output)
    ? record.output
        .filter(isRecord)
        .map((item) => text(item.type))
        .filter((kind): kind is string => kind !== undefined)
    : [];
  const usage = isRecord(record?.usage) ? record.usage : undefined;
  const inputTokens = wholeNumber(usage?.input_tokens);
  const outputTokens = wholeNumber(usage?.output_tokens);
  return {
    outputItemKinds,
    ...(inputTokens !== undefined ? { inputTokens } : undefined),
    ...(outputTokens !== undefined ? { outputTokens } : undefined),
  };
}

/**
 * Wraps a brain client so a traced run records what every request sent and
 * got back, keyed and hosted alike, without either client learning it is
 * being watched. The tap observes and never steers: the answer returns
 * exactly as the wrapped client produced it, a thrown request still throws,
 * and a recorder that itself fails is swallowed here, because an instrument
 * reading the client must not be able to break it. The input reaches the
 * record as its item count and JSON size alone.
 */
export function tracedBrainClient(
  client: BrainClient,
  record: (record: BrainRequestTraceRecord) => void,
  now: () => number = Date.now,
): BrainClient {
  const recordQuietly = (entry: BrainRequestTraceRecord): void => {
    try {
      record(entry);
    } catch {
      // The trace is the instrument; the turn is the point.
    }
  };
  return {
    respond: async (input: readonly ResponsesInputItem[], options: BrainRespondOptions) => {
      const started = now();
      const model = client.model;
      const about = {
        inputItems: input.length,
        inputChars: JSON.stringify(input).length,
        ...(model ? { model } : undefined),
      };
      let answer: BrainClientAnswer;
      try {
        answer = await client.respond(input, options);
      } catch (error) {
        recordQuietly({
          ...about,
          outcome: BRAIN_CLIENT_OUTCOME.FAILED,
          elapsedMs: now() - started,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
      recordQuietly({
        ...about,
        outcome: answer.outcome,
        elapsedMs: now() - started,
        ...(answer.outcome === BRAIN_CLIENT_OUTCOME.ANSWERED
          ? answeredPayloadSummary(answer.payload)
          : undefined),
        ...(answer.outcome === BRAIN_CLIENT_OUTCOME.FAILED ? { error: answer.reason } : undefined),
      });
      return answer;
    },
    quietUntil: () => client.quietUntil(),
    ...(client.model ? { model: client.model } : undefined),
  };
}
