export interface Observation {
  readonly payload: string;
}

export function readObservation(payload: string): Observation {
  return { payload };
}
