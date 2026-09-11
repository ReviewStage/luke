/**
 * The execution lanes in Effect's own terms. `lanes.ts` is a port of OpenClaw
 * `b7528507` and stays faithful to it — it imports nothing from `effect` — so
 * everything Effect needs of a lane lives here beside it: acquiring a lane's
 * slot as a scoped resource, `Semaphore`-shaped, whose release is what lets
 * the port's own queue admit the next waiter.
 *
 * `LaneScheduler` exposes no admission step of its own, only `run(lane, work)`
 * with `work` a promise-returning callback invoked at the moment the lane
 * admits it, so that moment is where this sibling's acquire resumes: the
 * callback resolves the acquire with a release function and then holds the
 * lane open on a promise the release later settles.
 */
import { Effect, type Scope } from "effect";
import type { Lane, LaneScheduler, LaneSnapshot } from "./lanes.js";

/**
 * A lane's slot, held for the scope's lifetime. Acquiring waits for the
 * port's own queue to admit it — in arrival order, same as `run` — and
 * releasing frees the slot for the next waiter, exactly as ending `work`
 * would. The port keeps no way to withdraw a queued entry, so a waiter
 * interrupted before admission is still admitted later; `acquireRelease`'s
 * own guarantee is what makes that harmless — the scope closes on
 * interruption the moment its acquire finishes, so the slot the late
 * admission opened is freed at once, before anything runs under it.
 */
export const acquireLane = (
  scheduler: LaneScheduler,
  lane: Lane,
): Effect.Effect<void, never, Scope.Scope> =>
  Effect.acquireRelease(
    Effect.async<() => void>((resume) => {
      let free: () => void = () => {};
      const held = new Promise<void>((resolve) => {
        free = resolve;
      });
      void scheduler.run(lane, () => {
        resume(Effect.succeed(free));
        return held;
      });
    }),
    (free) => Effect.sync(free),
  ).pipe(Effect.asVoid);

/** Runs `effect` under the lane: admitted in the port's own order, released when it settles. */
export const withLane = <A, E, R>(
  scheduler: LaneScheduler,
  lane: Lane,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> => Effect.scoped(Effect.zipRight(acquireLane(scheduler, lane), effect));

/** The lane's current width, active count, and queue depth. */
export const laneSnapshot = (scheduler: LaneScheduler, lane: Lane): Effect.Effect<LaneSnapshot> =>
  Effect.sync(() => scheduler.snapshot(lane));
