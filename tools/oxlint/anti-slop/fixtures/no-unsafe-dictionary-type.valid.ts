export interface Observation {
  readonly sessionId: string;
}

export type ObservationsByProvider = ReadonlyMap<string, Observation>;

/** A dictionary is unsafe for its value type alone; this one names a contract. */
export type ObservationsBySession = Record<string, Observation>;
