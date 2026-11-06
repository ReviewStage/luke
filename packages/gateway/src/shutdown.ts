import { Duration, Effect, Ref } from "effect";

export const GATEWAY_SHUTDOWN_DEFAULTS = {
  DEADLINE_MS: 10_000,
} as const;

export interface GatewayShutdownSteps {
  readonly closeAdmissions: Effect.Effect<void>;
  readonly cancelActive: Effect.Effect<readonly string[]>;
  readonly awaitSettled: Effect.Effect<void>;
  readonly persistUnresolved: Effect.Effect<number>;
}

export interface GatewayShutdownOptions {
  deadlineMs?: number;
}

export interface GatewayShutdownReport {
  settled: boolean;
  canceled: readonly string[];
  unresolved: number;
}

export function shutdownGatewayEffect(
  steps: GatewayShutdownSteps,
  options: GatewayShutdownOptions = {},
): Effect.Effect<GatewayShutdownReport> {
  const deadlineMs = options.deadlineMs ?? GATEWAY_SHUTDOWN_DEFAULTS.DEADLINE_MS;
  return Effect.gen(function* () {
    yield* steps.closeAdmissions;
    const canceledRef = yield* Ref.make<readonly string[]>([]);
    const settledRef = yield* Ref.make(false);
    const work = Effect.gen(function* () {
      const canceled = yield* steps.cancelActive.pipe(
        Effect.catchDefect(() => Effect.succeed<readonly string[]>([])),
      );
      yield* Ref.set(canceledRef, canceled);
      const settled = yield* steps.awaitSettled.pipe(
        Effect.as(true),
        Effect.catchDefect(() => Effect.succeed(false)),
      );
      yield* Ref.set(settledRef, settled);
    });
    const timedOut = yield* work.pipe(
      Effect.as(false),
      Effect.timeoutOrElse({
        duration: Duration.millis(deadlineMs),
        orElse: () => Effect.succeed(true),
      }),
    );
    const canceled = yield* Ref.get(canceledRef);
    const settled = timedOut ? false : yield* Ref.get(settledRef);
    const unresolved = yield* steps.persistUnresolved;
    return { settled, canceled, unresolved };
  });
}
