import { Duration, Effect, type Fiber, type Schedule, type Scope } from "effect";

export const scheduleOnce = <A, E, R>(
  delayMs: number,
  work: Effect.Effect<A, E, R>,
): Effect.Effect<Fiber.Fiber<A, E>, never, R | Scope.Scope> =>
  Effect.forkScoped(Effect.delay(work, Duration.millis(delayMs)));

export const scheduleRepeat = <A, E, R, Out>(
  schedule: Schedule.Schedule<Out, A, never, R>,
  work: Effect.Effect<A, E, R>,
): Effect.Effect<Fiber.Fiber<Out, E>, never, R | Scope.Scope> =>
  Effect.forkScoped(Effect.repeat(work, schedule));
