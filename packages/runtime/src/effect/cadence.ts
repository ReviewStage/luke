/**
 * Where a cadence's fibers live. A cadence armed and disarmed at an edge
 * outside any effect — an account gate opening, a supervisor enabling a loop —
 * cannot be the acquire and release of the scope it belongs to, so it is
 * handed that scope instead and forks a child of it for each arming. Closing
 * the owner's scope closes every child still open, so nothing a disarm missed
 * outlives the close, and an arming after it forks from a scope already
 * closed, which interrupts what it forked at once.
 *
 * `cadenceGate` below is that shape said as two effects, for an owner whose
 * arming is one; the three calls beside it run an effect outside an edge,
 * exactly as the armings they were factored out of already did, and stand for
 * as long as an arming is still made from inside a promise.
 */
import { Effect, ExecutionStrategy, Exit, Option, Runtime, Scope, SynchronizedRef } from "effect";

export interface CadenceHome {
  /** The runtime the cadence's fibers are forked on. */
  readonly runtime: Runtime.Runtime<never>;
  /** The scope each arming forks its own from. */
  readonly scope: Scope.Scope;
}

/** The home as it stands where the effect asking for it is being built. */
export const cadenceHome: Effect.Effect<CadenceHome, never, Scope.Scope> = Effect.gen(function* () {
  const runtime = yield* Effect.runtime<never>();
  const scope = yield* Effect.scope;
  return { runtime, scope };
});

const runtimeOf = (home: CadenceHome | undefined): Runtime.Runtime<never> =>
  home?.runtime ?? Runtime.defaultRuntime;

/**
 * The scope one arming's fibers are forked into: a child of the home's own,
 * or, for a caller that was handed no home, an orphan nothing but that
 * caller's own disarm ever closes.
 */
export const openCadenceScope = (home: CadenceHome | undefined): Scope.CloseableScope =>
  Runtime.runSync(runtimeOf(home))(
    home === undefined ? Scope.make() : Scope.fork(home.scope, ExecutionStrategy.sequential),
  );

/**
 * Forks `work` into a scope an arming made, on the home's own runtime rather
 * than the ambient default one, and answers what the fork answered.
 */
export const forkIntoCadence = <A>(
  home: CadenceHome | undefined,
  scope: Scope.Scope,
  work: Effect.Effect<A, never, Scope.Scope>,
): A => Runtime.runSync(runtimeOf(home))(Effect.provideService(work, Scope.Scope, scope));

/**
 * Closes a scope an arming made, without waiting: what a disarm must
 * guarantee is that nothing more fires, never that a fiber has already ended.
 */
export const closeCadenceScope = (
  home: CadenceHome | undefined,
  scope: Scope.CloseableScope,
): void => {
  Runtime.runFork(runtimeOf(home))(Scope.close(scope, Exit.void));
};

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
