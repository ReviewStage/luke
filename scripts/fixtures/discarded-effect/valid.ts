import { Effect, Fiber, Layer, Stream } from "effect";

declare const deleteConversation: (sessionKey: string) => Effect.Effect<void>;
declare const frames: Stream.Stream<string>;
declare const services: Layer.Layer<never>;
declare const detach: <A, E>(effect: Effect.Effect<A, E>) => Fiber.RuntimeFiber<A, E>;
declare const report: (sessionKey: string) => Promise<void>;

/** An await that really did have a promise under it discards nothing. */
export async function reportCleared(sessionKey: string): Promise<void> {
  await report(sessionKey);
}

export function clearConversation(sessionKey: string): Effect.Effect<void> {
  return Effect.gen(function* () {
    yield* deleteConversation(sessionKey);
    yield* Effect.logInfo("cleared");
    yield* Stream.runDrain(frames);
    const provided = Layer.orDie(services);
    yield* Layer.build(provided).pipe(Effect.scoped);
    detach(deleteConversation(sessionKey));
    const fiber = yield* Effect.fork(deleteConversation(sessionKey));
    yield* Fiber.join(fiber);
  });
}
