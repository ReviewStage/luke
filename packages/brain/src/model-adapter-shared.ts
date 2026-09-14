import { HOSTED_BRAIN_OPTION_BOUNDS } from "@sidecar/hosted";
import { MODEL_RESPONSE_OUTCOME, type ModelFailure } from "@sidecar/runtime/vocabulary";

/** The output budget one inference is asked for, the same on every transport: the hosted contract's ceiling. */
export const BRAIN_MAXIMUM_OUTPUT_TOKENS = HOSTED_BRAIN_OPTION_BOUNDS.MAXIMUM_OUTPUT_TOKENS;

/** A turn may read a transcript, reason over it, and act; the ceiling is for a runaway, not a budget. */
export const BRAIN_REQUEST_TIMEOUT_MS = 90_000;

/** A failure by kind, the shape a model adapter answers when an inference did not. */
export function failed(failure: ModelFailure, reason: string) {
  return { outcome: MODEL_RESPONSE_OUTCOME.FAILED, failure, reason } as const;
}
