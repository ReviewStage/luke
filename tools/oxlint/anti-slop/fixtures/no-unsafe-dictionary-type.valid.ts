export interface Observation {
  readonly sessionId: string;
}

export type ObservationsByProvider = ReadonlyMap<string, Observation>;
