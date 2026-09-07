import {
  MODEL_FAILURE,
  MODEL_RESPONSE_OUTCOME,
  type ModelFailure,
} from "@sidecar/runtime-contracts";

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

/** A network fault or a timeout, named without the error's own words, which could carry a key. */
export function requestFault(error: unknown) {
  return failed(
    MODEL_FAILURE.NETWORK,
    `request did not complete: ${error instanceof Error ? error.name : "unknown error"}`,
  );
}
