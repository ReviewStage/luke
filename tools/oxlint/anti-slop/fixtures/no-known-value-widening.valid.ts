export interface ObservationPass {
  readonly provider: string;
  readonly sessions: number;
}

export const observationPass = {
  provider: "codex",
  sessions: 2,
} satisfies ObservationPass;

/** An empty accumulator widens nothing: it is where the evidence starts. */
export const sessionsByProvider: Record<string, string> = {};
