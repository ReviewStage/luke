/**
 * Stable provider identifiers: the agents an older build observed, which the
 * counted events it sent still name, so their counts keep validating.
 */
export const PROVIDER_ID = {
  CLAUDE_CODE: "claude-code",
  CODEX: "codex",
  CONDUCTOR: "conductor",
  OMP: "omp",
} as const;

export type ProviderId = (typeof PROVIDER_ID)[keyof typeof PROVIDER_ID];

/** Every provider identifier, in the registry's own order. */
export const PROVIDER_ID_LIST: readonly ProviderId[] = Object.values(PROVIDER_ID);
