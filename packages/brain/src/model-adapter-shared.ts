import {
  MODEL_FAILURE,
  MODEL_RESPONSE_OUTCOME,
  type ModelAdapter,
  type ModelFailure,
  type ModelRequestOptions,
  type ModelResponse,
} from "@sidecar/runtime-contracts";
import type { WireRecord } from "@sidecar/wire";
import { RESPONSES_ITEM_FORMAT } from "./responses-api.js";
import { TOOL_LOOP_RUNTIME } from "./runtime.js";

/** The output budget one inference is asked for, the same on every transport. */
export const BRAIN_MAXIMUM_OUTPUT_TOKENS = 16_000;

/**
 * What the two Responses adapters share: the statuses they read off a
 * transport, the cooldown a rate limit earns, and the shapes of a failure.
 */

export const RATE_LIMIT_STATUS = 429;
export const UNAUTHORIZED_STATUS = 401;
export const RETRY_AFTER_HEADER = "retry-after";

/**
 * How long inferences stay unsent after a rate limit that names no wait of
 * its own. Wakes held back during the quiet are not lost: they stay pending
 * and open one turn together once it ends.
 */
export const BRAIN_RATE_LIMIT_COOLDOWN_MS = 60_000;

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export function withoutTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

/** The per-request timeout, joined with the run's own cancellation when the inference belongs to one. */
export function requestSignal(
  timeoutMs: number,
  cancellation: AbortSignal | undefined,
): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return cancellation ? AbortSignal.any([timeout, cancellation]) : timeout;
}

export function failed(failure: ModelFailure, reason: string) {
  return { outcome: MODEL_RESPONSE_OUTCOME.FAILED, failure, reason } as const;
}

export function throttled(until: number) {
  return { outcome: MODEL_RESPONSE_OUTCOME.THROTTLED, until } as const;
}

/** A network fault or a timeout, named by the error's kind alone, never its words, which could carry a key. */
export function requestFault(error: Error | undefined) {
  return failed(
    MODEL_FAILURE.NETWORK,
    `request did not complete: ${error?.name ?? "unknown error"}`,
  );
}

/** The two things a bare transport answers: an inference, and when it is quiet. */
export interface BareResponsesModel {
  readonly model?: string;
  respond(items: readonly WireRecord[], options: ModelRequestOptions): Promise<ModelResponse>;
  quietUntil(): number | undefined;
}

/**
 * A full model adapter over a transport that only infers, in the Responses
 * item format: it counts and compacts nothing, and says so. For a host's
 * tests and for a transport that has not grown the other two operations.
 */
export function bareModelAdapter(bare: BareResponsesModel): ModelAdapter {
  return {
    ...(bare.model ? { model: bare.model } : undefined),
    capabilities: () =>
      Promise.resolve({
        outcome: MODEL_RESPONSE_OUTCOME.ANSWERED,
        capabilities: {
          adapter: "bare-responses",
          ...(bare.model ? { model: bare.model } : undefined),
          checkpoint: {
            runtime: TOOL_LOOP_RUNTIME.ID,
            runtimeVersion: TOOL_LOOP_RUNTIME.VERSION,
            format: RESPONSES_ITEM_FORMAT.FORMAT,
            formatVersion: RESPONSES_ITEM_FORMAT.VERSION,
          },
          countsInputTokens: false,
          compacts: false,
          maximumOutputTokens: BRAIN_MAXIMUM_OUTPUT_TOKENS,
        },
      }),
    respond: (items, options) => bare.respond(items, options),
    countInputTokens: () =>
      Promise.resolve(failed(MODEL_FAILURE.COMPATIBILITY, "this transport does not count tokens")),
    compact: () =>
      Promise.resolve(failed(MODEL_FAILURE.COMPATIBILITY, "this transport does not compact")),
    quietUntil: () => bare.quietUntil(),
  };
}
