import { HOSTED_BRAIN_OPTION_BOUNDS } from "@sidecar/hosted";
import {
  MODEL_FAILURE,
  MODEL_RESPONSE_OUTCOME,
  type ModelFailure,
} from "@sidecar/runtime/vocabulary";
import { HTTP_STATUS, type UnparsedWireValue } from "@sidecar/wire";

/** The output budget one inference is asked for, the same on every transport: the hosted contract's ceiling. */
export const BRAIN_MAXIMUM_OUTPUT_TOKENS = HOSTED_BRAIN_OPTION_BOUNDS.MAXIMUM_OUTPUT_TOKENS;

/** A turn may read a transcript, reason over it, and act; the ceiling is for a runaway, not a budget. */
export const BRAIN_REQUEST_TIMEOUT_MS = 90_000;

/**
 * What the two Responses adapters share: the statuses they read off a
 * transport, the cooldown a rate limit earns, and the shapes of a failure.
 */

export const HTTP_METHOD = {
  GET: "GET",
  POST: "POST",
} as const;

export type HttpMethod = (typeof HTTP_METHOD)[keyof typeof HTTP_METHOD];

export const RETRY_AFTER_HEADER = "retry-after";

/**
 * How long inferences stay unsent after a rate limit that names no wait of
 * its own. Wakes held back during the quiet are not lost: they stay pending
 * and open one turn together once it ends.
 */
export const BRAIN_RATE_LIMIT_COOLDOWN_MS = 60_000;

/**
 * The longest a `Retry-After` may stand the adapter down: a provider's header
 * is honored, but a header naming an hour is not a reason to sit an hour, and
 * one naming nothing readable earns the fixed cooldown instead.
 */
export const BRAIN_RATE_LIMIT_RETRY_AFTER_BOUND_MS = 10 * 60 * 1000;

/** The wait a rate limit earns from its header, bounded, or the fixed cooldown when the header says nothing usable. */
export function rateLimitWaitMs(retryAfter: string | null): number {
  const seconds = Number(retryAfter);
  if (!Number.isFinite(seconds) || seconds <= 0) return BRAIN_RATE_LIMIT_COOLDOWN_MS;
  return Math.min(Math.round(seconds * 1000), BRAIN_RATE_LIMIT_RETRY_AFTER_BOUND_MS);
}

/** The body as JSON, or nothing when it is not; every reader validates what comes back as wire. */
export async function payloadOf(response: Response): Promise<UnparsedWireValue | undefined> {
  try {
    // SAFETY: response.json returns a runtime value; the caller's reader validates it as wire.
    return (await response.json()) as UnparsedWireValue;
  } catch {
    return undefined;
  }
}

export function failed(failure: ModelFailure, reason: string) {
  return { outcome: MODEL_RESPONSE_OUTCOME.FAILED, failure, reason } as const;
}

export function throttled(until: number) {
  return { outcome: MODEL_RESPONSE_OUTCOME.THROTTLED, until } as const;
}

export type Failure = ReturnType<typeof failed>;
/** An end already normalized for the host: a failure by kind, or a throttle with the moment to resume. */
export type Normalized = Failure | ReturnType<typeof throttled>;

/** A network fault or a timeout, named by the error's kind alone, never its words, which could carry a key. */
export function requestFault(error: Error | undefined) {
  return failed(
    MODEL_FAILURE.NETWORK,
    `request did not complete: ${error?.name ?? "unknown error"}`,
  );
}

/** Whether the service answered that it does not serve the path at all, as distinct from refusing the call. */
export function notServed(response: Response): boolean {
  return (
    response.status === HTTP_STATUS.NOT_FOUND || response.status === HTTP_STATUS.METHOD_NOT_ALLOWED
  );
}
