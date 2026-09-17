// settle.ts -- the waits a voice suite makes on the real clock against the real store.
import assert from "node:assert/strict";
import { Duration, Effect, Schedule } from "effect";

/**
 * The voice suites stand the service on the store's own runtime, whose clock
 * is the real one, so a wait here is real time and a suite holding one runs
 * under `it.live`. A wait on a row a real database has to land is a poll on a
 * `Schedule` (`settled`); a wait on something a callback announces is
 * event-driven and polls nothing (`arrival` in `@sidecar/voice/testing`); a
 * wait for nothing more to arrive is the one wait that is a plain
 * `Effect.sleep`, bounded and stated at its site.
 */
const SETTLE = {
  POLL: Duration.millis(5),
  ATTEMPTS: 400,
} as const;

/** Polls `ready` on the schedule until it answers true, or fails naming what it waited for. */
export function settled(
  ready: () => boolean | Promise<boolean>,
  waitedFor: string | (() => string | Promise<string>),
): Effect.Effect<void> {
  return Effect.repeat(
    Effect.promise(async () => ready()),
    {
      schedule: Schedule.spaced(SETTLE.POLL).pipe(Schedule.upTo({ times: SETTLE.ATTEMPTS })),
      until: (answered: boolean): boolean => answered,
    },
  ).pipe(
    Effect.flatMap((answered) =>
      Effect.promise(async () => {
        if (answered) return;
        const what = typeof waitedFor === "string" ? waitedFor : await waitedFor();
        assert.fail(`timed out waiting for ${what}`);
      }),
    ),
  );
}
