/**
 * Where a cadence's fibers live. A cadence armed and disarmed at an edge
 * outside any effect — an account gate opening, a supervisor enabling a loop —
 * cannot be the acquire and release of the scope it belongs to, so it is
 * handed that scope instead and forks a child of it for each arming. Closing
 * the owner's scope closes every child still open, so nothing a disarm missed
 * outlives the close, and an arming after it forks from a scope already
 * closed, which interrupts what it forked at once.
 *
 * The three calls below run an effect outside an edge, exactly as the armings
 * they were factored out of already did; each of those owners is on the ADR's
 * allowlist for as long as its arming is a synchronous call rather than an
 * effect.
 */
import { Effect, ExecutionStrategy, Exit, Runtime, Scope } from "effect";

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
  scope: Scope.CloseableScope,
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
