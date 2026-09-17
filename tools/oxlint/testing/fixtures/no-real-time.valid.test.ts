import { Effect, TestClock } from "effect";

/** Declared rather than imported: this fixture is read as syntax, never resolved. */
declare const it: {
  (name: string, body: () => unknown): void;
  readonly effect: (name: string, body: () => Effect.Effect<unknown>) => void;
  readonly live: (name: string, body: () => Effect.Effect<unknown>) => void;
};

it.effect("advances the clock", () =>
  Effect.gen(function* () {
    yield* TestClock.adjust("10 millis");
  }),
);
