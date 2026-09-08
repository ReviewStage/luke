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
