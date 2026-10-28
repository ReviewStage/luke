import type { GatewayShutdownSteps } from "@luke/gateway";
import { Effect, Fiber, Ref } from "effect";

/**
 * The explicit quit, where one concern must not decide another's fate: the
 * counted events' last flush rides beside the run drain rather than inside it.
 */

/**
 * A step that begins beside the drain rather than inside it: the first ask
 * forks it, every later ask finds the fiber already running, and what waits
 * on it joins that one fiber. A fork rather than a sequence, because the
 * wrapper below begins its work at one step of the quit and waits for it at
 * another; an outcome of either kind is swallowed, since a flush that failed
 * is a count nobody has rather than a quit that failed.
 */
interface BegunOnce {
  readonly begin: Effect.Effect<void>;
  readonly settled: Effect.Effect<void>;
}

function begunOnce(work: Effect.Effect<void>): Effect.Effect<BegunOnce> {
  return Effect.map(Ref.make<Fiber.Fiber<void> | undefined>(undefined), (held) => ({
    begin: Effect.flatMap(Ref.get(held), (running) =>
      running === undefined
        ? Effect.flatMap(Effect.forkDetach(Effect.asVoid(Effect.exit(work))), (forked) =>
            // A daemon rather than a child, because the step that begins the
            // work and the step that waits on it are not the same fiber: the
            // cancellations run inside the coordinator's deadline, and a
            // child forked there would be interrupted by the deadline rather
            // than merely stopped being waited on. It is given its first turn
            // before the quit moves on, so the work is under way from the
            // step that began it.
            Effect.andThen(Ref.set(held, forked), Effect.yieldNow),
          )
        : Effect.void,
    ),
    settled: Effect.flatMap(Ref.get(held), (running) =>
      running === undefined ? Effect.void : Effect.asVoid(Fiber.join(running)),
    ),
  }));
}

/**
 * The explicit quit's steps with the counted events' last flush folded in.
 * The flush begins the moment the door closes, so a count the client made
 * just before its quit (the update install it asked for) leaves alongside the
 * drain rather than after the process has gone; it is waited for only inside
 * the coordinator's one deadline, beside the runs settling, so a network that
 * stalls delays the quit by nothing more than the drain already allows, and
 * what did not settle is still counted from the persisted records without it.
 * The sender's own flush never fails; the guard here is for the shape, not
 * a case it has.
 */
export function shutdownStepsFlushingEvents(
  steps: GatewayShutdownSteps,
  flushEvents: Effect.Effect<void>,
): Effect.Effect<GatewayShutdownSteps> {
  return Effect.map(begunOnce(flushEvents), (flush) => ({
    closeAdmissions: Effect.andThen(steps.closeAdmissions, flush.begin),
    cancelActive: steps.cancelActive,
    awaitSettled: Effect.all([steps.awaitSettled, flush.settled], {
      concurrency: "unbounded",
      discard: true,
    }),
    persistUnresolved: steps.persistUnresolved,
  }));
}
