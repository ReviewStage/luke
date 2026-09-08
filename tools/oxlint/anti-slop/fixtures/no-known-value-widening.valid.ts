export interface ObservationPass {
  readonly provider: string;
  readonly sessions: number;
}

export const observationPass = {
  provider: "codex",
  sessions: 2,
} satisfies ObservationPass;
