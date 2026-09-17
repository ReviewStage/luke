import { Effect } from "effect";

/** Declared rather than imported: this fixture is read as syntax, never resolved. */
declare const it: {
  (name: string, body: () => unknown): void;
  readonly effect: (name: string, body: () => Effect.Effect<unknown>) => void;
  readonly live: (name: string, body: () => Effect.Effect<unknown>) => void;
};

it.effect("returns the effect to the runner", () =>
  Effect.gen(function* () {
    yield* Effect.succeed(1);
  }),
);
