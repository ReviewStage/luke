/**
 * The bridge between `Event`/`Emitter` and Effect's own broadcast, while both
 * stand. An `Event` is a hot source with no backpressure — a listener is
 * synchronous and cannot refuse a value — so what the bridge has to decide is
 * where a value waits when the two sides run at different speeds, and each
 * direction answers that differently.
 *
 * This module is a strangler shim: P12-06 deletes it together with `Emitter`
 * and `Event`.
 */
import { Effect, type Scope, Stream } from "effect";
import { Emitter, type Event } from "../event.js";
import { addDisposable } from "./scope.js";

/**
 * Subscribes when the stream's scope opens and unsubscribes when it closes,
 * with an unbounded buffer between the two. Unbounded is the only policy that
 * keeps what a listener already observes: `fire` returns having delivered, so
 * a dropping or sliding buffer would lose values the emitter considers
 * delivered and a suspending one would need `fire` to wait, which it cannot.
 * The bound is the scope's lifetime instead of a count, which is the right
 * bound for the sources this shim carries — files, sockets, and a developer's
 * keys — and the wrong one for a source that can outrun its consumer without
 * end, which is a reason to give that source a `Stream` of its own rather than
 * to widen this.
 */
export const streamFromEvent = <T>(event: Event<T>): Stream.Stream<T> =>
  Stream.asyncPush<T>(
    (emit) =>
      Effect.flatMap(Effect.scope, (scope) =>
        addDisposable(
          scope,
          event((value) => {
            emit.single(value);
          }),
        ),
      ),
    { bufferSize: "unbounded" },
  );

/**
 * Answers an `Event` a caller that knows nothing of streams can subscribe to,
 * pumped by a fiber forked into the scope. The emitter is what delivers, so
 * every rule a listener can observe is the emitter's own: the listeners are
 * called in the order they subscribed, one subscribing from inside a delivery
 * hears the next value rather than that one, and a thrower stops none of the
 * rest.
 *
 * Two differences are unavoidable and neither is hidden. The source is hot
 * from the moment the scope opens rather than from the first subscription, so
 * a value the stream had ready before a listener subscribed is gone, exactly
 * as a `fire` before a subscription is. And where `Emitter.fire` reports a
 * round's failures by throwing them at whoever fired, the pump is whoever
 * fired and has nobody above it to throw to, so the round's `AggregateError`
 * is logged and the next value is still delivered — the emitter's "a thrower
 * stops none of the rest", read across rounds as well as within one.
 */
export const eventFromStream = <T, R>(
  stream: Stream.Stream<T, never, R>,
): Effect.Effect<Event<T>, never, R | Scope.Scope> =>
  Effect.gen(function* () {
    const emitter = new Emitter<T>();
    yield* Effect.flatMap(Effect.scope, (scope) => addDisposable(scope, emitter));
    yield* Effect.forkScoped(
      Stream.runForEach(stream, (value) =>
        Effect.catchAllDefect(
          Effect.sync(() => {
            emitter.fire(value);
          }),
          (defect) => Effect.logError("a listener failed while an event was delivered", defect),
        ),
      ),
    );
    return emitter.event;
  });
