/**
 * A run's cancellation, in Effect's own terms. An `AbortSignal` is what the
 * brain's callers still hold — a run revoked, a generation replaced — and a
 * turn's fiber is interrupted by it, so most of what the brain waits on
 * settles as that interruption and needs nothing of its own. Two waits still
 * do: one held under an uninterruptible region, which only the signal can
 * end, and one whose value must be owned by exactly one party — the caller,
 * when it arrives while the signal stands, or `discard`, when the signal
 * fired first, and never both and never neither.
 */
import { Deferred, Effect, Exit, Option } from "effect";

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
 * Runs the work only as long as the signal stands, answering nothing once it
 * has fired. The race is settled as aborted at once and the work is
 * interrupted, so a late model answer or transcript reaches nothing. The
 * work's own failure still propagates when it is the one that arrived first.
 * A signal that had already fired is read before the work is started rather
 * than raced against it, so work needing no suspension cannot win a race it
 * was never in.
 *
 * A fiber the same signal interrupts needs none of this; what does is a wait
 * held under an uninterruptible region, where the signal is the only thing
 * that can end it.
 */
export const settledUnlessAborted = <A, E, R>(
  work: Effect.Effect<A, E, R>,
  signal: AbortSignal,
): Effect.Effect<Option.Option<A>, E, R> =>
  Effect.suspend(() =>
    signal.aborted
      ? Effect.succeed(Option.none())
      : Effect.raceFirst(
          Effect.map(work, Option.some),
          Effect.as(whenAborted(signal), Option.none()),
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
 * only route to `discard`: a fiber interrupted by the abort it lost to — or
 * by the interruption that same signal raises on the caller's own turn —
 * would leave the value owned by nobody, which is the one outcome this
 * function exists to refuse.
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
): Effect.Effect<Option.Option<A>, E, R> =>
  Effect.scoped(
    Effect.gen(function* () {
      const decision = yield* Deferred.make<Option.Option<A>, E>();
      if (signal.aborted) yield* Deferred.succeed(decision, Option.none());
      yield* Effect.forkDaemon(
        Effect.matchCauseEffect(work, {
          onFailure: (cause) => Deferred.failCause(decision, cause),
          onSuccess: (value) =>
            Effect.uninterruptible(
              Effect.flatMap(Deferred.succeed(decision, Option.some(value)), (claimed) =>
                claimed ? Effect.void : Effect.sync(() => discard(value)),
              ),
            ),
        }),
      );
      yield* Effect.forkScoped(
        Effect.zipRight(whenAborted(signal), Deferred.succeed(decision, Option.none())),
      );
      // The waiting fiber can be interrupted by something other than this
      // signal — the turn it runs in ending — and the value would then be
      // owned by nobody. The interruption therefore takes the decision when
      // nothing has, and claims the discard itself when the work had already
      // taken it for a caller that is no longer there to receive it.
      return yield* Effect.onInterrupt(Deferred.await(decision), () =>
        Effect.gen(function* () {
          if (yield* Deferred.succeed(decision, Option.none())) return;
          const decided = yield* Deferred.poll(decision);
          if (decided === undefined || Option.isNone(decided)) return;
          const taken = yield* Effect.exit(decided.value);
          if (Exit.isSuccess(taken) && Option.isSome(taken.value)) discard(taken.value.value);
        }),
      );
    }),
  );
