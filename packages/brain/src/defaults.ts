import { HOSTED_BRAIN_OPTION_BOUNDS } from "@sidecar/hosted";

/** The bounds and cadences a brain agent runs under when its host names none. */
export const BRAIN_DEFAULTS = {
  MAXIMUM_OUTPUT_TOKENS: HOSTED_BRAIN_OPTION_BOUNDS.MAXIMUM_OUTPUT_TOKENS,
  /**
   * How long a caller waits on a run before being answered with the run still
   * pending. The run is not abandoned at this edge: it keeps going, and the
   * record answers the caller's next wait.
   */
  ASK_WAIT_MS: 30_000,
  /** How long a run may execute once it starts before it is timed out and its execution revoked. */
  EXECUTION_DEADLINE_MS: 48 * 60 * 60 * 1000,
  /** The most of a whole transcript one read answers with, cut from the front. */
  FULL_TRANSCRIPT_CHARS: 60_000,
} as const;
