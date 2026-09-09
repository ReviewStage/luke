import type { RealtimeFunctionCall } from "@sidecar/acts";
import type { RunOrigin } from "@sidecar/runtime/vocabulary";
import type { Session, SessionIdentity } from "@sidecar/session";
import type { WireRecord } from "@sidecar/wire";

/**
 * The roster as the host renders it, with the identities every tool argument
 * is validated against, and the sessions themselves for the scheduled look to
 * choose which transcripts to read.
 */
export interface BrainRoster {
  text: string;
  identities: readonly SessionIdentity[];
  sessions?: readonly Session[];
}

/**
 * The standing a turn hands the performer with each act: which run it
 * belongs to and who opened it — attribution, so History can say whether the
 * developer asked for the act or Luke took it on his own judgment — and
 * whether the turn still stands. The performer asks `isRevoked()` after each
 * step it awaited and once more just before the effect, so an act prepared
 * inside a turn that has since ended is refused rather than dispatched.
 * Whether the act may run at all was decided by the tool policy before the
 * call reached the performer; the performer validates what it is aimed at.
 */
export interface BrainActExecution {
  readonly runId: string;
  readonly origin: RunOrigin;
  isRevoked(): boolean;
  /**
   * Fires the moment the standing is revoked, so a performer can settle a
   * read it is waiting on — a roster refresh, a settings read — rather than
   * finishing it first. It reaches no provider write: an effect already
   * dispatched is awaited for its result whatever the signal says.
   */
  readonly signal: AbortSignal;
}

/** Carries one act for the host to validate and perform; answers what happened as a record. */
export interface BrainActPerformer {
  perform(call: RealtimeFunctionCall, execution: BrainActExecution): Promise<WireRecord>;
}
