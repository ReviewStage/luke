/**
 * How an observation fails, in one vocabulary for every way a provider is
 * observed. A cloud provider spoke of a rejected credential and a network
 * blip, a CLI provider of an absent binary and a command that failed, and the
 * two rules were already the same rule under different names: some failures
 * mean the observed state was read under something that no longer stands, and
 * the rest mean the read simply did not happen this time.
 */

import { unlessInterrupted } from "@sidecar/runtime/effect";
import { Cause, Effect, Option, Schema } from "effect";

export const ADAPTER_FAILURE = {
  /** The credential or login was rejected: observed state clears. */
  UNAUTHORIZED: "unauthorized",
  /** There is nothing to observe with — no binary, no key, signed out: observed state clears. */
  UNAVAILABLE: "unavailable",
  /** It ran and failed: the previous snapshot stands until the next attempt. */
  TRANSIENT: "transient",
  /**
   * The provider is rate limiting and the pass's backoff budget is spent: the
   * previous snapshot stands, and the pass ends rather than reading the rest
   * of the roster through the same closed door.
   */
  RATE_LIMITED: "rate-limited",
} as const;

export type AdapterFailureKind = (typeof ADAPTER_FAILURE)[keyof typeof ADAPTER_FAILURE];

/**
 * One observation's failure as the typed channel every adapter fails with:
 * which kind it is, and a sentence for a person. A Schema error rather than a
 * plain one because the web's observation pass reads it from the provider
 * package across the hosted seam, so its shape is a contract and not a class.
 */
export class AdapterFailure extends Schema.TaggedError<AdapterFailure>()("AdapterFailure", {
  failure: Schema.Literals(Object.values(ADAPTER_FAILURE)),
  message: Schema.String,
}) {}

/**
 * Whether this failure clears what the last pass observed. Nothing read under
 * a credential or login that has since been rejected or withdrawn may keep
 * being served; a failure that says nothing about either leaves the previous
 * snapshot standing, because a network blip is not news about a session.
 */
export function clearsObservedState(failure: AdapterFailureKind): boolean {
  return failure === ADAPTER_FAILURE.UNAUTHORIZED || failure === ADAPTER_FAILURE.UNAVAILABLE;
}

/**
 * Whether this failure is the whole pass's rather than one resource's. A
 * failure that clears observed state is never one resource's problem, and a
 * provider rate limiting the pass answers every further read the same way,
 * so a roster assembled past either would be partial while reading as whole.
 */
export function endsPass(failure: AdapterFailureKind): boolean {
  return clearsObservedState(failure) || failure === ADAPTER_FAILURE.RATE_LIMITED;
}

/**
 * Keeps one failed resource from discarding an otherwise complete pass. Every
 * failure the item's own effect can raise, typed or a defect alike, is
 * swallowed unless it is the whole pass's, so a bug in one item's own parsing
 * costs that item and never the roster the way a rejected credential or a
 * spent backoff budget does. A caller ending the pass is no item's failure:
 * an interruption passes through as it came, since a roster assembled past
 * one would read as complete while missing every item the caller cut short.
 */
export function tolerateItemFailureEffect<Result>(
  item: Effect.Effect<Result, AdapterFailure>,
): Effect.Effect<Result | undefined, AdapterFailure> {
  return Effect.catchCause(item, (cause) =>
    unlessInterrupted(cause, (other) => {
      const failure = Cause.findErrorOption(other);
      if (Option.isSome(failure) && endsPass(failure.value.failure))
        return Effect.fail(failure.value);
      return Effect.succeed(undefined);
    }),
  );
}
