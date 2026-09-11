/**
 * A run's cancellation, in Effect's own terms. An `AbortSignal` is what the
 * brain's callers still hold — a run revoked, a generation replaced — and a
 * fiber racing that signal is what the hand-rolled `Settled` promise was
 * written to be. Two things it guarantees are the ones the trust constraints
 * name: a cancelled or revoked run refuses the work it was waiting on, and a
 * value that must be owned by exactly one party is claimed or discarded, never
 * both and never neither.
 *
 * The Promise signatures in `../settled.ts` are a strangler shim over this
 * module: P12-02 deletes them once every caller runs a fiber of its own.
 */
import { Deferred, Effect } from "effect";

/** The work's value, or the word that the signal fired before it arrived. */
export type Settled<T> = { aborted: true } | { aborted: false; value: T };

const ABORTED = { aborted: true } as const;

/**
 * Completes when the signal fires, and never otherwise. The listener is
 * removed on both ways out — the signal firing and the fiber being interrupted
 * — so a wait that loses its race leaves nothing attached to a signal that may
 * outlive it by the length of a run.
 */
export const whenAborted = (signal: AbortSignal): Effect.Effect<void> =>
  Effect.async<void>((resume) => {
    if (signal.aborted) {
      resume(Effect.void);
      return;
    }
    const abort = () => {
      signal.removeEventListener("abort", abort);
      resume(Effect.void);
    };
    signal.addEventListener("abort", abort);
    return Effect.sync(() => signal.removeEventListener("abort", abort));
  });

/**
 * Runs the work only as long as the signal stands. Once it fires the race is
 * settled as aborted at once and the work is interrupted, so a late model
 * answer or transcript reaches nothing. The work's own failure still
 * propagates when it is the one that arrived first. A signal that had already
 * fired is read before the work is started rather than raced against it, so
 * work needing no suspension cannot win a race it was never in.
 */
export const settledUnlessAborted = <A, E, R>(
  work: Effect.Effect<A, E, R>,
  signal: AbortSignal,
): Effect.Effect<Settled<A>, E, R> =>
  Effect.suspend(() =>
    signal.aborted
      ? Effect.succeed<Settled<A>>(ABORTED)
      : Effect.raceFirst(
          Effect.map(work, (value): Settled<A> => ({ aborted: false, value })),
          Effect.as(whenAborted(signal), ABORTED),
        ),
  );

/**
 * Runs work whose value is a thing that must be owned by exactly one party:
 * the caller, when it arrives while the signal stands, or `discard`, when the
 * signal fired first. A `Deferred` is the single decision both arms reach for,
 * so whichever is first decides and the loser can only read that it lost, and
 * the claim is uninterruptible so no interruption can land between taking the
 * decision and handing the value on.
 *
 * The work runs as a daemon rather than a child, because it is the value's
 * only route to `discard`: a fiber interrupted by the abort it lost to would
 * leave the value owned by nobody, which is the one outcome this function
 * exists to refuse.
 *
 * A signal that had already fired takes the decision before the work is
 * started, so work needing no suspension is discarded rather than claimed:
 * the signal firing first is a fact about real time, not a race the scheduler
 * decides.
 */
export const claimedUnlessAborted = <A, E, R>(
  work: Effect.Effect<A, E, R>,
  signal: AbortSignal,
  discard: (value: A) => void,
): Effect.Effect<Settled<A>, E, R> =>
  Effect.scoped(
    Effect.gen(function* () {
      const decision = yield* Deferred.make<Settled<A>, E>();
      if (signal.aborted) yield* Deferred.succeed(decision, ABORTED);
      yield* Effect.forkDaemon(
        Effect.matchCauseEffect(work, {
          onFailure: (cause) => Deferred.failCause(decision, cause),
          onSuccess: (value) =>
            Effect.uninterruptible(
              Effect.flatMap(
                Deferred.succeed(decision, { aborted: false, value } satisfies Settled<A>),
                (claimed) => (claimed ? Effect.void : Effect.sync(() => discard(value))),
              ),
            ),
        }),
      );
      yield* Effect.forkScoped(
        Effect.zipRight(whenAborted(signal), Deferred.succeed(decision, ABORTED)),
      );
      return yield* Deferred.await(decision);
    }),
  );
