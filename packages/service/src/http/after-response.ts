import { Cause, Context, Effect, Layer, Option } from "effect";

interface AfterResponseValues {
  readonly keep: (work: Effect.Effect<void>) => Effect.Effect<void>;
}

export class AfterResponse extends Context.Service<AfterResponse, AfterResponseValues>()(
  "AfterResponse",
) {}

export function afterResponse<E, R>(
  label: string,
  work: Effect.Effect<void, E, R>,
): Effect.Effect<void, never, R> {
  return Effect.gen(function* () {
    const context = yield* Effect.context<R>();
    const settled = work.pipe(
      Effect.provideContext(context),
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.void
          : Effect.logWarning(`${label} failed after the answer: ${Cause.pretty(cause)}`),
      ),
    );
    const after = yield* Effect.serviceOption(AfterResponse);
    if (Option.isNone(after)) return yield* settled;
    yield* after.value.keep(settled);
  });
}

export function keptAfterResponse() {
  const kept: Effect.Effect<void>[] = [];
  const layer = Layer.succeed(AfterResponse, {
    keep: (work) => Effect.sync(() => void kept.push(work)),
  });
  const run = Effect.suspend(() =>
    Effect.forEach(kept.splice(0), (work) => work, { discard: true }),
  );
  return { layer, run };
}
