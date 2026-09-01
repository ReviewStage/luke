import { Clock, Effect, Fiber, Ref, Schedule } from "effect";

export interface ObservationLoopConfig {
  gate: () => boolean;
  intervalMs: number;
  run: (generation: number) => Promise<void>;
  afterRun?: () => void;
}

export interface ObservationLoopHandle {
  readonly generation: number;
  isCurrent(generation: number): boolean;
  start(): void;
  stop(): void;
  refresh(): Promise<void>;
}

/** Imperative handle backed by Effect fibers; used by the desktop composition root. */
export function createObservationLoop(config: ObservationLoopConfig): ObservationLoopHandle {
  let generation = 0;
  let running = false;
  let queued = false;
  let intervalFiber: Fiber.RuntimeFiber<void, never> | undefined;

  const isCurrent = (candidate: number) => candidate === generation && config.gate();

  const runRefresh = (): Effect.Effect<void, unknown> =>
    Effect.gen(function* () {
      if (!config.gate()) return;
      if (running) {
        queued = true;
        return;
      }
      const passGeneration = generation;
      running = true;
      try {
        yield* Effect.tryPromise(() => config.run(passGeneration));
      } finally {
        running = false;
        if (isCurrent(passGeneration)) config.afterRun?.();
        if (queued) {
          queued = false;
          yield* runRefresh();
        }
      }
    });

  const refresh = () => Effect.runPromise(runRefresh());

  const start = () => {
    if (intervalFiber || !config.gate()) return;
    void refresh();
    intervalFiber = Effect.runFork(
      Effect.repeat(
        Clock.sleep(config.intervalMs).pipe(
          Effect.flatMap(() => runRefresh()),
          Effect.asVoid,
        ),
        Schedule.forever,
      ),
    );
  };

  const stop = () => {
    generation += 1;
    queued = false;
    if (intervalFiber) {
      Effect.runFork(Fiber.interrupt(intervalFiber));
      intervalFiber = undefined;
    }
  };

  return {
    get generation() {
      return generation;
    },
    isCurrent,
    start,
    stop,
    refresh,
  };
}

export interface ObservationLoopRuntime {
  readonly generation: Effect.Effect<number>;
  readonly isCurrent: (generation: number) => Effect.Effect<boolean>;
  readonly start: Effect.Effect<void>;
  readonly stop: Effect.Effect<void>;
  readonly refresh: Effect.Effect<void>;
}

/** Effect-native loop for TestClock and Layer tests. */
export function makeObservationLoopRuntime(
  config: ObservationLoopConfig,
): Effect.Effect<ObservationLoopRuntime, never, Clock.Clock> {
  return Effect.gen(function* () {
    const generation = yield* Ref.make(0);
    const running = yield* Ref.make(false);
    const queued = yield* Ref.make(false);
    const intervalFiber = yield* Ref.make<Fiber.RuntimeFiber<void, never> | undefined>(undefined);

    const readGeneration = Ref.get(generation);

    const isCurrent = (candidate: number) =>
      Effect.gen(function* () {
        const current = yield* Ref.get(generation);
        return candidate === current && config.gate();
      });

    const runRefresh = (): Effect.Effect<void, unknown, Clock.Clock> =>
      Effect.gen(function* () {
        if (!config.gate()) return;
        if (yield* Ref.get(running)) {
          yield* Ref.set(queued, true);
          return;
        }
        const passGeneration = yield* Ref.get(generation);
        yield* Ref.set(running, true);
        try {
          yield* Effect.tryPromise(() => config.run(passGeneration));
        } finally {
          yield* Ref.set(running, false);
          if (yield* isCurrent(passGeneration)) config.afterRun?.();
          if (yield* Ref.get(queued)) {
            yield* Ref.set(queued, false);
            yield* runRefresh();
          }
        }
      });

    const refresh = runRefresh();

    const start = Effect.gen(function* () {
      if ((yield* Ref.get(intervalFiber)) || !config.gate()) return;
      yield* runRefresh();
      const fiber = yield* Effect.fork(
        Effect.repeat(
          Clock.sleep(config.intervalMs).pipe(
            Effect.flatMap(() => runRefresh()),
            Effect.asVoid,
          ),
          Schedule.forever,
        ),
      );
      yield* Ref.set(intervalFiber, fiber);
    });

    const stop = Effect.gen(function* () {
      yield* Ref.update(generation, (value) => value + 1);
      yield* Ref.set(queued, false);
      const fiber = yield* Ref.get(intervalFiber);
      if (fiber) {
        yield* Fiber.interrupt(fiber);
        yield* Ref.set(intervalFiber, undefined);
      }
    });

    return {
      generation: readGeneration,
      isCurrent,
      start,
      stop,
      refresh,
    };
  });
}

export function createObservationSupervisor(loops: readonly ObservationLoopHandle[]): {
  setEnabled(enabled: boolean): void;
} {
  return {
    setEnabled(enabled: boolean) {
      for (const loop of loops) {
        if (enabled) loop.start();
        else loop.stop();
      }
    },
  };
}
