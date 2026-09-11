export interface Observation {
  readonly sessionId: string;
}

export function recordObservation(observation: Observation): void {
  void observation;
}

/** The one input a parser cannot name: what a caught error carried with it. */
export function observationFailure(message: string, cause: unknown): Error {
  return new Error(message, { cause });
}

/**
 * `Effect.gen`'s own generator-body type carries `unknown` as `Generator`'s
 * `TNext`, never as the parameter's own type, so a parameter accepting one
 * must not be confused with an unparsed `unknown` parameter.
 */
export function runGeneratorBody<Result>(body: () => Generator<unknown, Result, unknown>): Result {
  const step = body().next();
  if (step.done !== true) throw new Error("generator body did not resolve");
  return step.value;
}
