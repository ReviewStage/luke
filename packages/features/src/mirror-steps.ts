import { Schema } from "effect";

/**
 * mirror-steps.ts -- the steps a cloud agent's mirror on this Mac is made and kept in step by, why one failed, and where the mirror stands as the Local tab says it.
 *
 * The host's mirror (`@repo/host`'s `compose-mirrors.ts`) names its spans,
 * its counted failures, and its standing from these sets. A step, a failure,
 * and an exit or close code are all that is said of an attempt: never a
 * file's name, a path, a byte, a hash, or what Git printed.
 */

/** A step of one attempt at the mirror, in the order an attempt runs them; the prefetch runs beside the first. */
export const MIRROR_STEP = {
  /** The mirror's tunnel opened under the account's credential. */
  TUNNEL: "tunnel",
  /** The wait on the tunnel for the bridge's header, which waits on the sandbox waking. */
  HEADER: "header",
  /** The default branch had from GitHub beside the worktree's place while the tunnel opens. */
  PREFETCH: "prefetch",
  /** The worktree made of this Mac's shared clone, detached at the header's base. */
  WORKTREE: "worktree",
  /** The mirror's own files listed by Git's rules. */
  LIST: "list",
  /** A manifest matched against the mirror, what differs asked for. */
  MATCH: "match",
} as const;

export type MirrorStep = (typeof MIRROR_STEP)[keyof typeof MIRROR_STEP];

/** Why a step failed. */
export const MIRROR_FAILURE = {
  /** The service could not be reached, or this host has no socket origin. */
  UNREACHABLE: "unreachable",
  /** The service refused the tunnel's upgrade, with its HTTP status. */
  REFUSED: "refused",
  /** The tunnel closed as the sandbox not running (`TUNNEL_CLOSE.NOT_RUNNING`). */
  NOT_RUNNING: "not_running",
  /** The tunnel closed as Vercel or the bridge unavailable (`TUNNEL_CLOSE.UNAVAILABLE`). */
  UNAVAILABLE: "unavailable",
  /** The tunnel closed, by any other code, before the header was heard. */
  CLOSED: "closed",
  /** The task list carries no repository for the agent. */
  NO_REPOSITORY: "no_repository",
  /** A script exited other than 0, with its code where it had one. */
  EXITED: "exited",
  /** A script ran past its bound. */
  TIMED_OUT: "timed_out",
} as const;

export type MirrorFailure = (typeof MIRROR_FAILURE)[keyof typeof MIRROR_FAILURE];

/** What a mirror whose worktree does not stand yet is waiting on. */
export const MIRROR_STANDING = {
  WAITING: "waiting",
  CLONING: "cloning",
  PREPARING: "preparing",
  FAILED: "failed",
} as const;

const mirrorStandingSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literals([
      MIRROR_STANDING.WAITING,
      MIRROR_STANDING.CLONING,
      MIRROR_STANDING.PREPARING,
    ]),
  }),
  Schema.Struct({
    kind: Schema.Literal(MIRROR_STANDING.FAILED),
    failure: Schema.Literals(Object.values(MIRROR_FAILURE)),
    /** The script's exit code, or the tunnel's HTTP status or close code, where there was one. */
    code: Schema.optionalKey(Schema.Int),
  }),
]);

export type MirrorStanding = typeof mirrorStandingSchema.Type;

/** Every mirror's standing on this Mac, by its agent's id, as the host tells the windows. */
export const mirrorStandingsSchema = Schema.Record(Schema.String, mirrorStandingSchema);

export type MirrorStandings = typeof mirrorStandingsSchema.Type;
