import type { GatewayShutdownSteps } from "@repo/gateway";
import { Effect, Fiber, Ref } from "effect";

interface BegunOnce {
  readonly begin: Effect.Effect<void>;
  readonly settled: Effect.Effect<void>;
}

function begunOnce(work: Effect.Effect<void>): Effect.Effect<BegunOnce> {
  return Effect.map(Ref.make<Fiber.Fiber<void> | undefined>(undefined), (held) => ({
    begin: Effect.flatMap(Ref.get(held), (running) =>
      running === undefined
        ? Effect.flatMap(Effect.forkDetach(Effect.asVoid(Effect.exit(work))), (forked) =>
            Effect.andThen(Ref.set(held, forked), Effect.yieldNow),
          )
        : Effect.void,
    ),
    settled: Effect.flatMap(Ref.get(held), (running) =>
      running === undefined ? Effect.void : Effect.asVoid(Fiber.join(running)),
    ),
  }));
}

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
