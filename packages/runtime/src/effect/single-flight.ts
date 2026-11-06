import { Deferred, Effect, Semaphore } from "effect";

export function singleFlightEffect<E>(
  run: () => Effect.Effect<void, E>,
): () => Effect.Effect<void, E> {
  const gate = Semaphore.makeUnsafe(1);
  let flight: Deferred.Deferred<void, E> | undefined;

  function join(): Deferred.Deferred<void, E> {
    return Effect.runSync(
      gate.withPermits(1)(
        Effect.sync(() => {
          if (flight) return flight;
          const own = Deferred.makeUnsafe<void, E>();
          flight = own;
          Effect.runFork(run()).addObserver((exit) => {
            flight = undefined;
            Deferred.doneUnsafe(own, exit);
          });
          return own;
        }),
      ),
    );
  }

  return () => Deferred.await(join());
}
