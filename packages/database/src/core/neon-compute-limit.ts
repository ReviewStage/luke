/**
 * neon-compute-limit.ts -- waits out Neon's limit on concurrently active computes when a run cannot connect for it.
 *
 * A Neon project runs at most so many computes at once (20 on the Launch
 * plan), and every Preview branch has a compute of its own, which a build's
 * migration wakes for Neon's five-minute autosuspend. With the limit full,
 * Neon refuses the connection at startup ("You have exceeded the limit of
 * concurrently active endpoints"), which on 2026-10-15 failed 79 Preview
 * builds within seconds while the builds themselves had passed. A slot frees
 * the moment any compute suspends, so a run that waits a little past one
 * autosuspend connects where failing fast only mailed a failure; every other
 * error still fails at once.
 */
import { Cause, Duration, Effect, Schedule } from "effect";

/** Neon's own words for the refusal, matched within an error's message. */
const COMPUTE_LIMIT_WORDS = "concurrently active endpoints";

/** How the wait is paced: six minutes in all, one autosuspend and a minute to spare. */
const NEON_COMPUTE_LIMIT_WAIT = {
  INTERVAL: Duration.seconds(15),
  RETRIES: 24,
} as const;

/** How deep beneath the error its causes are read, past any a driver would nest. */
const CAUSE_DEPTH = 8;

/**
 * Whether the error, or any cause beneath it, is Neon refusing a compute for
 * the limit. Note that a cause may be an Effect `Cause` rather than an error,
 * as Drizzle's `EffectDrizzleQueryError` carries the statement's failure, so
 * the walk reads on through what that `Cause` squashes to.
 */
function isNeonComputeLimit(error: Error): boolean {
  let current: Error["cause"] = error;
  for (let depth = 0; depth < CAUSE_DEPTH && current instanceof Error; depth += 1) {
    if (current.message.includes(COMPUTE_LIMIT_WORDS)) return true;
    const beneath: Error["cause"] = current.cause;
    current = Cause.isCause(beneath) ? Cause.squash(beneath) : beneath;
  }
  return false;
}

/** Hands `said` the plain words for a refusal for the limit, and does nothing for any other error. */
const sayComputeLimit = (error: Error, said: (message: string) => Effect.Effect<void>) =>
  isNeonComputeLimit(error)
    ? said(
        "Neon refused this branch's database a compute: the project already has as many computes active as its plan allows (20 on Launch), most of them other Preview branches woken by their own builds",
      )
    : Effect.void;

/**
 * Runs `run`, and while it fails because Neon will not start a compute for
 * the limit, runs it again every fifteen seconds for up to six minutes,
 * saying so each time. If the wait runs out, the failure is Neon's refusal
 * as it was, after a last line that names the limit and what frees it.
 */
export const waitingOutNeonComputeLimit = <A, E extends Error, R>(
  run: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> =>
  run.pipe(
    Effect.tapError((error) =>
      sayComputeLimit(error, (said) =>
        Effect.logWarning(
          `${said}; waiting ${Duration.format(NEON_COMPUTE_LIMIT_WAIT.INTERVAL)} for one to suspend`,
        ),
      ),
    ),
    Effect.retry({
      schedule: Schedule.spaced(NEON_COMPUTE_LIMIT_WAIT.INTERVAL),
      times: NEON_COMPUTE_LIMIT_WAIT.RETRIES,
      while: isNeonComputeLimit,
    }),
    Effect.tapError((error) =>
      sayComputeLimit(error, (said) =>
        Effect.logError(
          `${said}, and none suspended in six minutes. Nothing in this build is broken: suspend idle Preview computes, shorten their autosuspend, or raise the project's limit, then redeploy`,
        ),
      ),
    ),
  );
