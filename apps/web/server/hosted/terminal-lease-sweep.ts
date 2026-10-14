/**
 * terminal-lease-sweep.ts -- the scheduled sweep's stop of a coding agent's sandbox once no developer's terminal holds it.
 *
 * A developer typing in a Terminal tab holds the agent's sandbox: the
 * terminal relay moves the conversation's lease on with each keystroke, and
 * the agent's turn-end stop leaves a held sandbox running
 * (`sandbox-terminal-lease.ts`). Once a lease has lapsed past a short grace,
 * which covers a terminal reconnecting, and no turn of its agent runs, the
 * sweep claims it, so a keystroke that landed after the read keeps the
 * sandbox, and stops the sandbox, its filesystem kept for a later resume. A
 * lease whose agent still runs a turn is left for that turn's own end, and
 * for a later sweep once the turn is over however it ended. A stop Vercel did
 * not confirm puts the lease back behind the ones not yet tried, and a later
 * sweep tries again. What is asked of Vercel is a session's tag, and what is
 * logged of a failure is its status.
 */

import type { DatabaseServices, QueryError } from "@sidecar/database/core/query";
import {
  claimLapsedLease,
  deferLapsedLease,
  type LapsedSandboxLease,
  lapsedSandboxLeases,
} from "@sidecar/database/models/sandbox-terminal-lease";
import { Duration, Effect, Result, type Schema } from "effect";
import { SessionSandboxes } from "./session-sandboxes.js";

export const TERMINAL_LEASE_SWEEP = {
  /** How long past its lapse a lease stands before the sweep stops its sandbox: a terminal reconnecting takes it up again well inside it. */
  GRACE: Duration.minutes(2),
  /** The most leases one sweep takes; the rest wait for the next minute. */
  MAX_LEASES: 20,
  CONCURRENCY: 5,
} as const;

/** What one sweep of the lapsed leases came to: sandboxes stopped, leases let go with nothing to stop, and leases put back for a later sweep. */
export interface TerminalLeaseSweepOutcome {
  stopped: number;
  released: number;
  pending: number;
}

const LEASE_ENDING = {
  STOPPED: "stopped",
  RELEASED: "released",
  PENDING: "pending",
  /** The developer typed again after the read, so the lease and its sandbox stand. */
  RETAKEN: "retaken",
} as const;

type LeaseEnding = (typeof LEASE_ENDING)[keyof typeof LEASE_ENDING];

/** One lapsed lease dealt with: claimed, then its sandbox stopped, or the lease put back where Vercel did not confirm the stop. */
const endLease = /* @__PURE__ */ Effect.fnUntraced(function* (
  lease: LapsedSandboxLease,
  lapsedBefore: Date,
  now: Date,
): Effect.fn.Return<
  LeaseEnding,
  QueryError | Schema.SchemaError,
  SessionSandboxes | DatabaseServices
> {
  if (!(yield* claimLapsedLease(lease.conversationId, lapsedBefore))) return LEASE_ENDING.RETAKEN;
  // A conversation that never opened a sandbox has none to stop.
  if (lease.sessionId === null) return LEASE_ENDING.RELEASED;
  const sandboxes = yield* SessionSandboxes;
  const stopped = yield* Effect.result(sandboxes.stopFor(lease.sessionId));
  if (Result.isFailure(stopped)) {
    yield* Effect.logWarning(`a held sandbox was not stopped: ${stopped.failure.message}`);
    yield* deferLapsedLease(lease, now);
    return LEASE_ENDING.PENDING;
  }
  return LEASE_ENDING.STOPPED;
});

/** Takes the next batch of leases lapsed past the grace, `CONCURRENCY` at a time, and counts how each ended. */
export const sweepTerminalLeases = /* @__PURE__ */ Effect.fn("web/sweepTerminalLeases")(function* (
  now: Date,
): Effect.fn.Return<
  TerminalLeaseSweepOutcome,
  QueryError | Schema.SchemaError,
  SessionSandboxes | DatabaseServices
> {
  const lapsedBefore = new Date(now.getTime() - Duration.toMillis(TERMINAL_LEASE_SWEEP.GRACE));
  const leases = yield* lapsedSandboxLeases(lapsedBefore, TERMINAL_LEASE_SWEEP.MAX_LEASES);
  const endings = yield* Effect.forEach(leases, (lease) => endLease(lease, lapsedBefore, now), {
    concurrency: TERMINAL_LEASE_SWEEP.CONCURRENCY,
  });
  return {
    stopped: endings.filter((ending) => ending === LEASE_ENDING.STOPPED).length,
    released: endings.filter((ending) => ending === LEASE_ENDING.RELEASED).length,
    pending: endings.filter((ending) => ending === LEASE_ENDING.PENDING).length,
  };
});
