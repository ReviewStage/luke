import { Cause, Duration, Effect, Schedule } from "effect";

const COMPUTE_LIMIT_WORDS = "concurrently active endpoints";

const NEON_COMPUTE_LIMIT_WAIT = {
  INTERVAL: Duration.seconds(15),
  RETRIES: 24,
} as const;

const CAUSE_DEPTH = 8;

function isNeonComputeLimit(error: Error): boolean {
  let current: Error["cause"] = error;
  for (let depth = 0; depth < CAUSE_DEPTH && current instanceof Error; depth += 1) {
    if (current.message.includes(COMPUTE_LIMIT_WORDS)) return true;
    const beneath: Error["cause"] = current.cause;
    current = Cause.isCause(beneath) ? Cause.squash(beneath) : beneath;
  }
  return false;
}

const sayComputeLimit = (error: Error, said: (message: string) => Effect.Effect<void>) =>
  isNeonComputeLimit(error)
    ? said(
        "Neon refused this branch's database a compute: the project already has as many computes active as its plan allows (20 on Launch), most of them other Preview branches woken by their own builds",
      )
    : Effect.void;

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
