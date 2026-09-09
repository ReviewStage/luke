import { HOSTED_BRAIN_OPTION_BOUNDS } from "@sidecar/hosted";
import { INBOX_CAPACITY } from "./observation-inbox.js";

/** The bounds and cadences a brain agent runs under when its host names none. */
export const BRAIN_DEFAULTS = {
  MAXIMUM_OUTPUT_TOKENS: HOSTED_BRAIN_OPTION_BOUNDS.MAXIMUM_OUTPUT_TOKENS,
  /** Wakes inside this window open one turn together: a hook and the poll's edge for the same stop. */
  WAKE_COALESCE_MS: 3_000,
  /**
   * How long a caller waits on a run before being answered with the run still
   * pending. The run is not abandoned at this edge: it keeps going, and the
   * record answers the caller's next wait.
   */
  ASK_WAIT_MS: 30_000,
  /** How long a run may execute once it starts before it is timed out and its execution revoked. */
  EXECUTION_DEADLINE_MS: 48 * 60 * 60 * 1000,
  /** The most of one session's new transcript one wake carries, cut from the front. */
  DELTA_PER_SESSION_CHARS: 20_000,
  /** The most of a whole transcript one read answers with, cut from the front. */
  FULL_TRANSCRIPT_CHARS: 60_000,
  /**
   * The most wakes held for one turn; past it the oldest go, since the delta
   * read covers what they said. It is the inbox's own bound, because a wake
   * held past what one turn can open with is a wake no turn would read. The
   * wake buffer is not the ask queue, whose capacity and overflow are the
   * port's own.
   */
  PENDING_WAKE_CAPACITY: INBOX_CAPACITY,
} as const;
