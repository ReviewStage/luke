import { Effect, PubSub, type Scope, Stream } from "effect";

export interface WindowFocus {
  readonly raise: Effect.Effect<void>;
  readonly heard: Effect.Effect<Stream.Stream<void>, never, Scope.Scope>;
}

export const windowFocus: Effect.Effect<WindowFocus, never, Scope.Scope> = Effect.map(
  Effect.acquireRelease(PubSub.unbounded<void>(), PubSub.shutdown),
  (raised) => ({
    raise: Effect.asVoid(PubSub.publish(raised, undefined)),
    heard: Effect.map(PubSub.subscribe(raised), Stream.fromSubscription),
  }),
);
