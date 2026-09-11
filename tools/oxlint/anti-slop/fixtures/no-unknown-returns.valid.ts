export interface Observation {
  readonly payload: string;
}

export function readObservation(payload: string): Observation {
  return { payload };
}

/** A promise is unwrapped before it is judged, and this one carries a type. */
export async function observe(payload: string): Promise<Observation> {
  return { payload };
}

/**
 * `Effect.gen`'s inferred generator-body type nests `unknown` inside
 * `Generator`'s own type parameters; the outer contract is `Generator`, not
 * `unknown`, so it must not be confused with a function that returns unknown.
 */
export function* observationStep(payload: string): Generator<unknown, Observation, unknown> {
  yield payload;
  return { payload };
}
