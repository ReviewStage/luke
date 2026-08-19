import type { UnknownException } from "effect/Cause";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import type * as Exit from "effect/Exit";
import * as ExitModule from "effect/Exit";

export function runPromiseExit<A, E>(effect: Effect.Effect<A, E, never>): Promise<Exit.Exit<A, E>> {
  return Effect.runPromiseExit(effect);
}

export async function runPromiseOrDie<A, E>(effect: Effect.Effect<A, E, never>): Promise<A> {
  const exit = await Effect.runPromiseExit(Effect.orDie(effect));
  if (ExitModule.isSuccess(exit)) return exit.value;
  const defect = Cause.dieOption(exit.cause);
  if (defect._tag === "Some") throw defect.value;
  throw exit.cause;
}

export function fromPromise<A>(
  promise: () => Promise<A>,
): Effect.Effect<A, UnknownException, never> {
  return Effect.tryPromise(promise);
}

export function fromPromiseWithError<A, E>(
  promise: () => Promise<A>,
  mapError: (cause: unknown) => E,
): Effect.Effect<A, E, never> {
  return Effect.tryPromise({
    try: promise,
    catch: mapError,
  });
}
