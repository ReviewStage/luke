import { scheduleTask } from "@effect/atom-react/RegistryContext";
import { Cause, type Context, Duration, Effect, Exit, Layer } from "effect";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import * as Atom from "effect/reactivity/Atom";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";

export const rendererRuntime = Atom.keepAlive(Atom.runtime(Layer.empty));

export const rendererRegistry = AtomRegistry.make({ scheduleTask });

export const rendererServicesNow = (): Context.Context<never> =>
  AsyncResult.getOrThrow(rendererRegistry.get(rendererRuntime));

export const rendererPause = (ms: number): Promise<void> =>
  Effect.runPromiseWith(rendererServicesNow())(Effect.sleep(Duration.millis(ms)));

export const rendererFork = (effect: Effect.Effect<void>): (() => void) => {
  const fiber = Effect.runForkWith(rendererServicesNow())(effect);
  return () => fiber.interruptUnsafe();
};

export const rendererPromise = <A, E>(
  effect: Effect.Effect<A, E>,
  signal?: AbortSignal,
): Promise<A> =>
  Effect.runPromiseExitWith(rendererServicesNow())(effect, { signal }).then((exit) =>
    Exit.isSuccess(exit) ? exit.value : Promise.reject(Cause.squash(exit.cause)),
  );
