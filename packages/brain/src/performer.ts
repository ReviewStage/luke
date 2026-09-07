import type { RealtimeFunctionCall } from "@sidecar/acts";
import type { BRAIN_TURN_AUTHORITY } from "@sidecar/hosted";
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
 * The standing a developer-opened turn hands the performer with each act: its
 * authority, which can only ever be the developer's because no other turn
 * reaches a performer, and whether the turn it belongs to still stands. The
 * performer asks `isRevoked()` after each step it awaited and once more just
 * before the effect, so an act prepared inside a turn that has since ended
 * is refused rather than dispatched. Today a turn's execution is revoked when
 * the turn ends or the agent stops; a request lifecycle may bind it tighter.
 */
export interface BrainActExecution {
  readonly authority: typeof BRAIN_TURN_AUTHORITY.DEVELOPER;
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
