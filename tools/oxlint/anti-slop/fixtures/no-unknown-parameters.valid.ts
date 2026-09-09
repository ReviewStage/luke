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
