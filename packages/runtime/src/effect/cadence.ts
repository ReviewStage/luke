/**
 * Where a cadence's fibers live. A cadence armed and disarmed at an edge
 * outside any effect — an account gate opening, a supervisor enabling a loop —
 * cannot be the acquire and release of the scope it belongs to, so it is
 * handed that scope instead and forks a child of it for each arming. Closing
 * the owner's scope closes every child still open, so nothing a disarm missed
 * outlives the close, and an arming after it forks from a scope already
 * closed, which interrupts what it forked at once.
 *
 * Nothing here runs an effect any more. The three calls that did —
 * `openCadenceScope`, `forkIntoCadence`, and `closeCadenceScope`, with the
 * `CadenceHome` they took a runtime from — stood for the one arming still
 * made from inside a promise, the calendars' meeting-boundary wake re-armed
 * by an observation pass; that pass is an effect now, so the wake forks into
 * the observation's own scope where it is armed and the three calls are gone.
 */
import { Effect, ExecutionStrategy, Exit, Option, Scope, SynchronizedRef } from "effect";

/**
 * A cadence the owner arms and disarms by hand, as a pair of effects rather
 * than a pair of synchronous calls: the arm forks a child of the home's scope
 * and runs the arming in it, the disarm closes that child, and the home's own
 * close disarms whatever is still standing. The pair is serialized, so a
 * disarm that arrives while an arm is still out waits for it and then undoes
 * it, which is the race an arm-and-check pair used to answer by re-reading
 * its gate.
 */
export interface CadenceGate {
  /** Arms the cadence, or, where it already stands, does nothing. */
  readonly arm: Effect.Effect<void>;
  /** Disarms it, waiting for the finalizers of what it armed. */
  readonly disarm: Effect.Effect<void>;
}

export const cadenceGate = (
  armed: Effect.Effect<void, never, Scope.Scope>,
): Effect.Effect<CadenceGate, never, Scope.Scope> =>
  Effect.gen(function* () {
    const home = yield* Effect.scope;
    const standing = yield* SynchronizedRef.make(Option.none<Scope.CloseableScope>());
    const disarm = SynchronizedRef.updateEffect(standing, (current) =>
      Option.match(current, {
        onNone: () => Effect.succeed(current),
        onSome: (scope) =>
          Effect.as(Scope.close(scope, Exit.void), Option.none<Scope.CloseableScope>()),
      }),
    );
    const arm = SynchronizedRef.updateEffect(standing, (current) =>
      Option.isSome(current)
        ? Effect.succeed(current)
        : Effect.gen(function* () {
            const scope = yield* Scope.fork(home, ExecutionStrategy.sequential);
            yield* Scope.extend(armed, scope);
            return Option.some(scope);
          }),
    );
    yield* Effect.addFinalizer(() => disarm);
    return { arm, disarm };
  });
